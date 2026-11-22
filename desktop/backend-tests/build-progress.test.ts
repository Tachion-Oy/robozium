import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { BuildProgress } from "../src/build-progress.ts"

const dockerfile = fs.readFileSync(path.resolve(import.meta.dirname, "../Dockerfile"), "utf8")
const packages = ["libreoffice-core", "libreoffice-writer", "ripgrep", "fonts-opensymbol"]
const apiTail = ["ENV HOME=/tmp", "COPY --from=python-deps /app/.venv /app/.venv", "COPY --from=python-deps /usr/local/bin/uv /usr/local/bin/uv",
	"COPY hub.config.py ./hub.config.py", "ARG ROBOZIUM_DESKTOP_BUILD_ID=manual", "LABEL fi.tachion.robozium.desktop.build=$ROBOZIUM_DESKTOP_BUILD_ID",
	"USER robozium", "ENV ROBOZIUM_DESKTOP_API_PORT=18001", "EXPOSE 18001", 'CMD ["sh", "-c", "exec uvicorn"]']

/** Plain Podman output for a fresh build of the desktop Dockerfile, shortened from a real one. */
function freshBuild(): string[] {
	return [
		"[1/2] STEP 1/7: FROM docker.io/library/python:3.13-slim-bookworm AS python-deps",
		"[1/2] STEP 2/7: ENV UV_COMPILE_BYTECODE=1     UV_LINK_MODE=copy     UV_PYTHON_DOWNLOADS=never",
		"--> ec907f0aacd",
		"[1/2] STEP 3/7: WORKDIR /app",
		"--> b533ebec641",
		"[1/2] STEP 4/7: RUN python -m pip install --no-cache-dir uv==0.12.10",
		"Successfully installed uv-0.12.10",
		"--> 1d2f6999e52",
		"[1/2] STEP 5/7: COPY pyproject.toml uv.lock README.md LICENSE CHANGELOG.md hub.config.py ./",
		"--> c4e2bec384e",
		"[1/2] STEP 6/7: COPY src ./src",
		"--> 1452242a4bc",
		"[1/2] STEP 7/7: RUN uv sync --locked --no-dev --no-editable",
		"--> 31f905dbbe2",
		"[2/2] STEP 1/14: FROM docker.io/library/python:3.13-slim-bookworm AS api",
		"[2/2] STEP 2/14: ENV PATH=/app/.venv/bin:$PATH",
		"--> 60bcb51e547",
		"[2/2] STEP 3/14: WORKDIR /app",
		"--> 2160f904265",
		"[2/2] STEP 4/14: RUN apt-get update     && apt-get install --no-install-recommends -y         libreoffice",
		"Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]",
		`0 upgraded, ${packages.length} newly installed, 0 to remove and 1 not upgraded.`,
		...packages.map((name, index) => `Get:${index + 7} http://deb.debian.org/debian bookworm/main amd64 ${name}`),
		...packages.map(name => `Unpacking ${name}:amd64 (1.0) ...`),
		...packages.map(name => `Setting up ${name} (1.0) ...`),
		"Processing triggers for libc-bin (2.36-9+deb12u14) ...",
		"--> dbcd6e954ae",
		// The last step is followed by the commit, not by an image ID.
		...apiTail.flatMap((instruction, index) => [`[2/2] STEP ${index + 5}/14: ${instruction}`, `--> ${index}b563eca7e2`]).slice(0, -1),
		"[2/2] COMMIT localhost/robozium-desktop-abcdefabcdef-live-api",
		"--> 83b5ce705aa",
		"Successfully tagged localhost/robozium-desktop-abcdefabcdef-live-api:latest",
	]
}

test("a fresh build advances through the package installation and ends full", () => {
	const progress = new BuildProgress(dockerfile, false)
	const lines = freshBuild()
	const fractions = lines.map(line => progress.push(`${line}\n`))
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), "the bar never moves back")
	const atLine = (text: string) => fractions[lines.findIndex(line => line.includes(text))]
	// The package installation is most of the build, and each unpacked package moves the bar.
	assert.ok(atLine("Setting up fonts-opensymbol") - atLine("Get:1 ") > 0.5)
	assert.ok(atLine("Unpacking libreoffice-writer") > atLine("Unpacking libreoffice-core"))
	// Writing the image is the last share; its ID ends the build.
	assert.ok(atLine("COMMIT") < 1)
	assert.equal(fractions.at(-1), 1)
})

