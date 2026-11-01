import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import { test, type TestContext } from "node:test"
import type { BackendContainer } from "../../src/container-engine.ts"
import type { CommandOptions } from "../../src/host-command.ts"
import { PodmanEngine } from "../../src/podman-engine.ts"

const ranges = [{ size: 1 }, { size: 65536 }]
const rootless = { host: { security: { rootless: true }, idMappings: { uidmap: ranges, gidmap: ranges } } }
const call = () => ({ signal: new globalThis.AbortController().signal })

/** An engine whose Podman answers from `respond`, recording every call. */
function fakePodman(respond: (args: string[], options: CommandOptions) => string = () => "", findPodman = (): string | undefined => "/test/podman") {
	const calls: { args: string[]; options: CommandOptions }[] = []
	const engine = new PodmanEngine({
		findPodman,
		run: async (executable, args, options) => {
			assert.equal(executable, "/test/podman")
			calls.push({ args, options })
			return respond(args, options)
		},
	})
	return { engine, calls }
}

function container(t: TestContext, overrides: Partial<BackendContainer> = {}): BackendContainer {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-podman-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	return {
		name: "robozium-desktop-abcdefabcdef-mock-api",
		image: "robozium-desktop-abcdefabcdef-mock-api",
		labels: { "fi.tachion.robozium.desktop.project": "robozium-desktop-abcdefabcdef-mock" },
		mounts: [
			{ source: "/runtime with spaces/hub", destination: "/hub", writable: true },
			{ source: "/runtime with spaces/.runtime/host-socket", destination: "/host-scripts", writable: false },
		],
		environment: { ROBOZIUM_MODE: "mock", EXAMPLE_VALUE: "plain copy" },
		environmentFile: path.join(directory, "container.env"),
		command: ["uvicorn", "robozium.api.app:mock_app", "--host", "{address}", "--port", "18000"],
		port: 18000,
		stopTimeoutSeconds: 30,
		...overrides,
	}
}

for (const [name, setup, error] of [
	["a missing Podman", fakePodman(undefined, () => undefined), /Podman was not found/],
	["an unavailable Podman", fakePodman(() => { throw new Error("broken storage") }), /Podman is unavailable/],
	["a Podman running as root", fakePodman(() => JSON.stringify({ host: { security: { rootless: false } } })), /runs as root/],
	["missing subordinate user IDs", fakePodman(() => JSON.stringify({ host: { security: { rootless: true }, idMappings: { uidmap: [{ size: 1 }], gidmap: ranges } } })), /too few subordinate user and group IDs/],
	["too small a subordinate range", fakePodman(() => JSON.stringify({ host: { security: { rootless: true }, idMappings: { uidmap: [{ size: 1 }, { size: 1000 }], gidmap: ranges } } })), /too few subordinate user and group IDs/],
	["missing subordinate group IDs", fakePodman(() => JSON.stringify({ host: { security: { rootless: true }, idMappings: { uidmap: ranges, gidmap: [{ size: 1 }] } } })), /too few subordinate user and group IDs/],
] as [string, ReturnType<typeof fakePodman>, RegExp][]) test(`preparation reports ${name} with an actionable error`, async () => {
	await assert.rejects(setup.engine.prepare(call()), error)
})

test("preparation accepts rootless Podman with subordinate IDs", async () => {
	const { engine, calls } = fakePodman(() => JSON.stringify(rootless))
	await engine.prepare(call())
	assert.deepEqual(calls.map(each => each.args), [["info", "--format", "json"]])
})

