import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { BuildProgress } from "../src/build-progress.ts"

const dockerfile = fs.readFileSync(path.resolve(import.meta.dirname, "../Dockerfile"), "utf8")
const packages = ["libreoffice-core", "libreoffice-writer", "ripgrep", "fonts-opensymbol"]

/** Plain BuildKit output for a fresh build of the desktop Dockerfile, shortened from a real one. */
function freshBuild(): string[] {
	const apt = "#11 [api 3/6] RUN apt-get update     && apt-get install --no-install-recommends -y libreoffice"
	return [
		"#8 [python-deps 1/6] FROM docker.io/library/python:3.13-slim-bookworm",
		"#8 DONE 0.0s",
		"#9 [python-deps 2/6] WORKDIR /app",
		"#9 DONE 0.1s",
		apt,
		"#11 0.630 Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]",
		"#12 [python-deps 3/6] RUN python -m pip install --no-cache-dir uv==0.12.10",
		"#12 DONE 5.0s",
		"#13 [python-deps 4/6] COPY pyproject.toml uv.lock README.md LICENSE CHANGELOG.md hub.config.py ./",
		"#13 DONE 0.1s",
		"#14 [python-deps 5/6] COPY src ./src",
		"#14 DONE 0.1s",
		"#15 [python-deps 6/6] RUN uv sync --locked --no-dev --no-editable",
		"#15 DONE 5.1s",
		apt,
		`#11 4.603 0 upgraded, ${packages.length} newly installed, 0 to remove and 6 not upgraded.`,
		...packages.map((name, index) => `#11 ${5 + index}.000 Get:${index + 7} http://deb.debian.org/debian bookworm/main amd64 ${name}`),
		...packages.map((name, index) => `#11 ${10 + index}.000 Unpacking ${name} (1.0) ...`),
		...packages.map((name, index) => `#11 ${40 + index}.000 Setting up ${name} (1.0) ...`),
		"#11 DONE 75.6s",
		"#16 [api 4/6] COPY --from=python-deps /app/.venv /app/.venv",
		"#16 DONE 0.8s",
		"#17 [api 5/6] COPY --from=python-deps /usr/local/bin/uv /usr/local/bin/uv",
		"#17 DONE 0.2s",
		"#18 [api 6/6] COPY hub.config.py ./hub.config.py",
		"#18 DONE 0.1s",
		"#19 exporting to image",
		"#19 exporting layers 7.6s done",
		"#19 DONE 7.6s",
	]
}

test("a fresh build advances through the package installation and ends full", () => {
	const progress = new BuildProgress(dockerfile)
	const fractions = freshBuild().map(line => progress.push(`${line}\n`))
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]), "the bar never moves back")
	const lines = freshBuild()
	const atLine = (text: string) => fractions[lines.findIndex(line => line.includes(text))]
	// The package installation is most of the build, and each unpacked package moves the bar.
	assert.ok(atLine("Setting up fonts-opensymbol") - atLine("Get:1 ") > 0.6)
	assert.ok(atLine("Unpacking libreoffice-writer") > atLine("Unpacking libreoffice-core"))
	assert.ok(fractions.at(-2)! < 1)
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
	const output = [
		"#8 [api python-deps 1/6] FROM docker.io/library/python:3.13-slim-bookworm",
		"#8 CACHED",
		...[[2, "api", "WORKDIR /app"], [3, "python-deps", "RUN python -m pip install uv"], [4, "python-deps", "COPY pyproject.toml ./"],
			[5, "python-deps", "COPY src ./src"], [6, "python-deps", "RUN uv sync --locked"], [3, "api", "RUN apt-get update && apt-get install -y libreoffice"],
			[4, "api", "COPY --from=python-deps /app/.venv /app/.venv"], [5, "api", "COPY --from=python-deps /usr/local/bin/uv /usr/local/bin/uv"],
			[6, "api", "COPY hub.config.py ./hub.config.py"]]
			.flatMap(([index, stage, instruction], vertex) => [`#${vertex + 9} [api ${stage} ${index}/6] ${instruction}`, `#${vertex + 9} CACHED`]),
		"#18 [api] exporting to image",
		"#18 DONE 0.0s",
	]
	progress.push(`${output.join("\n")}\n`)
	assert.equal(progress.fraction, 1)
})

test("pulling the base image advances with its layers", () => {
	const progress = new BuildProgress(dockerfile)
	const pull = [
		"#8 [python-deps 1/6] FROM docker.io/library/python:3.13-slim-bookworm@sha256:1234",
		"#8 resolve docker.io/library/python:3.13-slim-bookworm@sha256:1234 0.0s done",
		"#8 sha256:aaaa 0B / 28.23MB 0.2s",
		"#8 sha256:bbbb 0B / 12.40MB 0.2s",
		"#8 sha256:aaaa 14.68MB / 28.23MB 1.4s",
		"#8 sha256:aaaa 28.23MB / 28.23MB 2.7s done",
		"#8 sha256:bbbb 12.40MB / 12.40MB 2.9s done",
		"#8 extracting sha256:aaaa 1.1s done",
		"#8 extracting sha256:bbbb 0.6s done",
		"#8 DONE 4.6s",
	]
	const fractions = pull.map(line => progress.push(`${line}\n`))
	const atLine = (text: string) => fractions[pull.findIndex(line => line.includes(text))]
	assert.ok(atLine("14.68MB") > atLine("0B / 12.40MB"))
	assert.ok(atLine("extracting sha256:bbbb") > atLine("12.40MB / 12.40MB"))
	// The pull is a visible share of a fresh build, unlike a FROM that finds the image local.
	assert.ok(atLine("extracting sha256:bbbb") > 0.05)
	assert.ok(fractions.every((fraction, index) => index === 0 || fraction >= fractions[index - 1]))
})
