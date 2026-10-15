import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"
import process from "node:process"
import { test } from "node:test"
import { BackendController, portAvailable } from "../../dist/backend-controller.js"
import { backendProfile } from "../../dist/backend-profile.js"

const id = "a".repeat(64)
const hash = "b".repeat(64)
function fixture(t, options = {}) {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-controller-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const profile = path.join(directory, "profile"), source = path.join(directory, "source")
	mkdirSync(source)
	writeFileSync(path.join(source, "build-id.json"), JSON.stringify({ id: hash }))
	const settings = backendProfile(profile, "mock")
	const state = { exists: false, running: false, cached: hash, ready: true, available: true, calls: [], ...options }
	const mounts = { "/configuration": "", "/hub": "hub", "/app/local": "local", "/app/.runtime/local-deps": ".runtime/local-deps",
		"/logs": ".runtime/logs", "/host-scripts": ".runtime/host-socket", "/hub/readonly/safe-scripts": "hub/readonly/safe-scripts" }
	const inspection = () => ({
		labels: { "com.docker.compose.project": settings.project, "com.docker.compose.service": "api",
			"fi.tachion.robozium.desktop.installation": settings.installation, "fi.tachion.robozium.desktop.port": String(settings.port) },
		mounts: Object.entries(mounts).map(([Destination, relative]) => ({ Destination, Source: path.join(settings.runtime, relative),
			RW: !["/host-scripts", "/hub/readonly/safe-scripts"].includes(Destination) })),
		running: state.running,
	})
	const run = async (executable, args, command) => {
		assert.equal(executable, "/test/docker")
		command.signal.throwIfAborted()
		state.calls.push({ args, command })
		if (state.intercept) {
			const result = await state.intercept(args, command)
			if (result !== undefined) return result
		}
		if (args[0] === "info") return state.security ?? '["name=seccomp"]'
		if (args[1] === "version") return state.version ?? "2.35.1"
		if (args[0] === "ps") return state.exists ? id : ""
		if (args[0] === "inspect") {
			const value = inspection()
			state.mutate?.(value)
			return JSON.stringify(value)
		}
		if (args[0] === "image") return state.cached
		if (args.includes("build")) { state.cached = hash; return "" }
		if (args.includes("up")) { state.exists = true; state.running = true; return "" }
		if (args[0] === "stop") { state.running = false; return "" }
		throw new Error(`Unexpected Docker command: ${args.join(" ")}`)
	}
	const controller = new BackendController({ profile, source, compose: path.join(directory, "compose.yaml"), mode: "mock",
		run, findDocker: () => "/test/docker", checkPort: async () => state.available,
		fetch: async url => { assert.equal(url, "http://127.0.0.1:18000/ready"); return new globalThis.Response(JSON.stringify({ status: state.ready ? "ready" : "starting" })) },
		readinessTimeout: 30, pollInterval: 1, ...options.controller })
	return { controller, state, settings, source, profile }
}
const commands = state => state.calls.map(call => call.args)
const noMutation = state => assert.equal(commands(state).some(args => ["stop", "rm"].includes(args[0]) || args.includes("up") || args.includes("build")), false)

test("profile keeps stable mode identities and imports experiment settings without rewriting them", t => {
	const { profile, settings } = fixture(t)
	assert.equal(backendProfile(profile, "live").installation, settings.installation)
	assert.equal(backendProfile(profile, "live").port, 18001)
	const file = path.join(profile, "settings.json")
	const original = JSON.stringify({ installationId: settings.installation, ports: { live: { api: 23001 }, mock: { api: 23000 } }, theme: "light", future: true })
	writeFileSync(file, original)
	assert.equal(backendProfile(profile, "live").port, 23001)
	assert.equal(backendProfile(profile, "mock", "24000").port, 24000)
	assert.equal(readFileSync(file, "utf8"), original)
	for (const port of ["", "0", "1023", "65536", "1.5", "bad"]) assert.throws(() => backendProfile(profile, "live", port), /API port/)
	writeFileSync(file, JSON.stringify({ installationId: "abcdefabcdef" }))
	assert.throws(() => backendProfile(profile, "mock"), /ownership/)
})

