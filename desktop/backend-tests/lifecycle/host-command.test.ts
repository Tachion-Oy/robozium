import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { test, type TestContext } from "node:test"
import path from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import { runCommand } from "../../src/host-command.ts"

const options = () => ({ cwd: process.cwd(), env: {}, signal: new globalThis.AbortController().signal })
test("command output is bounded, stderr stays out of JSON, and arguments never enter a shell", async () => {
	let logs = ""
	const output = await runCommand(process.execPath, ["-e", 'process.stdout.write("x".repeat(1100000)); process.stderr.write("diagnostic")'], { ...options(), log: text => { logs += text } })
	assert.equal(output.length, 1024 * 1024)
	assert.ok(logs.includes("diagnostic"))
	assert.equal(await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(echo unsafe); `id`"], options()), "$(echo unsafe); `id`")
})

test("failed and missing commands return safe messages", async () => {
	await assert.rejects(runCommand(process.execPath, ["-e", 'console.error("private detail"); process.exit(7)'], options()),
		{ message: `${path.basename(process.execPath)} failed. Check the desktop container log and retry.` })
	await assert.rejects(runCommand("/does-not-exist/podman", [], options()), /Could not execute podman/)
})

test("timeouts terminate a running command", async () => {
	await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...options(), timeout: 100 }), /timed out/)
})

test("cancellation waits for a stubborn process to be killed", async () => {
	const abort = new globalThis.AbortController()
	let pid = 0
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
	}), /Could not write the desktop log/)
})

/** A stand-in app: a process of its own that arms a guard, says so, then lives until it is ended. */
async function guarded(t: TestContext, afterArming = "") {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-guard-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const marker = path.join(directory, "ran")
	const source = path.join(import.meta.dirname, "../../src/host-command.ts")
	const app = spawn(process.execPath, ["--input-type=module", "-e", `
		import { runAfterExit } from ${JSON.stringify(source)}
		const disarm = runAfterExit([["/bin/sh", "-c", 'echo ran > "$1"', "sh", ${JSON.stringify(marker)}]], process.env)
		${afterArming}
		console.log("armed")
		setInterval(() => {}, 1000)
	`], { stdio: ["ignore", "pipe", "inherit"] })
	t.after(() => app.kill("SIGKILL"))
	await new Promise(resolve => app.stdout.once("data", resolve))
	// The guard is the shell whose script names this test's marker; none is left once it was called off.
	const guard = Number(spawnSync("pgrep", ["-f", `trap.*${marker}`], { encoding: "utf8" }).stdout.trim().split("\n")[0] || 0)
	return { app, marker, guard }
}
const ran = async (marker: string, within = 3000) => {
	const deadline = Date.now() + within
	while (!existsSync(marker) && Date.now() < deadline) await delay(20)
	return existsSync(marker)
}

for (const signal of ["SIGKILL", "SIGTERM"] as const) test(`a guard runs its commands once its process is ended by ${signal}`, async t => {
	const { app, marker } = await guarded(t)
	assert.equal(await ran(marker, 200), false)
	app.kill(signal)
	assert.equal(await ran(marker), true)
})

test("a guard runs its commands after its process exits by itself", async t => {
	const { marker } = await guarded(t, "setTimeout(() => process.exit(0), 100)")
	assert.equal(await ran(marker), true)
})

test("a guard that was called off runs nothing", async t => {
	const { app, marker } = await guarded(t, "disarm()")
	app.kill("SIGKILL")
	assert.equal(await ran(marker, 500), false)
})

test("the signals that end an app do not end its guard", async t => {
	const { app, marker, guard } = await guarded(t)
	assert.ok(guard > 0)
	for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) process.kill(-guard, signal)
	assert.equal(await ran(marker, 300), false)
	process.kill(guard, 0)
	app.kill("SIGKILL")
	assert.equal(await ran(marker), true)
})
