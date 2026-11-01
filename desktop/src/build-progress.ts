// Estimates how far a backend image build has come from Podman's plain build output.
// Each step announces itself as `[2/2] STEP 4/14: RUN …`, writes its output as plain
// lines, and ends when the next step, `[2/2] COMMIT …` or a `--> <id>` line follows.
// The Dockerfile gives every step's weight before Podman announces it. The package
// installation takes most of a fresh build, so its step advances with apt's own
// download, unpack and set-up counts. A base image pull advances as its layers finish
// copying.

interface Step {
	weight: number
	/** 0–1 within the step. */
	done: number
	/** apt's package counts, for the step that installs packages; null until apt plans. */
	apt?: { total: number; fetched: number; installed: number } | null
	/** The base image's layers by digest, and whether each has finished; empty while the image is local. */
	layers?: Map<string, boolean>
}

// Shares measured in a fresh build: the package step took 75 s of about 90 s, the
// other RUN steps about 5 s each, writing the image 7.6 s, and copies almost nothing.
const PACKAGES_WEIGHT = 30
const RUN_WEIGHT = 2
const EXPORT_WEIGHT = 3
const QUICK_WEIGHT = 0.3
// Instructions such as ENV or LABEL only record settings.
const SETTING_WEIGHT = 0.05
// Not measured: the slim Python base is about 45 MB, roughly 15 s on a typical
// connection. The first FROM of each base plans for a pull, so the total stays
// fixed while layers arrive; a local base finishes it at once.
const PULL_WEIGHT = 6

const installsPackages = (instruction: string) => /^RUN\b.*\bapt-get install\b/.test(instruction)

function plannedStep(instruction: string): Step {
	if (installsPackages(instruction)) return { weight: PACKAGES_WEIGHT, done: 0, apt: null }
	if (/^FROM\s/i.test(instruction)) return { weight: QUICK_WEIGHT, done: 0, layers: new Map() }
	if (/^RUN\s/i.test(instruction)) return { weight: RUN_WEIGHT, done: 0 }
	if (/^(COPY|ADD|WORKDIR)\s/i.test(instruction)) return { weight: QUICK_WEIGHT, done: 0 }
	return { weight: SETTING_WEIGHT, done: 0 }
}

/** Each stage's build steps, keyed as Podman numbers them: `stage/step`, both from 1. */
function planSteps(dockerfile: string): Map<string, Step> {
	const steps = new Map<string, Step>()
	const bases = new Set<string>()
	let stage = 0
	let index = 0
	// Continuation lines join into their instruction, so a long RUN reads as one.
	for (const line of dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
		const instruction = line.trim()
		if (!instruction || instruction.startsWith("#")) continue
		if (/^FROM\s/i.test(instruction)) {
			stage++
			index = 0
		}
		if (stage === 0) continue
		index++
		const step = plannedStep(instruction)
		const base = /^FROM\s+(\S+)/i.exec(instruction)?.[1]
		if (base && !bases.has(base)) step.weight = PULL_WEIGHT
		if (base) bases.add(base)
		steps.set(`${stage}/${index}`, step)
	}
	return steps
}

const stepLine = /^\[(\d+)\/\d+\] STEP (\d+)\/\d+: (.+)$/
const commitLine = /^\[\d+\/\d+\] COMMIT\b/
const finishLine = /^--> [0-9a-f]+$/
const blobLine = /^Copying blob (?:sha256:)?([0-9a-f]+)/

/** Feed raw build output in arbitrary chunks; `fraction` only rises, from 0 to 1. */
export class BuildProgress {
	private partial = ""
	private readonly steps: Map<string, Step>
	private readonly exporting: Step = { weight: EXPORT_WEIGHT, done: 0 }
	private current?: Step
	fraction = 0

	constructor(dockerfile: string) {
		this.steps = planSteps(dockerfile)
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
		// Refreshing the package lists took 6% of the measured step, downloading 7%,
		// and unpacking with set-up the rest; each package is unpacked, then set up.
		const { total, fetched, installed } = step.apt
		if (total === 0) return
		const share = 0.06 + 0.07 * Math.min(1, fetched / total) + 0.87 * Math.min(1, installed / (2 * total))
		step.done = Math.max(step.done, Math.min(0.99, share))
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