test("imports the experiment identity on first launch", t => {
	const { profile, settings } = fixture(t)
	rmSync(path.join(profile, "backend-installation-id"))
	writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ installationId: "abcdefabcdef" }))
	assert.equal(backendProfile(profile, "live").installation, "abcdefabcdef")
	assert.notEqual(settings.installation, "abcdefabcdef")
})

for (const [name, setup, error] of [
	["missing Docker", { controller: { findDocker: () => undefined } }, /Docker was not found/],
	["old Compose", { version: "2.23.0" }, /v2.24/],
	["missing Compose", { intercept: async args => { if (args[1] === "version") throw new Error("missing plugin") } }, /Compose is unavailable/],
	["unavailable daemon", { intercept: async args => { if (args[0] === "info") throw new Error("offline") } }, /Docker is unavailable/],
	["occupied port", { available: false }, /already in use/],
]) test(`${name} reports an actionable error and leaves containers alone`, async t => {
	const { controller, state } = fixture(t, setup)
	await assert.rejects(controller.start(), error)
	assert.equal(controller.snapshot().state, "error")
	await controller.close()
	noMutation(state)
})

for (const mismatch of ["project", "service", "installation", "port", "mount", "readonly"]) {
	test(`rejects ${mismatch} ownership mismatch before changing resources`, async t => {
		const { controller, state } = fixture(t, { exists: true, mutate: value => {
			if (mismatch === "mount") value.mounts[0].Source = "/someone-else"
			else if (mismatch === "readonly") value.mounts.at(-1).RW = true
			else value.labels[mismatch === "project" || mismatch === "service" ? `com.docker.compose.${mismatch}` : `fi.tachion.robozium.desktop.${mismatch}`] = "foreign"
		} })
		await assert.rejects(controller.start(), /ownership or mounts/)
		await controller.close()
		noMutation(state)
	})
}

test("reuses a matching image, attaches to its running API, and stops only verified IDs", async t => {
	const { controller, state, settings } = fixture(t, { exists: true, running: true, available: false })
	const pending = controller.start()
	assert.equal(controller.start(), pending)
	await pending
	assert.deepEqual(controller.snapshot(), { state: "ready", message: "Backend ready" })
	assert.equal(commands(state).some(args => args.includes("build")), false)
	const count = state.calls.length
	await controller.start()
	assert.equal(state.calls.length, count)
	writeFileSync(path.join(settings.runtime, "hub/proof.txt"), "preserved")
	const close = controller.close()
	assert.equal(controller.close(), close)
	await close
	assert.deepEqual(commands(state).at(-1), ["stop", "--time", "30", id])
	assert.equal(state.calls.at(-1).command.signal.aborted, false)
	assert.equal(readFileSync(path.join(settings.runtime, "hub/proof.txt"), "utf8"), "preserved")
	await assert.rejects(controller.start(), /closing/)
})

for (const cached of ["", "old-source-hash"]) test(`builds when the cached image identifier is ${cached || "absent"}`, async t => {
	const { controller, state } = fixture(t, { cached, security: '["name=rootless"]' })
	await controller.start()
	const build = state.calls.find(call => call.args.includes("build"))
	assert.ok(build)
	assert.equal(build.command.env.ROBOZIUM_API_USER, "0:0")
	assert.equal(build.command.env.ROBOZIUM_DESKTOP_BUILD_ID, hash)
	assert.equal(build.command.env.ROBOZIUM_MODE, "mock")
	assert.ok(commands(state).findIndex(args => args.includes("build")) < commands(state).findIndex(args => args.includes("up")))
	await controller.close()
})

