// Estimates how far a backend image build has come from BuildKit's plain output, which
// Compose writes when its output is not a terminal. Steps announce themselves as
// `#11 [api 3/6] RUN …`, write output as `#11 4.603 …`, and end with `#11 DONE 75.6s`
// or `#11 CACHED`. The Dockerfile gives every step's weight before BuildKit announces
// it. The package installation takes most of a fresh build, so its step advances with
// apt's own download, unpack and set-up counts.

interface Step {
	weight: number
	/** 0–1 within the step. */
	done: number
	/** apt's package counts, for the step that installs packages; null until apt plans. */
	apt?: { total: number; fetched: number; installed: number } | null
}

// Shares measured in a fresh build: the package step took 75 s of about 90 s, the
// other RUN steps about 5 s each, writing the image 7.6 s, and copies almost nothing.
const PACKAGES_WEIGHT = 30
const RUN_WEIGHT = 2
const EXPORT_WEIGHT = 3
const QUICK_WEIGHT = 0.3

const installsPackages = (instruction: string) => /^RUN\b.*\bapt-get install\b/.test(instruction)

function plannedStep(instruction: string): Step {
	if (installsPackages(instruction)) return { weight: PACKAGES_WEIGHT, done: 0, apt: null }
	return { weight: instruction.startsWith("RUN ") ? RUN_WEIGHT : QUICK_WEIGHT, done: 0 }
}

/**
 * Each stage's build steps, keyed as BuildKit numbers them: `stage/index`. Stages that
 * begin with the same instructions share those steps, as BuildKit runs them once.
 */
function planSteps(dockerfile: string): Map<string, Step> {
	const steps = new Map<string, Step>()
	const byPrefix = new Map<string, Step>()
	let stage = ""
	let prefix: string[] = []
	// Continuation lines join into their instruction, so a long RUN reads as one.
	for (const instruction of dockerfile.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
		const from = /^FROM\s+(\S+)(?:\s+AS\s+([\w.-]+))?/i.exec(instruction)
		if (from) {
			stage = from[2] ?? ""
			prefix = []
		}
		if (!/^(FROM|RUN|COPY|ADD|WORKDIR)\s/i.test(instruction)) continue
		prefix.push(from ? `FROM ${from[1]}` : instruction)
		const key = prefix.join("\n")
		const step = byPrefix.get(key) ?? plannedStep(instruction)
		byPrefix.set(key, step)
		steps.set(`${stage}/${prefix.length}`, step)
	}
	return steps
}

const stepLine = /^#(\d+) \[(?:[\w.-]+ )*?([\w.-]+) (\d+)\/\d+\] (.+)$/
const exportLine = /^#(\d+) (?:\[[^\]]*\] )?exporting to image$/
const finishLine = /^#(\d+) (?:DONE \S+|CACHED)$/
const outputLine = /^#(\d+) [\d.]+ (.*)$/

/** Feed raw build output in arbitrary chunks; `fraction` only rises, from 0 to 1. */
export class BuildProgress {
	private partial = ""
	private readonly steps: Map<string, Step>
	private readonly vertices = new Map<string, Step>()
	private readonly exporting: Step = { weight: EXPORT_WEIGHT, done: 0 }
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
			const [, vertex, stage, index, instruction] = step
			const key = `${stage}/${index}`
			// A step the Dockerfile did not plan still counts once announced.
			const known = this.steps.get(key) ?? plannedStep(instruction)
			this.steps.set(key, known)
			this.vertices.set(vertex, known)
			return
		}
		const exporting = exportLine.exec(line)
		if (exporting) {
			this.vertices.set(exporting[1], this.exporting)
			return
		}
		const finished = finishLine.exec(line)
		if (finished) {
			const finishedStep = this.vertices.get(finished[1])
			if (finishedStep) finishedStep.done = 1
			return
		}
		const output = outputLine.exec(line)
		const outputStep = output && this.vertices.get(output[1])
		if (outputStep && outputStep.apt !== undefined) this.readApt(outputStep, output[2])
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

	private estimate(): number {
		let total = this.exporting.weight
		let done = this.exporting.weight * this.exporting.done
		for (const step of new Set(this.steps.values())) {
			total += step.weight
			done += step.weight * step.done
		}
		return done / total
	}
}
