// A backend this launch connects to without managing it, such as a test server or a mock
// backend started by hand. Only a local HTTP origin is accepted.
const FLAG = "--backend-url="

/**
 * The origin from `--backend-url=<url>`, or null when absent. The renderer and the API
 * accept only 127.0.0.1, so `localhost` is given as that address.
 */
export function backendUrl(argv: readonly string[]): string | null {
	const argument = argv.find(value => value.startsWith(FLAG))
	if (argument === undefined) return null
	let url: URL
	try {
		url = new URL(argument.slice(FLAG.length))
	} catch {
		throw new TypeError("--backend-url must be a URL.")
	}
	if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") || !url.port
		|| url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new TypeError("--backend-url must be http://127.0.0.1:<port> or http://localhost:<port>.")
	}
	return `http://127.0.0.1:${url.port}`
}
