import fs from "node:fs"
import path from "node:path"
import type { NextConfig } from "next"

type HubConfigFile = {
	hub?: {
		name?: unknown
	}
}

function readHubName(): string {
	const configPath = path.resolve(__dirname, "..", "hub.config.json")
	if (!fs.existsSync(configPath)) return "robosprawl"

	const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as HubConfigFile
	const configuredName = parsed.hub?.name
	return typeof configuredName === "string" && configuredName.trim()
		? configuredName
		: "robosprawl"
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
