// Estimates how far a backend image build has come from Podman's plain build output.
// Each step announces itself as `[2/2] STEP 4/14: RUN …`, writes its output as plain
// lines, and ends when the next step, `[2/2] COMMIT …` or a `--> <id>` line follows.
// The Dockerfile gives every step's weight before Podman announces it. The package
// installation takes most of a fresh build, so its step advances with apt's own
// download, unpack and set-up counts, and installing the Python packages with uv's own
// phases. A base image pull advances as its layers finish copying. A step Podman takes
// from its cache weighs nothing.

interface Step {
	/** Seconds the step is expected to take. */
	weight: number
	/** 0–1 within the step. */
	done: number
	/** The weight of a step that may well take nothing, held back until the step does work. */
	held?: number
	/** apt's package counts, for the step that installs packages; null until apt plans. */
	apt?: { total: number; fetched: number; installed: number } | null
	/** uv's large downloads, started and finished, for the step that installs the Python packages. */
	uv?: { downloading: number; downloaded: number }
	/** The base image's layers by digest, and whether each has finished; empty while the image is local. */
	layers?: Map<string, boolean>
}

// Seconds measured in a fresh build of 78 s: installing the packages took 55 s, each
// other RUN step 6–8 s, a copy from the other stage 1–5 s, a copy from the build context
// under half a second, a setting such as ENV a tenth, and writing the image 1 s.
const PACKAGES_WEIGHT = 55
const RUN_WEIGHT = 7
const STAGE_COPY_WEIGHT = 3
const COPY_WEIGHT = 0.4
const SETTING_WEIGHT = 0.1
const EXPORT_WEIGHT = 1
// Not measured: the slim Python base is about 45 MB, roughly 15 s on a typical
// connection. A base image found locally takes no time.
const PULL_WEIGHT = 15

const installsPackages = (instruction: string) => /^RUN\b.*\bapt-get install\b/.test(instruction)

function plannedStep(instruction: string): Step {
	if (installsPackages(instruction)) return { weight: PACKAGES_WEIGHT, done: 0, apt: null }
	if (/^FROM\s/i.test(instruction)) return { weight: 0, held: PULL_WEIGHT, done: 0, layers: new Map() }
	if (/^RUN\b.*\buv sync\b/.test(instruction)) return { weight: RUN_WEIGHT, done: 0, uv: { downloading: 0, downloaded: 0 } }
	if (/^RUN\s/i.test(instruction)) return { weight: RUN_WEIGHT, done: 0 }
	if (/^COPY\s+--from=/i.test(instruction)) return { weight: STAGE_COPY_WEIGHT, done: 0 }
	if (/^(COPY|ADD)\s/i.test(instruction)) return { weight: COPY_WEIGHT, done: 0 }
	return { weight: SETTING_WEIGHT, done: 0 }
}

/** Each stage's build steps, keyed as Podman numbers them: `stage/step`, both from 1.
 * An update changes only what the stages copy, so Podman reuses every step before a
 * stage's first copy; those steps are held until they do work instead.
 */
function planSteps(dockerfile: string, updating: boolean): Map<string, Step> {
	const steps = new Map<string, Step>()
	let stage = 0
	let index = 0
	let copied = false
	// Continuation lines join into their instruction, so a long RUN reads as one.
	for (const line of dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
		const instruction = line.trim()
		if (!instruction || instruction.startsWith("#")) continue
		if (/^FROM\s/i.test(instruction)) {
			stage++
			index = 0
			copied = false
		}
		if (stage === 0) continue
		index++
		const step = plannedStep(instruction)
		if (/^(COPY|ADD)\s/i.test(instruction)) {
			copied = true
		} else if (updating && !copied && step.held === undefined) {
			step.held = step.weight
			step.weight = 0
		}
		steps.set(`${stage}/${index}`, step)
	}
	return steps
}

const stepLine = /^\[(\d+)\/\d+\] STEP (\d+)\/\d+: (.+)$/
const commitLine = /^\[\d+\/\d+\] COMMIT\b/
const cacheLine = /^--> Using cache\b/
const finishLine = /^--> [0-9a-f]+$/
const blobLine = /^Copying blob (?:sha256:)?([0-9a-f]+)/

