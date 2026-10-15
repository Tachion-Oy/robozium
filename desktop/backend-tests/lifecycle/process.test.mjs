import assert from "node:assert/strict"
import { test } from "node:test"
import process from "node:process"
import { runCommand } from "../../dist/backend-process.js"

const options = () => ({ cwd: process.cwd(), env: {}, signal: new globalThis.AbortController().signal })
test("command output is bounded, stderr stays out of JSON, and arguments never enter a shell", async () => {
	let logs = ""
	const output = await runCommand(process.execPath, ["-e", 'process.stdout.write("x".repeat(1100000)); process.stderr.write("diagnostic")'], { ...options(), log: text => { logs += text } })
	assert.equal(output.length, 1024 * 1024)
	assert.ok(logs.includes("diagnostic"))
	assert.equal(await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(echo unsafe); `id`"], options()), "$(echo unsafe); `id`")
})

test("failed and missing commands return safe messages", async () => {
	await assert.rejects(runCommand(process.execPath, ["-e", 'console.error("private detail"); process.exit(7)'], options()), /Docker command failed/)
	await assert.rejects(runCommand("/does-not-exist/docker", [], options()), /Could not execute Docker/)
})

test("timeouts terminate a running command", async () => {
	await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...options(), timeout: 100 }), /timed out/)
})

test("cancellation waits for a stubborn process to be killed", async () => {
	const abort = new globalThis.AbortController()
	let pid
	const command = runCommand(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); console.log(process.pid); setInterval(() => {}, 1000)'], {
		...options(), signal: abort.signal, log: text => { pid = Number(text.trim()); abort.abort() },
	})
	await assert.rejects(command, /cancelled/)
	assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
	await assert.rejects(runCommand(process.execPath, [], { ...options(), signal: abort.signal }), /cancelled/)
})

test("log failures terminate the process without an uncaught exception", async () => {
	await assert.rejects(runCommand(process.execPath, ["-e", 'console.log("output"); setInterval(() => {}, 1000)'], {
		...options(), log: () => { throw new Error("disk full") },
	}), /Could not write the desktop Docker log/)
})
