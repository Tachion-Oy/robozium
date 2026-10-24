// The apt repository that each GitHub Release carries. Users' apt reads it
// from releases/latest/download, so every release replaces the last.
//
//   node desktop/packaging/apt-repository.mjs check-version TAG
//     TAG must be v<desktop/package.json version>, plain MAJOR.MINOR.PATCH and
//     newer than the latest release, or apt would not upgrade to it.
//   node desktop/packaging/apt-repository.mjs previous DIR
//     Download the latest release's .deb into DIR; leave DIR empty if there is none.
//   node desktop/packaging/apt-repository.mjs build DIR
//     Put the new .deb and the public key in DIR and sign its index with the
//     private key in APT_SIGNING_KEY.
import { execFileSync } from "node:child_process"
import console from "node:console"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

const desktop = path.resolve(import.meta.dirname, "..")
const publicKey = path.join(import.meta.dirname, "robozium-archive-keyring.asc")
const { version } = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8"))

function run(command, args, options = {}) {
	return execFileSync(command, args, { encoding: "utf8", ...options })
}

/** The latest release's tag, or null when the repository has no release yet. */
function latestRelease() {
	try {
		return run("gh", ["release", "view", "--json", "tagName", "--jq", ".tagName"], { stdio: ["ignore", "pipe", "pipe"] }).trim()
	} catch (error) {
		if (/release not found|HTTP 404/.test(error.stderr)) return null
		throw error
	}
}

function checkVersion(tag) {
	if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match desktop/package.json version ${version}.`)
	// Every release reaches all apt users, so prereleases such as 1.0.0-beta.1 are refused.
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Release versions must be MAJOR.MINOR.PATCH, not ${version}.`)
	const previous = latestRelease()
	if (previous) {
		try {
			run("dpkg", ["--compare-versions", version, "gt", previous.slice(1)])
		} catch {
			throw new Error(`${version} is not newer than ${previous}; apt would not upgrade.`)
		}
	}
}

function downloadPrevious(directory) {
	mkdirSync(directory, { recursive: true })
	const previous = latestRelease()
	if (!previous) return console.log("No earlier release.")
	run("gh", ["release", "download", previous, "--pattern", "*.deb", "--dir", directory], { stdio: "inherit" })
}

function build(directory) {
	const key = process.env.APT_SIGNING_KEY
	if (!key) throw new Error("The APT_SIGNING_KEY secret is not set.")
	const deb = `robozium-desktop_${version}_amd64.deb`
	mkdirSync(directory, { recursive: true })
	copyFileSync(path.join(desktop, "release", deb), path.join(directory, deb))
	copyFileSync(publicKey, path.join(directory, path.basename(publicKey)))

	// Filenames are relative to the release download URL, so without "./".
	const packages = run("dpkg-scanpackages", ["--multiversion", ".", "/dev/null"], { cwd: directory, stdio: ["ignore", "pipe", "inherit"] })
	writeFileSync(path.join(directory, "Packages"), packages.replace(/^Filename: \.\//gm, "Filename: "))
	// Generated before Release exists, so Release does not list itself.
	const release = run("apt-ftparchive", ["release", "."], { cwd: directory })
	writeFileSync(path.join(directory, "Release"), release)

	// A throwaway keyring, deleted before later steps run downloaded packages.
	const gnupg = mkdtempSync(path.join(os.tmpdir(), "robozium-gnupg-"))
	const gpg = (args, input) => run("gpg", ["--batch", "--yes", ...args], { cwd: directory, env: { ...process.env, GNUPGHOME: gnupg }, input })
	try {
		gpg(["--import"], key)
		gpg(["--clearsign", "--output", "InRelease", "Release"])
		gpg(["--armor", "--detach-sign", "--output", "Release.gpg", "Release"])
	} finally {
		rmSync(gnupg, { recursive: true, force: true })
	}
	console.log(readdirSync(directory).join("\n"))
}

const [command, argument] = process.argv.slice(2)
const commands = { "check-version": checkVersion, previous: downloadPrevious, build }
if (!commands[command] || !argument) throw new Error("Usage: apt-repository.mjs check-version TAG | previous DIR | build DIR")
commands[command](argument)
