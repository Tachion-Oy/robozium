/** Base URL for the configured hub FastAPI server (server-side only). */
export const ROBOSPRAWL_API_BASE_URL = (() => {
	const value = process.env.ROBOSPRAWL_API_BASE_URL
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error("ROBOSPRAWL_API_BASE_URL must be set")
	}
	return value
})()