/** Plain Podman output for an update: the source changed, so the stages rebuild from their first copy. Shortened from a real one. */
function update(): string[] {
	const cached = (id: string) => [`--> Using cache ${id}0f6cdd2f3a1e0d64d7a0a5d4f2b1c9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3`, `--> ${id}`]
	return [
		"[1/2] STEP 1/7: FROM docker.io/library/python:3.13-slim-bookworm AS python-deps",
		"[1/2] STEP 2/7: ENV UV_COMPILE_BYTECODE=1     UV_LINK_MODE=copy     UV_PYTHON_DOWNLOADS=never",
		...cached("acc6c06ba45"),
		"[1/2] STEP 3/7: WORKDIR /app",
		...cached("0561ee52ed2"),
		"[1/2] STEP 4/7: RUN python -m pip install --no-cache-dir uv==0.12.10",
		...cached("d79a4c77078"),
		"[1/2] STEP 5/7: COPY pyproject.toml uv.lock README.md LICENSE CHANGELOG.md hub.config.py ./",
		"--> 0f4672741f5",
		"[1/2] STEP 6/7: COPY src ./src",
		"--> 94d4c7b6ddd",
		"[1/2] STEP 7/7: RUN uv sync --locked --no-dev --no-editable",
		"Resolved 68 packages in 55ms",
		"Downloading pillow (6.8MiB)",
		"Downloading cryptography (4.5MiB)",
		" Downloaded cryptography",
		" Downloaded pillow",
		"Prepared 40 packages in 2.91s",
		"Installed 40 packages in 215ms",
		"Bytecode compiled 3039 files in 640ms",
		" + roboz==0.20.0",
		"--> 708642e6e4d",
		"[2/2] STEP 1/14: FROM docker.io/library/python:3.13-slim-bookworm AS api",
		"[2/2] STEP 2/14: ENV PATH=/app/.venv/bin:$PATH",
		...cached("05384b7d997"),
		"[2/2] STEP 3/14: WORKDIR /app",
		...cached("0278f123dbf"),
		"[2/2] STEP 4/14: RUN apt-get update     && apt-get install --no-install-recommends -y         libreoffice",
		...cached("8b80bf009d1"),
		...apiTail.flatMap((instruction, index) => [`[2/2] STEP ${index + 5}/14: ${instruction}`, ...index === 0 ? cached("ac37d19312a") : [`--> ${index}b563eca7e2`]]).slice(0, -1),
		"[2/2] COMMIT localhost/robozium-desktop-abcdefabcdef-live-api",
		"--> e9c0c0277bf",
		"Successfully tagged localhost/robozium-desktop-abcdefabcdef-live-api:latest",
	]
}

test("an update weighs only the steps it rebuilds", () => {
	const progress = new BuildProgress(dockerfile, true)
	const lines = update()
	const fractions = lines.map(line => progress.push(`${line}\n`))
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), "the bar never moves back")
	const atLine = (text: string) => fractions[lines.findIndex(line => line.includes(text))]
	// The steps reused from the cache add nothing, at the start or before the copies of the second stage.
	assert.equal(atLine("STEP 5/7: COPY"), 0)
	assert.equal(atLine("COPY --from=python-deps /app/.venv"), atLine("[2/2] STEP 1/14"))
	// Installing the Python packages is the largest share, and uv's phases move the bar through it.
	assert.ok(atLine("Resolved") < atLine("Downloaded pillow"))
	assert.ok(atLine("Downloaded pillow") < atLine("Installed"))
	assert.ok(atLine("Installed") < atLine("Bytecode compiled"))
	assert.ok(atLine("[2/2] STEP 1/14") - atLine("STEP 7/7") > 0.3)
	assert.equal(fractions.at(-1), 1)
})

test("an update that installs the packages again holds the bar until that work catches up", () => {
	const progress = new BuildProgress(dockerfile, true)
	const lines = freshBuild()
	const fractions = lines.map(line => progress.push(`${line}\n`))
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), "the bar never moves back")
	const atLine = (text: string) => fractions[lines.findIndex(line => line.includes(text))]
	assert.ok(atLine("Setting up fonts-opensymbol") > atLine("Unpacking libreoffice-core"), "the package installation moves the bar once it counts again")
	assert.equal(fractions.at(-1), 1)
})

test("output split mid-line reads the same as whole lines", () => {
	const whole = new BuildProgress(dockerfile, false)
	const split = new BuildProgress(dockerfile, false)
	const output = `${freshBuild().join("\r\n")}\r\n`
	whole.push(output)
	for (let start = 0; start < output.length; start += 7) split.push(output.slice(start, start + 7))
	assert.equal(split.fraction, whole.fraction)
})

test("a cached build ends full", () => {
	const progress = new BuildProgress(dockerfile, false)
	const output = freshBuild()
		.filter(line => /^(\[|-->|Successfully tagged)/.test(line))
		.flatMap(line => /STEP \d+\/\d+: (?!FROM)/.test(line) ? [line, "--> Using cache ec907f0aacdc84d66fdf4f59b5acc834da02644c26fd127475c12717a35317eb"] : [line])
	progress.push(`${output.join("\n")}\n`)
	assert.equal(progress.fraction, 1)
})

test("pulling the base image advances as its layers finish", () => {
	const progress = new BuildProgress(dockerfile, false)
	const pull = [
		"[1/2] STEP 1/7: FROM docker.io/library/python:3.13-slim-bookworm AS python-deps",
		"Trying to pull docker.io/library/python:3.13-slim-bookworm...",
		"Getting image source signatures",
		"Copying blob sha256:aaaa",
		"Copying blob sha256:bbbb",
		"Copying blob sha256:aaaa",
		"Copying blob sha256:bbbb",
		"Copying config sha256:cccc",
		"Writing manifest to image destination",
		"Storing signatures",
		"[1/2] STEP 2/7: ENV UV_COMPILE_BYTECODE=1",
	]
	const fractions = pull.map(line => progress.push(`${line}\n`))
	assert.ok(fractions[5] > fractions[4], "a finished layer moves the bar")
	assert.ok(fractions[6] > fractions[5])
	// The pull is a visible share of a fresh build, unlike a FROM that finds the image local.
	assert.ok(fractions.at(-1)! > 0.05)
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]))
})
