// Install OLD_DEB, add user data, upgrade to NEW_DEB, and require the data to
// survive: the installation identity, a project in the default hub and an
// encrypted secret that still unlocks with its password. Runs the live app
// under Xvfb with a fresh home; no provider keys are needed. Needs sudo, and Docker
// for releases from before Podman.
//
//   node desktop/packaging/check-upgrade.mjs OLD_DEB NEW_DEB
import { execFileSync, spawn } from "node:child_process"
import console from "node:console"
import { existsSync, mkdtempSync, openSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { setTimeout as sleep } from "node:timers/promises"

const readJson = file => JSON.parse(readFileSync(path.join(import.meta.dirname, "..", file), "utf8"))
const { locations } = readJson("src/backend-layout.json")["x-desktop"]
const { build } = readJson("package.json")

const [oldDeb, newDeb] = process.argv.slice(2).map(file => path.resolve(file))
if (!oldDeb || !newDeb) throw new Error("Usage: check-upgrade.mjs OLD_DEB NEW_DEB")

// The app takes this port, so the check never depends on its default.
const port = "18101"
const api = `http://127.0.0.1:${port}`
const home = mkdtempSync(path.join(os.tmpdir(), "robozium-upgrade-"))
const profile = path.join(home, ".config", build.productName)
const hub = path.join(home, locations.defaultHub.replace(/^~\//, ""))
const log = openSync(process.env.UPGRADE_LOG ?? path.join(home, "robozium.log"), "a")
const secretName = "ROBOZIUM_UPGRADE_SECRET"
const password = "upgrade-check-password"
let app = null

function install(deb) {
	// apt installs exactly this file with its dependencies, even over the same version.
	execFileSync("sudo", ["apt-get", "install", "-y", "--reinstall", "--allow-downgrades", deb], { stdio: "inherit" })
}

async function request(route, body) {
	const response = await globalThis.fetch(api + route, {
		method: body ? "POST" : "GET",
		headers: { Origin: "robozium://app", "Content-Type": "application/json" },
		body: body && JSON.stringify(body),
	})
	if (!response.ok) throw new Error(`${route} answered ${response.status}`)
	return response.json()
}

async function startApp() {
	const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), ROBOZIUM_DESKTOP_API_PORT: port }
	app = spawn("xvfb-run", ["-a", "robozium"], { env, stdio: ["ignore", log, log] })
	for (let attempt = 0; attempt < 60; attempt++) {
		if (app.exitCode !== null) throw new Error("The installed app exited during startup.")
		try {
			await request("/ready")
			return
		} catch {
			await sleep(5000)
		}
	}
	throw new Error("The installed app's backend never became ready.")
}

async function stopApp() {
	if (!app || app.exitCode !== null) return
	// Quitting the app stops its backend container; xvfb-run then exits too.
	execFileSync("pkill", ["-TERM", "-o", "-x", "robozium"])
	for (let second = 0; second < 60 && app.exitCode === null; second++) await sleep(1000)
	if (app.exitCode === null) throw new Error("The installed app did not exit.")
}

function check(condition, failure) {
	if (!condition) throw new Error(failure)
}

try {
	install(oldDeb)
	await startApp()
	// Save an encrypted secret as the Environment panel does.
	const { revision } = await request("/credentials/environment")
	await request("/credentials/environment", { revision, password, entries: [{ name: secretName, value: "kept", secret: true }] })
	const { slug } = await request("/projects", { name: "Upgrade check" })
	await stopApp()
	const identity = readFileSync(path.join(profile, locations.installationId), "utf8")

	install(newDeb)
	await startApp()
	const projects = await request("/projects")
	check(projects.some(project => project.slug === slug), "The project was lost in the upgrade.")
	check(existsSync(path.join(hub, locations.hubProjects, slug)), `The project is not in ${locations.defaultHub}.`)
	const environment = await request("/credentials/environment")
	check(environment.entries.some(entry => entry.name === secretName && entry.secret), "The encrypted secret was lost in the upgrade.")
	const credentials = await request("/credentials/unlock", { password })
	check(!credentials.locked, "The encrypted secret no longer unlocks with its password.")
	check(readFileSync(path.join(profile, locations.installationId), "utf8") === identity, "The installation identity changed.")
	console.log("Upgrade kept the profile, project and encrypted secret.")
} finally {
	try {
		await stopApp()
	} catch {
		app?.kill("SIGKILL")
	}
}
