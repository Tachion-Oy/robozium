import { mock } from "node:test"
import { expect, test } from "@playwright/test"
import { withDeadline } from "../renderer/src/api/request"

test.beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }))
test.afterEach(() => mock.timers.reset())

function untilAborted(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		signal.throwIfAborted()
		signal.addEventListener("abort", () => reject(signal.reason), { once: true })
	})
}

for (const outcome of ["success", "failure"] as const) {
	test(`request ${outcome} releases its deadline and preserves the result`, async () => {
		const owner = new AbortController()
		const failure = new Error("Backend rejected the request")
		let received!: AbortSignal
		const pending = withDeadline(owner.signal, async signal => {
			received = signal
			if (outcome === "failure") throw failure
			return "result"
		})
		if (outcome === "success") await expect(pending).resolves.toBe("result")
		else await expect(pending).rejects.toBe(failure)
		mock.timers.tick(10_000)
		expect(received.aborted).toBe(false)
		expect(owner.signal.aborted).toBe(false)
	})
}

test("the default deadline aborts only the operation after ten seconds", async () => {
	const owner = new AbortController()
	let received!: AbortSignal
	const pending = withDeadline(owner.signal, signal => { received = signal; return untilAborted(signal) })
	const rejected = expect(pending).rejects.toThrow("Request timed out. Check the backend before trying again.")
	mock.timers.tick(9999)
	expect(received.aborted).toBe(false)
	mock.timers.tick(1)
	await rejected
	expect(received.aborted).toBe(true)
	expect(owner.signal.aborted).toBe(false)
})

test("owner cancellation keeps its original reason instead of becoming a timeout", async () => {
	const owner = new AbortController()
	const reason = new Error("View disposed")
	const pending = withDeadline(owner.signal, untilAborted)
	owner.abort(reason)
	await expect(pending).rejects.toBe(reason)
})

for (const cancelled of [false, true]) {
	test(`late success after a custom deadline is rejected${cancelled ? " with the owner's cancellation reason" : " as a timeout"}`, async () => {
		const owner = new AbortController()
		const reason = new Error("Session replaced")
		let finish!: (value: string) => void
		const pending = withDeadline(owner.signal, () => new Promise<string>(resolve => { finish = resolve }), 3000)
		mock.timers.tick(3000)
		if (cancelled) owner.abort(reason)
		finish("obsolete result")
		if (cancelled) await expect(pending).rejects.toBe(reason)
		else await expect(pending).rejects.toThrow("Request timed out")
	})
}

test("an already cancelled owner cannot start an operation", async () => {
	const owner = new AbortController()
	const reason = new Error("Already disposed")
	owner.abort(reason)
	let called = false
	await expect(withDeadline(owner.signal, async () => { called = true })).rejects.toBe(reason)
	expect(called).toBe(false)
})
