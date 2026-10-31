import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"
import process from "node:process"
import { test, type TestContext } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { BackendController, portAvailable } from "../../src/backend-controller.ts"
import { loadOrCreateBackendProfile } from "../../src/backend-profile.ts"
import { resolveBackendLayout } from "../../src/backend-layout.ts"
import type { CommandOptions } from "../../src/host-command.ts"
import type { BackendStatus } from "../../src/bridge.d.ts"
import { PodmanEngine } from "../../src/podman-engine.ts"

type ControllerOptions = ConstructorParameters<typeof BackendController>[0]
interface Inspection {
	labels: Record<string, string>
	mounts: { Source: string; Destination: string; RW: boolean }[]
	running: boolean
}
/** The fake Podman's state, and the overrides a test starts it with. */
interface FakePodman {
	exists: boolean
	running: boolean
	cached: string
	ready: boolean
	available: boolean
	calls: { args: string[]; command: CommandOptions }[]
	/** The environment file's lines as the last `podman run` read them. */
	environment?: string
	restarts?: number
	info?: unknown
	logs?: string
	intercept?: (args: string[], command: CommandOptions) => Promise<string | void>
	mutate?: (value: Inspection) => void
}
type FixtureOptions = Partial<FakePodman> & { hub?: string; findPodman?: () => string | undefined; controller?: Partial<ControllerOptions> }
const rootless = { host: { security: { rootless: true }, idMappings: { uidmap: [{ size: 1 }, { size: 65536 }] } } }

const id = "a".repeat(64)
/** The first steps of a Podman build, as its plain output announces them. */
const BUILD_START = "[1/2] STEP 1/7: FROM docker.io/library/python:3.13-slim-bookworm AS python-deps\n[1/2] STEP 2/7: ENV UV_COMPILE_BYTECODE=1\n"
const hash = "b".repeat(64)
function fixture(t: TestContext, options: FixtureOptions = {}) {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-controller-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const profile = path.join(directory, "profile"), source = path.join(directory, "source")
	mkdirSync(source)
	writeFileSync(path.join(source, "build-id.json"), JSON.stringify({ id: hash }))
	const settings = loadOrCreateBackendProfile(profile, "mock")
	const state: FakePodman = { exists: false, running: false, cached: hash, ready: true, available: true, calls: [], ...options }
	const layout = resolveBackendLayout(settings.runtime, options.hub)
	const inspection = (): Inspection => ({
		labels: { "fi.tachion.robozium.desktop.project": settings.project, "fi.tachion.robozium.desktop.build": hash,
			"fi.tachion.robozium.desktop.installation": settings.installation, "fi.tachion.robozium.desktop.port": String(settings.port) },
		mounts: layout.mounts.map(mount => ({ Source: mount.source, Destination: mount.destination, RW: mount.writable })),
		running: state.running,
	})
	const run = async (executable: string, args: string[], command: CommandOptions) => {
		assert.equal(executable, "/test/podman")
		command.signal.throwIfAborted()
		state.calls.push({ args, command })
		if (state.intercept) {
			const result = await state.intercept(args, command)
			if (result !== undefined) return result
		}
		if (args[0] === "info") return JSON.stringify(state.info ?? rootless)
		if (args[0] === "ps") return state.exists ? id : ""
		if (args[0] === "container" && args[1] === "inspect") {
			const value = inspection()
			state.mutate?.(value)
			return JSON.stringify(value)
		}
		if (args[0] === "image") {
			if (!state.cached) throw new Error("No such image")
			return state.cached
		}
		if (args[0] === "build") { state.cached = hash; return "" }
		if (args[0] === "run") {
			const file = args[args.indexOf("--env-file") + 1]
			assert.equal(statSync(file).mode & 0o777, 0o600)
			state.environment = readFileSync(file, "utf8")
			state.exists = true
			state.running = true
			return ""
		}
		if (args[0] === "stop") { state.running = false; return "" }
		if (args[0] === "rm") { state.exists = false; return "" }
		if (args[0] === "logs") return state.logs ?? ""
		throw new Error(`Unexpected Podman command: ${args.join(" ")}`)
	}
	const engine = new PodmanEngine({ run, findPodman: options.findPodman ?? (() => "/test/podman") })
	const controller = new BackendController({ profile, source, mode: "mock", engine, checkPort: async () => state.available,
		fetch: async url => { assert.equal(url, "http://127.0.0.1:18000/ready"); return new globalThis.Response(JSON.stringify({ status: state.ready ? "ready" : "starting" })) },
		readinessTimeout: 30, pollInterval: 1, ...options.controller })
	return { controller, state, settings, source, profile }
}
const commands = (state: FakePodman) => state.calls.map(call => call.args)
const noMutation = (state: FakePodman) => assert.equal(commands(state).some(args => ["stop", "rm", "run", "build", "restart"].includes(args[0])), false)
const runCall = (state: FakePodman) => state.calls.find(call => call.args[0] === "run")

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
	["missing Podman", { findPodman: () => undefined }, /Podman was not found/],
	["unavailable Podman", { intercept: async args => { if (args[0] === "info") throw new Error("broken storage") } }, /Podman is unavailable/],
	["root Podman", { info: { host: { security: { rootless: false } } } }, /runs as root/],
	["missing subordinate IDs", { info: { host: { security: { rootless: true }, idMappings: { uidmap: [{ size: 1 }] } } } }, /subordinate user IDs/],
	["occupied port", { available: false }, /already in use/],
] as [string, FixtureOptions, RegExp][]) test(`${name} reports an actionable error and leaves containers alone`, async t => {
	const { controller, state } = fixture(t, setup)
	await assert.rejects(controller.start(), error)
	assert.equal(controller.snapshot().state, "error")
	await controller.close()
	noMutation(state)
})

