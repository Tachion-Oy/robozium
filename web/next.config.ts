import { readFileSync } from "node:fs"
import path from "node:path"
import type { NextConfig } from "next"

function readHubName(): string {
	const source = readFileSync(path.resolve(__dirname, "..", "hub.config.py"), "utf8")
	const match = source.match(/^NAME:\s*Final\s*=\s*["']([^"']+)["']/m)
	if (!match) throw new Error("hub.config.py must declare NAME: Final = \"...\"")
	return match[1]
}

// Paths the client polls on a timer (run view every ~2s, projects every ~3s).
// Their dev access logs drown out everything else, so we drop them.
// Mirrors the backend's uvicorn access-log filter for the same endpoints.
const POLLING_REQUEST_PATHS = [
	/^\/api\/projects(?:[?#]|$)/,
	/^\/api\/runs\/[^/]+\/view(?:[?#]|$)/,
]

const nextConfig: NextConfig = {
	output: "standalone",
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
