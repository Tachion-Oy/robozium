import fs from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

// Adapted from experiment 076b2c9. Never traverse private runtime directories.
export function stageBackend(root = path.resolve(import.meta.dirname, "../..")) {
	const inputs: [source: string, destination: string][] = []
	function inspect(relative: string) {
		const stat = fs.lstatSync(path.join(root, relative))
		if (stat.isSymbolicLink()) throw new Error(`Staging rejects symlinks: ${relative}`)
		return stat
	}
	function file(source: string, destination = source) {
		if (!inspect(source).isFile()) throw new Error(`Expected a regular file: ${source}`)
		inputs.push([source, destination])
	}
	function pythonSources(directory: string) {
		if (!inspect(directory).isDirectory()) throw new Error(`Expected a directory: ${directory}`)
		for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
			const relative = path.join(directory, name)
			const stat = inspect(relative)
			if (name.startsWith(".") || name === "__pycache__") continue
			if (stat.isDirectory()) pythonSources(relative)
			else if (name.endsWith(".py")) file(relative)
		}
	}
	inspect("desktop")
	inspect("src")
	for (const name of ["Dockerfile", ".dockerignore"]) file(`desktop/${name}`, name)
	// The backend configuration is the repository's own, shared with the web runtime.
	for (const name of ["hub.config.py", "pyproject.toml", "uv.lock", "README.md", "LICENSE", "CHANGELOG.md"]) file(name)
	pythonSources("src/robozium")

	// Check output parents before replacing only our generated build directory.
	const stage = path.join(root, "desktop/.stage")
	fs.mkdirSync(stage, { recursive: true })
	inspect("desktop/.stage")
	const target = path.join(stage, "backend")
	if (fs.existsSync(target)) inspect("desktop/.stage/backend")
	const pending = fs.mkdtempSync(path.join(stage, "backend-"))
	try {
		const hash = createHash("sha256")
		for (const [source, destination] of inputs) {
			const output = path.join(pending, destination)
			fs.mkdirSync(path.dirname(output), { recursive: true })
			fs.copyFileSync(path.join(root, source), output)
			hash.update(destination + "\0").update(fs.readFileSync(output))
		}
		fs.writeFileSync(path.join(pending, "build-id.json"), JSON.stringify({ id: hash.digest("hex") }) + "\n")
		fs.rmSync(target, { recursive: true, force: true })
		fs.renameSync(pending, target)
	} finally {
		fs.rmSync(pending, { recursive: true, force: true })
	}
	return target
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.stdout.write(`Staged backend: ${stageBackend()}\n`)
}