test("rejects missing and malformed staged backend identifiers", async t => {
	const { controller, state, source } = fixture(t)
	rmSync(path.join(source, "build-id.json"))
	await assert.rejects(controller.start(), /files are missing/)
	writeFileSync(path.join(source, "build-id.json"), '{"id":"invalid"}')
	await assert.rejects(controller.start(), /Invalid backend build identifier/)
	await controller.close()
	noMutation(state)
})

test("readiness failure preserves data and allows retry without rebuilding", async t => {
	const { controller, state, settings } = fixture(t, { ready: false })
	await assert.rejects(controller.start(), /readiness timed out/)
	assert.equal(controller.snapshot().state, "error")
	writeFileSync(path.join(settings.runtime, "hub/proof.txt"), "retained after failure")
	state.ready = true
	await controller.start()
	assert.equal(controller.snapshot().state, "ready")
	assert.equal(commands(state).some(args => args.includes("build")), false)
	await controller.close()
	assert.equal(readFileSync(path.join(settings.runtime, "hub/proof.txt"), "utf8"), "retained after failure")
})

for (const phase of ["build", "up", "readiness"]) test(`closing during ${phase} cancels startup, waits, and uses a fresh cleanup signal`, async t => {
	let reached
	const started = new Promise(resolve => { reached = resolve })
	const { controller, state } = fixture(t, { cached: phase === "build" ? "" : hash,
		intercept: async (args, command) => {
			if (!args.includes(phase)) return
			reached()
			return new Promise((_resolve, reject) => command.signal.addEventListener("abort", () => {
				state.exists = true // Compose may have created a container just before cancellation.
				reject(new Error("cancelled"))
			}, { once: true }))
		}, controller: phase === "readiness" ? { fetch: async (_url, init) => {
			reached()
			return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
		} } : {} })
	const rejected = assert.rejects(controller.start(), /cancel|abort/i)
	await started
	await controller.close()
	await rejected
	assert.equal(commands(state).at(-1)[0], "stop")
	assert.equal(state.calls.at(-1).command.signal.aborted, false)
})

test("shutdown rechecks ownership and refuses to stop a replaced container", async t => {
	const { controller, state } = fixture(t)
	await controller.start()
	state.mutate = value => { value.labels["fi.tachion.robozium.desktop.installation"] = "foreign" }
	await assert.rejects(controller.close(), /ownership/)
	assert.equal(commands(state).some(args => args[0] === "stop"), false)
})

test("port probe detects a real occupied loopback listener", async t => {
	const server = net.createServer()
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
	t.after(() => server.close())
	assert.equal(await portAvailable(server.address().port), false)
})

test("inherited Compose and Robozium overrides cannot change managed ownership", async t => {
	const originals = { ...process.env }
	Object.assign(process.env, { COMPOSE_PROJECT_NAME: "foreign", COMPOSE_FILE: "/foreign.yaml", ROBOZIUM_DESKTOP_RUNTIME: "/foreign", ROBOZIUM_MODE: "live" })
	t.after(() => {
		for (const name of ["COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "ROBOZIUM_DESKTOP_RUNTIME", "ROBOZIUM_MODE"]) {
			if (originals[name] === undefined) delete process.env[name]
			else process.env[name] = originals[name]
		}
	})
	const { controller, state, settings } = fixture(t)
	await controller.start()
	const command = state.calls.find(call => call.args.includes("up"))
	assert.equal(command.command.env.COMPOSE_PROJECT_NAME, undefined)
	assert.equal(command.command.env.COMPOSE_FILE, undefined)
	assert.equal(command.command.env.ROBOZIUM_DESKTOP_RUNTIME, settings.runtime)
	assert.equal(command.command.env.ROBOZIUM_MODE, "mock")
	assert.equal(command.args[command.args.indexOf("--project-name") + 1], settings.project)
	assert.equal(command.args[command.args.indexOf("--env-file") + 1], path.join(settings.runtime, ".runtime/compose.env"))
	await controller.close()
})
