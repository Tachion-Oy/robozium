import path from "node:path"
import process from "node:process"
import console from "node:console"
import { prepareDesktop } from "../src/prepare-desktop.cjs"

// CLI and splash launches share the application build steps. Staging is separate.
const controller = new globalThis.AbortController()
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort())
try {
	await prepareDesktop(path.resolve(import.meta.dirname, ".."), false, controller.signal, console.log)
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
