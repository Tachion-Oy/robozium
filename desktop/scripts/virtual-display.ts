// Run a native test command on a private virtual display, so test windows never
// appear on the user's screen. Screenshot baselines also assume this display.
import { spawnSync } from "node:child_process"
import process from "node:process"

const [command, ...args] = process.argv.slice(2)
if (!command) {
	process.stderr.write("Usage: node scripts/virtual-display.ts <command> [arguments…]\n")
	process.exit(2)
}
// Without the Wayland socket, nothing in the run can reach the user's session.
const environment = { ...process.env }
delete environment.WAYLAND_DISPLAY
const result = process.platform === "linux"
	? spawnSync("xvfb-run", ["--auto-servernum", command, ...args], { stdio: "inherit", env: environment })
	: spawnSync(command, args, { stdio: "inherit" })
if (result.error) {
	process.stderr.write(((result.error as NodeJS.ErrnoException).code === "ENOENT" && process.platform === "linux"
		? "Native tests run on a virtual display. Install Xvfb (sudo apt install xvfb), then retry."
		: result.error.message) + "\n")
	process.exit(1)
}
process.exit(result.status ?? 1)