/** Feed raw build output in arbitrary chunks; `fraction` only rises, from 0 to 1. */
export class BuildProgress {
	private partial = ""
	private readonly steps: Map<string, Step>
	private readonly exporting: Step = { weight: EXPORT_WEIGHT, done: 0 }
	private current?: Step
	fraction = 0

	/** `updating` when Podman's cache holds an image of an earlier version. */
	constructor(dockerfile: string, updating: boolean) {
		this.steps = planSteps(dockerfile, updating)
	}

	push(chunk: string): number {
		const lines = (this.partial + chunk).split(/\r?\n/)
		this.partial = lines.pop() ?? ""
		for (const line of lines) this.read(line.trim())
		this.fraction = Math.max(this.fraction, this.estimate())
		return this.fraction
	}

	private read(line: string): void {
		const step = stepLine.exec(line)
		if (step) {
			const [, stage, index, instruction] = step
			const key = `${stage}/${index}`
			// A step the Dockerfile did not plan still counts once announced.
			const known = this.steps.get(key) ?? plannedStep(instruction)
			this.steps.set(key, known)
			this.begin(known)
			return
		}
		if (commitLine.test(line)) {
			this.begin(this.exporting)
			return
		}
		if (cacheLine.test(line)) {
			if (this.current) {
				this.current.weight = 0
				this.current.held = undefined
			}
			return
		}
		// Any other output shows that a held step does its work after all.
		if (this.current?.held !== undefined) {
			this.current.weight = this.current.held
			this.current.held = undefined
		}
		if (finishLine.test(line)) {
			if (this.current) this.current.done = 1
			return
		}
		const blob = blobLine.exec(line)
		if (blob && this.current?.layers) {
			this.readLayer(this.current, blob[1])
			return
		}
		if (this.current?.apt !== undefined) this.readApt(this.current, line)
		if (this.current?.uv) this.readUv(this.current, line)
	}

	/** A step's start ends the one before it. */
	private begin(step: Step): void {
		if (this.current) this.current.done = 1
		this.current = step
	}

	private readApt(step: Step, text: string): void {
		const planned = /^(\d+) upgraded, (\d+) newly installed/.exec(text)
		if (planned) {
			step.apt = { total: Number(planned[1]) + Number(planned[2]), fetched: 0, installed: 0 }
		} else if (step.apt && /^Get:\d+ /.test(text)) {
			step.apt.fetched++
		} else if (step.apt && /^(Unpacking|Setting up) /.test(text)) {
			step.apt.installed++
		} else {
			return
		}
		// Refreshing the package lists took 9% of the measured step, downloading 31%,
		// unpacking with set-up 39% and writing the layer the rest; each package is
		// unpacked, then set up.
		const { total, fetched, installed } = step.apt
		if (total === 0) return
		const share = 0.09 + 0.31 * Math.min(1, fetched / total) + 0.39 * Math.min(1, installed / (2 * total))
		step.done = Math.max(step.done, Math.min(0.99, share))
	}

	// In the measured `uv sync`, resolving ended at 5% of the step, downloading at 42%,
	// installing at 46% and compiling at 55%; writing its layer took the rest.
	private readUv(step: Step, text: string): void {
		const uv = step.uv!
		let share: number
		if (/^Resolved \d+ packages/.test(text)) {
			share = 0.05
		} else if (/^Downloading /.test(text)) {
			uv.downloading++
			return
		} else if (/^Downloaded /.test(text)) {
			uv.downloaded++
			share = 0.05 + 0.37 * Math.min(1, uv.downloaded / uv.downloading)
		} else if (/^Prepared \d+ packages/.test(text)) {
			share = 0.42
		} else if (/^Installed \d+ packages/.test(text)) {
			share = 0.46
		} else if (/^Bytecode compiled /.test(text)) {
			share = 0.55
		} else {
			return
		}
		step.done = Math.max(step.done, share)
	}

	/** Without a terminal, Podman names each layer once as it starts copying and again once it is done. */
	private readLayer(step: Step, digest: string): void {
		const layers = step.layers!
		layers.set(digest, layers.has(digest))
		const finished = [...layers.values()].filter(Boolean).length
		step.done = Math.max(step.done, Math.min(0.99, 0.1 + 0.9 * finished / layers.size))
	}

	private estimate(): number {
		let total = this.exporting.weight
		let done = this.exporting.weight * this.exporting.done
		for (const step of this.steps.values()) {
			total += step.weight
			done += step.weight * step.done
		}
		return done / total
	}
}