test("Podman always runs locally, without the app's own or remote settings, or Electron's disabled session bus", async t => {
	const names = ["ROBOZIUM_MODE", "ROBOZ_EXAMPLE", "CONTAINER_HOST", "CONTAINER_CONNECTION", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]
	const originals = Object.fromEntries(names.map(name => [name, process.env[name]]))
	t.after(() => {
		for (const name of names) {
			if (originals[name] === undefined) delete process.env[name]
			else process.env[name] = originals[name]
		}
	})
	Object.assign(process.env, { ROBOZIUM_MODE: "live", ROBOZ_EXAMPLE: "x", CONTAINER_HOST: "ssh://foreign/run/podman.sock",
		CONTAINER_CONNECTION: "foreign", DBUS_SESSION_BUS_ADDRESS: "disabled:", XDG_RUNTIME_DIR: "/run/user/1000" })
	const disabled = fakePodman(() => JSON.stringify(rootless))
	await disabled.engine.prepare(call())
	const environment = disabled.calls[0].options.env
	for (const name of names.slice(0, 5)) assert.equal(environment[name], undefined)
	assert.equal(environment.XDG_RUNTIME_DIR, "/run/user/1000")

	process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1000/bus"
	const session = fakePodman(() => JSON.stringify(rootless))
	await session.engine.prepare(call())
	assert.equal(session.calls[0].options.env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus", "a real session bus is kept")
})

test("images build and stay local under their full name", async () => {
	const { engine, calls } = fakePodman(() => JSON.stringify(rootless))
	await engine.prepare(call())
	await engine.build({ image: "robozium-api", context: "/stage", target: "api", buildArguments: { ROBOZIUM_DESKTOP_BUILD_ID: "b".repeat(64) } }, call())
	assert.deepEqual(calls.at(-1)!.args, ["build", "--target", "api", "--tag", "localhost/robozium-api", "--build-arg", `ROBOZIUM_DESKTOP_BUILD_ID=${"b".repeat(64)}`, "/stage"])
})

test("an image label reads trimmed, and a missing image reads as none", async () => {
	let exists = true
	const { engine, calls } = fakePodman(args => {
		if (args[0] === "info") return JSON.stringify(rootless)
		if (!exists) throw new Error("No such image")
		return "build-id\n"
	})
	await engine.prepare(call())
	assert.equal(await engine.imageLabel("robozium-api", "fi.tachion.robozium.desktop.build", call()), "build-id")
	assert.deepEqual(calls.at(-1)!.args, ["image", "inspect", "--format", '{{index .Config.Labels "fi.tachion.robozium.desktop.build"}}', "localhost/robozium-api"])
	exists = false
	assert.equal(await engine.imageLabel("robozium-api", "fi.tachion.robozium.desktop.build", call()), undefined)
	const abort = new globalThis.AbortController()
	abort.abort()
	await assert.rejects(engine.imageLabel("robozium-api", "fi.tachion.robozium.desktop.build", { signal: abort.signal }))
})

test("containers are listed by label and inspected into mounts", async () => {
	let listed = "aaa111\nbbb222\n"
	const { engine, calls } = fakePodman(args => {
		if (args[0] === "info") return JSON.stringify(rootless)
		if (args[0] === "ps") return listed
		return JSON.stringify({ labels: null, running: true, mounts: [{ Source: "/hub", Destination: "/hub", RW: false }] })
	})
	await engine.prepare(call())
	assert.deepEqual(await engine.list("fi.tachion.robozium.desktop.project", "robozium", call()), ["aaa111", "bbb222"])
	assert.deepEqual(calls.at(-1)!.args, ["ps", "--all", "--quiet", "--no-trunc", "--filter", "label=fi.tachion.robozium.desktop.project=robozium"])
	listed = "\n"
	assert.deepEqual(await engine.list("fi.tachion.robozium.desktop.project", "robozium", call()), [])
	assert.deepEqual(await engine.inspect("aaa111", call()), { labels: {}, running: true, mounts: [{ source: "/hub", destination: "/hub", writable: false }] })
	assert.deepEqual(calls.at(-1)!.args.slice(0, 2), ["container", "inspect"])
})

test("the container runs rootless on the host's loopback, with its variables in a private file that is removed after", async t => {
	const backend = container(t)
	let environment = ""
	const { engine, calls } = fakePodman((args, options) => {
		if (args[0] === "info") return JSON.stringify(rootless)
		const file = args[args.indexOf("--env-file") + 1]
		assert.equal(statSync(file).mode & 0o777, 0o600)
		environment = readFileSync(file, "utf8")
		assert.equal(options.timeout, 1000)
		return ""
	})
	await engine.prepare(call())
	await engine.run(backend, { ...call(), timeout: 1000 })
	assert.deepEqual(calls.at(-1)!.args, [
		"run", "--detach", "--pull", "never", "--name", backend.name,
		"--label", "fi.tachion.robozium.desktop.project=robozium-desktop-abcdefabcdef-mock",
		"--network", "host", "--init", "--user", "0:0", "--cap-drop", "all", "--security-opt", "no-new-privileges",
		"--stop-timeout", "30", "--env-file", backend.environmentFile,
		"--volume", "/runtime with spaces/hub:/hub", "--volume", "/runtime with spaces/.runtime/host-socket:/host-scripts:ro",
		`localhost/${backend.image}`, "uvicorn", "robozium.api.app:mock_app", "--host", "127.0.0.1", "--port", "18000",
	])
	assert.equal(environment, "ROBOZIUM_MODE=mock\nEXAMPLE_VALUE=plain copy\n")
	assert.equal(existsSync(backend.environmentFile), false)
	assert.equal(calls.at(-1)!.args.some(arg => arg.includes("plain copy")), false, "values stay off the command line")
})

test("the environment file is removed when the container fails to start", async t => {
	const backend = container(t)
	const { engine } = fakePodman(args => {
		if (args[0] === "info") return JSON.stringify(rootless)
		throw new Error("podman failed")
	})
	await engine.prepare(call())
	await assert.rejects(engine.run(backend, call()), /podman failed/)
	assert.equal(existsSync(backend.environmentFile), false)
})

test("a mount path with a colon is refused before anything runs", async t => {
	const backend = container(t, { mounts: [{ source: "/home/user/Hub:2", destination: "/hub", writable: true }] })
	const { engine, calls } = fakePodman(() => JSON.stringify(rootless))
	await engine.prepare(call())
	await assert.rejects(engine.run(backend, call()), /contains a colon/)
	assert.equal(calls.length, 1)
	assert.equal(existsSync(backend.environmentFile), false)
})

test("restart, stop, remove and logs name only the given containers", async () => {
	const { engine, calls } = fakePodman(args => args[0] === "info" ? JSON.stringify(rootless) : "log text")
	await engine.prepare(call())
	await engine.restart("aaa111", 30, call())
	await engine.stop(["aaa111", "bbb222"], 30, call())
	await engine.remove(["aaa111"], call())
	assert.equal(await engine.logs("aaa111", 40, call()), "log text")
	assert.deepEqual(calls.slice(1).map(each => each.args), [
		["restart", "--time", "30", "aaa111"], ["stop", "--time", "30", "aaa111", "bbb222"], ["rm", "aaa111"], ["logs", "--tail", "40", "aaa111"],
	])
})
