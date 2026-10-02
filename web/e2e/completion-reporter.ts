import fs from "node:fs"
import path from "node:path"
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError } from "@playwright/test/reporter"

/** A small, independent completion marker for CI result policy. */
export default class CompletionReporter implements Reporter {
	private config?: FullConfig
	private suite?: Suite
	private started = new Set<TestCase>()
	private errors: string[] = []

	onBegin(config: FullConfig, suite: Suite) {
		this.config = config
		this.suite = suite
	}

	onTestBegin(test: TestCase) {
		this.started.add(test)
	}

	onError(error: TestError) {
		this.errors.push(error.message ?? String(error.value))
	}

	onEnd(result: FullResult) {
		const tests = this.suite?.allTests() ?? []
		const outcomes = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
		for (const test of tests) outcomes[test.outcome()] += 1
		const expectedSkipped = tests.filter((test) => test.outcome() === "skipped" &&
			test.annotations.some((annotation) => annotation.type === "expected-skip" &&
				annotation.description === "requires a synthetic encrypted file")).length
		const failureLimit = this.config?.maxFailures ?? 0
		const failureLimitReached = failureLimit > 0 &&
			outcomes.unexpected + outcomes.flaky >= failureLimit &&
			outcomes.skipped > 0
		const report = {
			status: result.status,
			errors: this.errors,
			outcomes,
			total: tests.length,
			started: [...this.started].filter((test) => test.outcome() !== "skipped").length,
			expected_skipped: expectedSkipped,
			failure_limit_reached: failureLimitReached,
			stopped_early: result.status === "timedout" || result.status === "interrupted" || failureLimitReached,
		}
		const file = path.join(process.env.ROBOZIUM_E2E_REPORT_DIR!, "completion.json")
		fs.writeFileSync(file, JSON.stringify(report, null, 2))
	}
}
