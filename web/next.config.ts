import { execFileSync } from "node:child_process"
import path from "node:path"
import type { NextConfig } from "next"

function readHubName(): string {
	const python = process.env.ROBOSPRAWL_PYTHON
		?? path.resolve(__dirname, "..", ".venv", "bin", "python")
	return execFileSync(python, [
		"-I",
		"-c",
		"from robosprawl.hub.utils import load_hub; print(load_hub().name)",
	], {
		cwd: path.resolve(__dirname, ".."),
		encoding: "utf8",
	}).trim()
}

// Paths the client polls on a timer (run view every ~2s, projects every ~3s).
// Their dev access logs drown out everything else, so we drop them.
// Mirrors the backend's uvicorn access-log filter for the same endpoints.
const POLLING_REQUEST_PATHS = [
	/^\/api\/projects(?:[?#]|$)/,
	/^\/api\/runs\/[^/]+\/view(?:[?#]|$)/,
]

const nextConfig: NextConfig = {
	// Next 16 blocks dev resources for hosts other than localhost; without this,
	// opening the dev server via 127.0.0.1 hydrates a dead, non-interactive page.
	allowedDevOrigins: ["127.0.0.1"],
	env: {
		NEXT_PUBLIC_ROBOSPRAWL_NAME: readHubName(),
	},
	logging: {
		incomingRequests: {
			ignore: POLLING_REQUEST_PATHS,
		},
	},
}

export default nextConfig
