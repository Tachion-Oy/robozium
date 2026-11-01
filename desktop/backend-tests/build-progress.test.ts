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
	const progress = new BuildProgress(dockerfile)
	const lines = freshBuild()
	const fractions = lines.map(line => progress.push(`${line}\n`))
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), "the bar never moves back")
	const atLine = (text: string) => fractions[lines.findIndex(line => line.includes(text))]
	// The package installation is most of the build, and each unpacked package moves the bar.
	assert.ok(atLine("Setting up fonts-opensymbol") - atLine("Get:1 ") > 0.6)
	assert.ok(atLine("Unpacking libreoffice-writer") > atLine("Unpacking libreoffice-core"))
	// Writing the image is the last share; its ID ends the build.
	assert.ok(atLine("COMMIT") < 1)
	assert.equal(fractions.at(-1), 1)
})

test("output split mid-line reads the same as whole lines", () => {
	const whole = new BuildProgress(dockerfile)
	const split = new BuildProgress(dockerfile)
	const output = `${freshBuild().join("\r\n")}\r\n`
	whole.push(output)
	for (let start = 0; start < output.length; start += 7) split.push(output.slice(start, start + 7))
	assert.equal(split.fraction, whole.fraction)
})

test("a cached build ends full", () => {
	const progress = new BuildProgress(dockerfile)
	const output = freshBuild()
		.filter(line => /^(\[|-->|Successfully tagged)/.test(line))
		.flatMap(line => /STEP \d+\/\d+: (?!FROM)/.test(line) ? [line, "--> Using cache ec907f0aacdc84d66fdf4f59b5acc834da02644c26fd127475c12717a35317eb"] : [line])
	progress.push(`${output.join("\n")}\n`)
	assert.equal(progress.fraction, 1)
})

test("pulling the base image advances as its layers finish", () => {
	const progress = new BuildProgress(dockerfile)
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
