import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { test, type TestContext } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { resolveBackendLayout, type HostServiceLayout } from "../../src/backend-layout.ts"
import { HostServices } from "../../src/host-services.ts"

// A stand-in service: it listens on its socket, then behaves as its mode says.
const SERVICE = `
const net = require("node:net")
const [address, mode] = process.argv.slice(2)
if (mode === "exit") process.exit(3)
const server = net.createServer(connection => connection.end()).listen(address)
process.on("SIGTERM", () => { if (mode !== "stubborn") server.close(() => process.exit(0)) })
`

function fixture(t: TestContext, mode = "serve") {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-host-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const runtime = path.join(directory, "runtime")
	const base = resolveBackendLayout(runtime)
	for (const folder of base.directories) mkdirSync(folder, { recursive: true, mode: 0o700 })
	const script = path.join(directory, "service.cjs")
	writeFileSync(script, SERVICE)
	const address = path.join(directory, "service.sock")
	const service: HostServiceLayout = {
		name: "stand-in", platforms: ["linux"], modes: ["live"],
		endpoint: { type: "unix-socket", address },
		log: path.join(directory, "service.log"), pidFile: path.join(directory, "service.pid"),
		executable: process.execPath, arguments: [script, address, mode],
	}
	const syncs: string[][] = []
	const services = new HostServices({
		platform: "linux", findUv: () => "/test/uv", readyTimeout: 5000, restartDelay: 10, stopTimeout: 300,
		run: async (_executable, args) => { syncs.push(args); return "" },
	})
	t.after(() => services.stop())
	return { layout: { ...base, hostServices: [service] }, service, address, services, syncs }
}

const signal = new AbortController().signal

test("the layout declares safe scripts on the API's socket, the hub's scripts and the runtime's environment", () => {
	const layout = resolveBackendLayout("/profile/live", "/home/user/Hub")
	const [service] = layout.hostServices
	assert.equal(service.name, "safe-scripts")
	assert.deepEqual(service.endpoint, { type: "unix-socket", address: "/profile/live/.runtime/host-socket/scripts.sock" })
	assert.equal(service.executable, "/profile/live/.runtime/host-environment/bin/roboz")
	assert.equal(service.log, "/profile/live/.runtime/logs/safe-scripts.log")
	assert.deepEqual(service.arguments.slice(0, 8), [
		"scripts", "serve", "--socket", "/profile/live/.runtime/host-socket/scripts.sock",
		"--scripts", "/home/user/Hub/readonly/safe-scripts", "--cwd", "/home/user/Hub",
	])
})

test("a declared service starts, answers, and stops with its socket removed", async t => {
	const { layout, address, services, syncs } = fixture(t)
	await services.start(layout, "live", "/source", signal)
	assert.deepEqual(services.status(), [{ name: "stand-in", state: "running", message: "Running." }])
	assert.deepEqual(syncs, [["sync", "--project", "/source", "--locked", "--only-group", "host", "--no-install-project"]])
	await services.stop()
	assert.equal(existsSync(address), false)
})

test("other modes start nothing and other platforms report the service as unsupported", async t => {
	const { layout, services, syncs } = fixture(t)
	await services.start(layout, "mock", "/source", signal)
	assert.deepEqual(services.status(), [])
	const elsewhere = new HostServices({ platform: "darwin", findUv: () => assert.fail("uv is not needed") })
	await elsewhere.start(layout, "live", "/source", signal)
	assert.equal(elsewhere.status()[0].state, "unsupported")
	assert.deepEqual(syncs, [])
})

test("a missing uv or a failed environment is reported without throwing", async t => {
	const { layout } = fixture(t)
	const withoutUv = new HostServices({ platform: "linux", findUv: () => undefined })
	await withoutUv.start(layout, "live", "/source", signal)
	assert.match(withoutUv.status()[0].message, /need uv/)
	const failedSync = new HostServices({ platform: "linux", findUv: () => "/test/uv", run: async () => { throw new Error("offline") } })
	await failedSync.start(layout, "live", "/source", signal)
	assert.match(failedSync.status()[0].message, /Could not prepare host services. See .*host-environment\.log/)
})

test("a socket another program serves is reported, not taken over", async t => {
	const { layout, address, services } = fixture(t)
	const owner = net.createServer().listen(address)
	t.after(() => owner.close())
	await new Promise(resolve => owner.once("listening", resolve))
	await services.start(layout, "live", "/source", signal)
	assert.equal(services.status()[0].state, "failed")
	assert.match(services.status()[0].message, /Another program is serving/)
})

test("a service left running by a crashed launch is stopped before a new one starts", async t => {
	const { layout, service, address, services } = fixture(t)
	const leftover = spawn(service.executable, service.arguments, { detached: true, stdio: "ignore" })
	const exited = new Promise(resolve => leftover.once("exit", resolve))
	writeFileSync(service.pidFile, String(leftover.pid))
	while (!existsSync(address)) await delay(10)
	await services.start(layout, "live", "/source", signal)
	await exited
	assert.equal(services.status()[0].message, "Running.")
	assert.notEqual(readFileSync(service.pidFile, "utf8"), String(leftover.pid))
})

test("a socket left by a killed service is replaced", async t => {
	const { layout, address, services } = fixture(t)
	const killed = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(address)})`])
	while (!existsSync(address)) await delay(10)
	killed.kill("SIGKILL")
	await new Promise(resolve => killed.once("exit", resolve))
	assert.ok(existsSync(address))
	await services.start(layout, "live", "/source", signal)
	assert.equal(services.status()[0].message, "Running.")
})

test("a service that keeps exiting is restarted twice, then reported failed", async t => {
	const { layout, services } = fixture(t, "exit")
	await services.start(layout, "live", "/source", signal)
	for (let attempt = 0; attempt < 50 && services.status()[0].state !== "failed"; attempt++) await delay(20)
	assert.match(services.status()[0].message, /Stopped unexpectedly. See .*service\.log/)
})

test("a service that ignores SIGTERM is killed after the stop timeout", async t => {
	const { layout, services } = fixture(t, "stubborn")
	await services.start(layout, "live", "/source", signal)
	const started = Date.now()
	await services.stop()
	assert.ok(Date.now() - started >= 300)
})