for (const mismatch of ["project", "installation", "port", "mount", "readonly"]) {
	test(`rejects ${mismatch} ownership mismatch before changing resources`, async t => {
		const { controller, state } = fixture(t, { exists: true, mutate: value => {
			if (mismatch === "mount") value.mounts[0].Source = "/someone-else"
			else if (mismatch === "readonly") value.mounts.at(-1)!.RW = true
			else value.labels[`fi.tachion.robozium.desktop.${mismatch}`] = "foreign"
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
	assert.equal(commands(state).some(args => ["build", "run", "rm"].includes(args[0])), false)
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
	const { controller, state, settings, source } = fixture(t, { cached })
	await controller.start()
	const build = commands(state).find(args => args[0] === "build")
	assert.deepEqual(build, ["build", "--target", "api", "--tag", `localhost/${settings.project}-api`, "--build-arg", `ROBOZIUM_DESKTOP_BUILD_ID=${hash}`, source])
	assert.ok(commands(state).findIndex(args => args[0] === "build") < commands(state).findIndex(args => args[0] === "run"))
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
	assert.equal(commands(state).some(args => args[0] === "build"), false)
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
			if (args[0] !== "build") return
			command.log?.(BUILD_START)
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
			if (args[0] !== "build") return
			flush = () => command.log?.(BUILD_START)
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

for (const phase of ["build", "run", "readiness"]) test(`closing during ${phase} cancels startup, waits, and uses a fresh cleanup signal`, async t => {
	let reached = () => {}
	const started = new Promise<void>(resolve => { reached = resolve })
	const { controller, state } = fixture(t, { cached: phase === "build" ? "" : hash,
		intercept: async (args, command) => {
			if (args[0] !== phase) return
			reached()
			return new Promise((_resolve, reject) => command.signal?.addEventListener("abort", () => {
				state.exists = true // Podman may have created a container just before cancellation.
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

test("inherited Robozium and remote Podman settings cannot change ownership or the engine's target", async t => {
	const names = ["ROBOZIUM_DESKTOP_RUNTIME", "ROBOZIUM_DESKTOP_HUB", "ROBOZIUM_MODE", "CONTAINER_HOST", "CONTAINER_CONNECTION"]
	const originals = Object.fromEntries(names.map(name => [name, process.env[name]]))
	Object.assign(process.env, { ROBOZIUM_DESKTOP_RUNTIME: "/foreign", ROBOZIUM_DESKTOP_HUB: "/foreign", ROBOZIUM_MODE: "live",
		CONTAINER_HOST: "ssh://foreign/run/podman.sock", CONTAINER_CONNECTION: "foreign" })
	t.after(() => {
		for (const name of names) {
			if (originals[name] === undefined) delete process.env[name]
			else process.env[name] = originals[name]
		}
	})
	const { controller, state, settings } = fixture(t)
	await controller.start()
	for (const { command } of state.calls) for (const name of names) assert.equal(command.env[name], undefined)
	const run = runCall(state)
	assert.ok(run)
	assert.equal(run.args[run.args.indexOf("--name") + 1], `${settings.project}-api`)
	assert.ok(run.args.includes(`fi.tachion.robozium.desktop.project=${settings.project}`))
	assert.ok(run.args.includes(`${path.join(settings.runtime, "hub")}:/hub`), "without a hub folder the runtime keeps its own hub")
	assert.match(state.environment ?? "", /^ROBOZIUM_MODE=mock$/m)
	await controller.close()
})

test("the container runs rootless on the host's loopback with the layout's mounts and command", async t => {
	const { controller, state, settings } = fixture(t)
	await controller.start()
	const args = runCall(state)!.args
	const option = (name: string) => args.flatMap((arg, index) => arg === name ? [args[index + 1]] : [])
	assert.deepEqual(option("--network"), ["host"])
	assert.deepEqual(option("--user"), ["0:0"])
	assert.deepEqual(option("--cap-drop"), ["all"])
	assert.deepEqual(option("--security-opt"), ["no-new-privileges"])
	assert.deepEqual(option("--pull"), ["never"])
	assert.deepEqual(option("--publish"), [])
	assert.deepEqual(option("--env-file"), [path.join(settings.runtime, ".runtime/container.env")])
	assert.equal(existsSync(option("--env-file")[0]), false, "the environment file is removed once the container starts")
	assert.deepEqual(option("--volume").sort(), resolveBackendLayout(settings.runtime).mounts
		.map(mount => `${mount.source}:${mount.destination}${mount.writable ? "" : ":ro"}`).sort())
	assert.deepEqual(args.slice(args.indexOf(`localhost/${settings.project}-api`) + 1),
		["uvicorn", "robozium.api.app:mock_app", "--factory", "--host", "127.0.0.1", "--port", "18000", "--workers", "1"])
	await controller.close()
})

test("environment files reach the backend through a private file in order, below the layout's own values", async t => {
	const { controller, state, settings } = fixture(t)
	mkdirSync(settings.runtime, { recursive: true })
	writeFileSync(path.join(settings.runtime, ".env.encrypt"), "OPENROUTER_API_KEY_ENCRYPTED=roboz:synthetic\nEXAMPLE_VALUE=encrypted-copy\n")
	writeFileSync(path.join(settings.runtime, ".env"), "EXAMPLE_VALUE='plain copy'\nROBOZIUM_HUB_ROOT=/wrong\nROBOZIUM_DESKTOP_API_PORT=9999\n")
	await controller.start()
	const run = runCall(state)!
	const environment = Object.fromEntries((state.environment ?? "").trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
	assert.equal(environment.EXAMPLE_VALUE, "plain copy")
	assert.equal(environment.OPENROUTER_API_KEY_ENCRYPTED, "roboz:synthetic")
	assert.equal(environment.ROBOZIUM_HUB_ROOT, "/hub")
	assert.equal(environment.ROBOZIUM_DESKTOP_API_PORT, "18000")
	assert.equal(environment.ROBOZIUM_CONFIG, "/app/hub.config.py")
	assert.equal(environment.ROBOZIUM_ENCRYPTED_ENV_PATH, "/configuration/.env.encrypt")
	assert.equal(run.args.some(arg => arg.includes("synthetic") || arg.includes("plain copy")), false, "values stay off the command line")
	await controller.close()
})

test("a multi-line environment value stops startup before any container change", async t => {
	const { controller, state, settings } = fixture(t)
	mkdirSync(settings.runtime, { recursive: true })
	writeFileSync(path.join(settings.runtime, ".env"), 'CERTIFICATE="line one\nline two"\n')
	await assert.rejects(controller.start(), /CERTIFICATE spans several lines/)
	assert.equal(commands(state).some(args => args[0] === "run"), false)
	await controller.close()
})

test("a stopped container is replaced, so the backend reads its environment again", async t => {
	const { controller, state } = fixture(t, { exists: true })
	await controller.start()
	const started = commands(state).map(args => args[0]).filter(name => ["stop", "rm", "run"].includes(name))
	assert.deepEqual(started, ["rm", "run"])
	await controller.close()
})

test("a backend that exits during startup reports its own error instead of waiting for the timeout", async t => {
	const { controller, state } = fixture(t, { ready: false, controller: { readinessTimeout: 60_000 },
		logs: "Traceback (most recent call last):\n  File \"x\"\nValueError: Unexpected folders in sandbox root /hub: misplaced\n\nERROR:    Application startup failed. Exiting.\n" })
	state.intercept = async args => { if (args[0] === "run") { state.exists = true; state.running = false; return "" } }
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
	assert.ok(runCall(state)?.args.includes(`${hub}:/hub`))
	await controller.close()
})

test("recreates a container a crash left running on a previous hub folder", async t => {
	const { hub, location, onPrevious } = userHub(t)
	const { controller, state } = fixture(t, { exists: true, running: true, available: false, hub, controller: { hubFolder: location }, mutate: onPrevious })
	await controller.start()
	assert.equal(controller.snapshot().state, "ready")
	assert.ok(runCall(state)?.args.includes(`${hub}:/hub`))
	assert.deepEqual(commands(state).filter(args => ["stop", "rm"].includes(args[0])).map(args => args[0]), ["stop", "rm"], "the old container is replaced")
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

test("a missing hub folder stops startup before Podman and offers choosing another", async t => {
	const { hub, location } = userHub(t)
	rmSync(hub, { recursive: true })
	const { controller, state } = fixture(t, { controller: { hubFolder: location } })
	await assert.rejects(controller.start(), /missing/)
	assert.equal(controller.snapshot().action, "choose-hub-folder")
	assert.deepEqual(state.calls, [])
	assert.equal(existsSync(hub), false, "a recorded hub folder is never recreated")
	await controller.close()
})

const managed = (state: FakePodman) => async (args: string[]) => {
	if (args[0] === "restart") { state.restarts = (state.restarts ?? 0) + 1; return "" }
}

for (const [operation, expected] of [
	["restart", [["restart", "--time", "30", id]]],
	["recreate", [["stop", "--time", "30", id], ["rm", id], ["run"]]],
] as ["restart" | "recreate", string[][]][]) test(`${operation} checks ownership, runs ${expected.map(args => args[0]).join(", ")} and waits until ready`, async t => {
	const { controller, state } = fixture(t)
	state.intercept = managed(state)
	await assert.rejects(controller[operation](), /Start the backend/)
	await controller.start()
	const count = state.calls.length
	const pending = controller[operation]()
	assert.equal(controller.snapshot().state, "starting")
	await pending
	const calls = commands(state).slice(count)
	assert.deepEqual(calls.slice(0, 2).map(args => args.slice(0, 2)), [["ps", "--all"], ["container", "inspect"]])
	assert.deepEqual(calls.slice(2).map((args, index) => args.slice(0, expected[index].length)), expected)
	assert.deepEqual(controller.snapshot(), { state: "ready", message: "Backend ready" })
	await controller.close()
})

test("backend operations run one at a time and shutdown waits for them", async t => {
	let release = () => {}
	const { controller, state } = fixture(t)
	await controller.start()
	state.intercept = async args => {
		if (args[0] === "restart") return new Promise(resolve => { release = () => resolve("") })
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
	assert.equal(commands(state).filter(args => args[0] === "run").length, 1, "only startup ran a container")
	state.mutate = undefined
	await assert.rejects(controller.restart(), /Start the backend/)
	await controller.start()
	await controller.restart()
	assert.equal(state.restarts, 1)
	await controller.close()
})
