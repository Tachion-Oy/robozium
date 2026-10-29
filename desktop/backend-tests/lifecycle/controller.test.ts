import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"
import process from "node:process"
import { test, type TestContext } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { BackendController, portAvailable } from "../../src/backend-controller.ts"
import { loadOrCreateBackendProfile } from "../../src/backend-profile.ts"
import { resolveBackendLayout } from "../../src/backend-layout.ts"
import type { CommandOptions } from "../../src/docker-command.ts"
import type { BackendStatus } from "../../src/bridge.d.ts"

type ControllerOptions = ConstructorParameters<typeof BackendController>[0]
interface Inspection {
	labels: Record<string, string>
	mounts: { Source: string; Destination: string; RW: boolean }[]
	running: boolean
}
/** The fake Docker's state, and the overrides a test starts it with. */
interface FakeDocker {
	exists: boolean
	running: boolean
	cached: string
	ready: boolean
	available: boolean
	calls: { args: string[]; command: CommandOptions }[]
	restarts?: number
	security?: string
	version?: string
	logs?: string
	intercept?: (args: string[], command: CommandOptions) => Promise<string | void>
	mutate?: (value: Inspection) => void
}
type FixtureOptions = Partial<FakeDocker> & { hub?: string; controller?: Partial<ControllerOptions> }

const id = "a".repeat(64)
const hash = "b".repeat(64)
function fixture(t: TestContext, options: FixtureOptions = {}) {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-controller-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const profile = path.join(directory, "profile"), source = path.join(directory, "source")
	mkdirSync(source)
	writeFileSync(path.join(source, "build-id.json"), JSON.stringify({ id: hash }))
	const settings = loadOrCreateBackendProfile(profile, "mock")
	const state: FakeDocker = { exists: false, running: false, cached: hash, ready: true, available: true, calls: [], ...options }
	const layout = resolveBackendLayout(settings.runtime, options.hub)
	const inspection = (): Inspection => ({
		labels: { "com.docker.compose.project": settings.project, "com.docker.compose.service": "api",
			"fi.tachion.robozium.desktop.installation": settings.installation, "fi.tachion.robozium.desktop.port": String(settings.port) },
		mounts: layout.mounts.map(mount => ({ Source: mount.source, Destination: mount.destination, RW: mount.writable })),
		running: state.running,
	})
	const run = async (executable: string, args: string[], command: CommandOptions) => {
		assert.equal(executable, "/test/docker")
		command.signal.throwIfAborted()
		state.calls.push({ args, command })
		if (state.intercept) {
			const result = await state.intercept(args, command)
			if (result !== undefined) return result
		}
		if (args[0] === "context") return "test-context"
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
		if (args[0] === "logs") return state.logs ?? ""
		throw new Error(`Unexpected Docker command: ${args.join(" ")}`)
	}
	const controller = new BackendController({ profile, source, compose: path.join(directory, "compose.yaml"), mode: "mock",
		run, findDocker: () => "/test/docker", checkPort: async () => state.available,
		fetch: async url => { assert.equal(url, "http://127.0.0.1:18000/ready"); return new globalThis.Response(JSON.stringify({ status: state.ready ? "ready" : "starting" })) },
		readinessTimeout: 30, pollInterval: 1, ...options.controller })
	return { controller, state, settings, source, profile }
}
const commands = (state: FakeDocker) => state.calls.map(call => call.args)
const noMutation = (state: FakeDocker) => assert.equal(commands(state).some(args => ["stop", "rm"].includes(args[0]) || args.includes("up") || args.includes("build")), false)

test("profile keeps one identity across modes and takes ports only from the override", t => {
	const { profile, settings } = fixture(t)
	assert.equal(loadOrCreateBackendProfile(profile, "live").installation, settings.installation)
	assert.equal(loadOrCreateBackendProfile(profile, "live").port, 18001)
	assert.equal(loadOrCreateBackendProfile(profile, "mock", "24000").port, 24000)
	for (const port of ["", "0", "1023", "65536", "1.5", "bad"]) assert.throws(() => loadOrCreateBackendProfile(profile, "live", port), /API port/)
	writeFileSync(path.join(profile, "backend-installation-id"), "not-an-id\n")
	assert.throws(() => loadOrCreateBackendProfile(profile, "mock"), /ownership/)
})

test("settings.json is UI preferences only and never configures the backend", t => {
	const { profile, settings } = fixture(t)
	const file = path.join(profile, "settings.json")
	for (const content of [
		JSON.stringify({ theme: "light" }),
		// Keys the experiment kept here no longer select an identity or a port.
		JSON.stringify({ installationId: "abcdefabcdef", ports: { live: { api: 23001 } }, theme: "light" }),
		"not json",
	]) {
		writeFileSync(file, content)
		const live = loadOrCreateBackendProfile(profile, "live")
		assert.deepEqual([live.installation, live.port], [settings.installation, 18001])
		assert.equal(readFileSync(file, "utf8"), content)
	}
})

for (const [name, setup, error] of [
	["missing Docker", { controller: { findDocker: () => undefined } }, /Docker was not found/],
	["old Compose", { version: "2.23.0" }, /v2.24/],
	["missing Compose", { intercept: async args => { if (args[1] === "version") throw new Error("missing plugin") } }, /Compose is unavailable/],
	["unavailable daemon", { intercept: async args => { if (args[0] === "info") throw new Error("offline") } }, /Docker is unavailable/],
	["occupied port", { available: false }, /already in use/],
] as [string, FixtureOptions, RegExp][]) test(`${name} reports an actionable error and leaves containers alone`, async t => {
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
			else if (mismatch === "readonly") value.mounts.at(-1)!.RW = true
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
	assert.equal(state.calls.at(-1)!.command.signal?.aborted, false)
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

for (const [image, stage] of [["old-source-hash", "updating"], [undefined, undefined]] as const) test(`a build ${stage ? "after an update reads Updating" : "on a first launch does not read Updating"}`, async t => {
	const statuses: BackendStatus[] = []
	const { controller } = fixture(t, { cached: "",
		intercept: async (args, command) => {
			if (args[0] === "image") {
				if (image === undefined) throw new Error("No such image")
				return image
			}
			if (!args.includes("build")) return
			command.log?.("#8 [api 1/6] FROM docker.io/library/python:3.13-slim-bookworm\n#8 DONE 0.1s\n")
			statuses.push(controller.snapshot())
		} })
	await controller.start()
	assert.equal(statuses.length, 1)
	assert.equal(statuses[0].stage, stage)
	assert.ok(statuses[0].progress! > 0 && statuses[0].progress! < 1)
	await controller.close()
})

test("build output flushed after shutdown aborts startup leaves the status alone", async t => {
	let reached = () => {}
	const started = new Promise<void>(resolve => { reached = resolve })
	let flush = () => {}
	const { controller } = fixture(t, { cached: "",
		intercept: async (args, command) => {
			if (!args.includes("build")) return
			flush = () => command.log?.("#8 [api 1/6] FROM docker.io/library/python:3.13-slim-bookworm\n#8 DONE 0.1s\n")
			reached()
			return new Promise((_resolve, reject) => command.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
		} })
	const rejected = assert.rejects(controller.start(), /cancel/)
	await started
	const before = controller.snapshot()
	const closed = controller.close()
	flush()
	await closed
	await rejected
	assert.deepEqual(controller.snapshot(), before)
})

for (const phase of ["build", "up", "readiness"]) test(`closing during ${phase} cancels startup, waits, and uses a fresh cleanup signal`, async t => {
	let reached = () => {}
	const started = new Promise<void>(resolve => { reached = resolve })
	const { controller, state } = fixture(t, { cached: phase === "build" ? "" : hash,
		intercept: async (args, command) => {
			if (!args.includes(phase)) return
			reached()
			return new Promise((_resolve, reject) => command.signal?.addEventListener("abort", () => {
				state.exists = true // Compose may have created a container just before cancellation.
				reject(new Error("cancelled"))
			}, { once: true }))
		}, controller: phase === "readiness" ? { fetch: async (_url, init) => {
			reached()
			return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
		} } : {} })
	const rejected = assert.rejects(controller.start(), /cancel|abort/i)
	await started
	await controller.close()
	await rejected
	assert.equal(commands(state).at(-1)![0], "stop")
	assert.equal(state.calls.at(-1)!.command.signal?.aborted, false)
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
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
	t.after(() => server.close())
	assert.equal(await portAvailable((server.address() as net.AddressInfo).port), false)
})

test("inherited Compose and Robozium overrides cannot change managed ownership", async t => {
	const originals = { ...process.env }
	Object.assign(process.env, { COMPOSE_PROJECT_NAME: "foreign", COMPOSE_FILE: "/foreign.yaml", ROBOZIUM_DESKTOP_RUNTIME: "/foreign", ROBOZIUM_DESKTOP_HUB: "/foreign", ROBOZIUM_MODE: "live" })
	t.after(() => {
		for (const name of ["COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "ROBOZIUM_DESKTOP_RUNTIME", "ROBOZIUM_DESKTOP_HUB", "ROBOZIUM_MODE"]) {
			if (originals[name] === undefined) delete process.env[name]
			else process.env[name] = originals[name]
		}
	})
	const { controller, state, settings } = fixture(t)
	await controller.start()
	const command = state.calls.find(call => call.args.includes("up"))
	assert.ok(command)
	assert.equal(command.command.env.COMPOSE_PROJECT_NAME, undefined)
	assert.equal(command.command.env.COMPOSE_FILE, undefined)
	assert.equal(command.command.env.ROBOZIUM_DESKTOP_RUNTIME, settings.runtime)
	assert.equal(command.command.env.ROBOZIUM_DESKTOP_HUB, path.join(settings.runtime, "hub"), "without a hub folder the runtime keeps its own hub")
	assert.equal(command.command.env.ROBOZIUM_MODE, "mock")
	assert.equal(command.args[command.args.indexOf("--project-name") + 1], settings.project)
	assert.equal(command.args[command.args.indexOf("--env-file") + 1], path.join(settings.runtime, ".runtime/compose.env"))
	await controller.close()
})

test("a backend that exits during startup reports its own error instead of waiting for the timeout", async t => {
	const { controller, state } = fixture(t, { ready: false, controller: { readinessTimeout: 60_000 },
		logs: "Traceback (most recent call last):\n  File \"x\"\nValueError: Unexpected folders in sandbox root /hub: misplaced\n\nERROR:    Application startup failed. Exiting.\n" })
	state.intercept = async args => { if (args.includes("up")) { state.exists = true; state.running = false; return "" } }
	await assert.rejects(controller.start(), /stopped during startup: ValueError: Unexpected folders in sandbox root \/hub: misplaced/)
	await controller.close()
})

/** A recorded hub folder outside the profile, and the folder a container may still mount from before. */
function userHub(t: TestContext) {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-user-hub-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const hub = path.join(directory, "Robozium-Hub")
	mkdirSync(hub)
	const location = { file: path.join(directory, "hub-folder"), defaultFolder: path.join(directory, "unused default"), earlierFolder: path.join(directory, "earlier") }
	writeFileSync(location.file, hub + "\n")
	const previous = path.join(directory, "Previous Hub")
	const onPrevious = (value: Inspection) => {
		for (const mount of value.mounts) if (mount.Source.startsWith(hub)) mount.Source = previous + mount.Source.slice(hub.length)
	}
	return { hub, location, previous, onPrevious }
}

test("mounts the user's hub folder and recreates a stopped container that still mounts a previous one", async t => {
	const { hub, location, onPrevious } = userHub(t)
	const { controller, state } = fixture(t, { exists: true, hub, controller: { hubFolder: location },
		mutate: value => { if (!value.running) onPrevious(value) } })
	await controller.start()
	assert.equal(controller.snapshot().state, "ready")
	assert.equal(controller.hubDirectory, hub)
	const up = state.calls.find(call => call.args.includes("up"))
	assert.ok(up)
	assert.equal(up.command.env.ROBOZIUM_DESKTOP_HUB, hub)
	await controller.close()
})

test("recreates a container a crash left running on a previous hub folder", async t => {
	const { hub, location, onPrevious } = userHub(t)
	const { controller, state } = fixture(t, { exists: true, running: true, available: false, hub, controller: { hubFolder: location }, mutate: onPrevious })
	await controller.start()
	assert.equal(controller.snapshot().state, "ready")
	assert.equal(state.calls.find(call => call.args.includes("up"))?.command.env.ROBOZIUM_DESKTOP_HUB, hub)
	await controller.close()
})

for (const mismatch of ["destination", "readonly"]) test(`a hub mount's ${mismatch} is still checked`, async t => {
	const { hub, location } = userHub(t)
	const { controller, state } = fixture(t, { exists: true, hub, controller: { hubFolder: location }, mutate: value => {
		const mount = value.mounts.find(mount => mount.Destination === "/hub")
		assert.ok(mount)
		if (mismatch === "destination") mount.Destination = "/elsewhere"
		else mount.RW = false
	} })
	await assert.rejects(controller.start(), /ownership or mounts/)
	await controller.close()
	noMutation(state)
})

test("a missing hub folder stops startup before Docker and offers choosing another", async t => {
	const { hub, location } = userHub(t)
	rmSync(hub, { recursive: true })
	const { controller, state } = fixture(t, { controller: { hubFolder: location } })
	await assert.rejects(controller.start(), /missing/)
	assert.equal(controller.snapshot().action, "choose-hub-folder")
	assert.deepEqual(state.calls, [])
	assert.equal(existsSync(hub), false, "a recorded hub folder is never recreated")
	await controller.close()
})

function dockerEnvironment(t: TestContext, overrides: Record<string, string | undefined> = {}) {
	for (const name of ["DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
		const original = process.env[name]
		t.after(() => {
			if (original === undefined) delete process.env[name]
			else process.env[name] = original
		})
		if (overrides[name] === undefined) delete process.env[name]
		else process.env[name] = overrides[name]
	}
}

for (const explicit of [
	{ DOCKER_CONTEXT: "chosen-context" },
	{ DOCKER_HOST: "tcp://chosen-host:2376", DOCKER_TLS_VERIFY: "1", DOCKER_CERT_PATH: "/test/certificates" },
	{ DOCKER_CONTEXT: "chosen-context", DOCKER_HOST: "tcp://ignored-host:2376" },
]) test(`explicit Docker target survives retry and shutdown: ${Object.keys(explicit).join(", ")}`, async t => {
	const original = { DOCKER_CONFIG: "/test/docker-config", ...explicit }
	dockerEnvironment(t, original)
	const { controller, state } = fixture(t, { ready: false })
	await assert.rejects(controller.start(), /readiness timed out/)
	process.env.DOCKER_CONTEXT = "different-context"
	process.env.DOCKER_HOST = "tcp://different-host:2376"
	process.env.DOCKER_CONFIG = "/different/config"
	state.ready = true
	await controller.start()
	await controller.close()
	assert.equal(commands(state).some(args => args[0] === "context"), false)
	for (const { command } of state.calls) {
		for (const [name, value] of Object.entries(original)) assert.equal(command.env[name], value)
		if (!explicit.DOCKER_CONTEXT) assert.equal(command.env.DOCKER_CONTEXT, undefined)
	}
})

for (const result of ["", "failure"]) test(`context resolution ${result || "empty output"} fails before mutation and can retry`, async t => {
	dockerEnvironment(t)
	const { controller, state } = fixture(t, { intercept: async args => {
		if (args[0] !== "context") return
		if (result === "failure") throw new Error("context lookup failed")
		return "\n"
	} })
	await assert.rejects(controller.start(), /Could not resolve Docker's context/)
	noMutation(state)
	state.intercept = undefined
	await controller.start()
	await controller.close()
	assert.equal(state.calls.at(-1)!.command.env.DOCKER_CONTEXT, "test-context")
})

const managed = (state: FakeDocker) => async (args: string[]) => {
	if (args.includes("restart")) { state.restarts = (state.restarts ?? 0) + 1; return "" }
}

for (const [operation, expected] of [
	["restart", ["restart", "api"]],
	["recreate", ["up", "--detach", "--no-build", "--force-recreate", "--no-deps", "api"]],
] as ["restart" | "recreate", string[]][]) test(`${operation} checks ownership, runs ${expected.join(" ")} and waits until ready`, async t => {
	const { controller, state, settings } = fixture(t)
	state.intercept = managed(state)
	await assert.rejects(controller[operation](), /Start the backend/)
	await controller.start()
	const count = state.calls.length
	const pending = controller[operation]()
	assert.equal(controller.snapshot().state, "starting")
	await pending
	const calls = commands(state).slice(count)
	assert.deepEqual(calls.map(args => args[0]), ["ps", "inspect", "compose"])
	assert.deepEqual(calls[2].slice(-expected.length), expected)
	assert.equal(calls[2][calls[2].indexOf("--project-name") + 1], settings.project)
	assert.deepEqual(controller.snapshot(), { state: "ready", message: "Backend ready" })
	await controller.close()
})

test("backend operations run one at a time and shutdown waits for them", async t => {
	let release = () => {}
	const { controller, state } = fixture(t)
	await controller.start()
	state.intercept = async args => {
		if (args.includes("restart")) return new Promise(resolve => { release = () => resolve("") })
	}
	const restart = controller.restart()
	await assert.rejects(controller.recreate(), /already running/)
	await assert.rejects(controller.restart(), /already running/)
	await tick()
	const close = controller.close()
	let closed = false
	void (async () => { await close; closed = true })()
	await tick()
	assert.equal(closed, false)
	release()
	await assert.rejects(restart, /cancel|abort/i)
	await close
	assert.equal(commands(state).at(-1)![0], "stop")
	await assert.rejects(controller.restart(), /closing/)
})

test("a replaced container stops an operation before any change, and a failure can be retried", async t => {
	const { controller, state } = fixture(t)
	await controller.start()
	state.intercept = managed(state)
	state.mutate = value => { value.labels["fi.tachion.robozium.desktop.installation"] = "foreign" }
	await assert.rejects(controller.recreate(), /ownership/)
	assert.equal(controller.snapshot().state, "error")
	assert.equal(state.restarts, undefined)
	assert.equal(commands(state).filter(args => args.includes("--force-recreate")).length, 0)
	state.mutate = undefined
	await assert.rejects(controller.restart(), /Start the backend/)
	await controller.start()
	await controller.restart()
	assert.equal(state.restarts, 1)
	await controller.close()
})
