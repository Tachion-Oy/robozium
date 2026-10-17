import { net, protocol } from "electron"
import { realpath, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const rendererUrl = "robozium://app/index.html"

export async function registerRendererProtocol(baseUrl?: string): Promise<void> {
	const root = await realpath(path.join(__dirname, "renderer"))
	const csp = `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src ${baseUrl ?? "'none'"}; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`
	protocol.handle("robozium", async request => {
		if (request.method !== "GET") {
			return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } })
		}
		const url = new URL(request.url)
		if (url.host !== "app" || url.username || url.password) {
			return new Response("Not found", { status: 404 })
		}
		try {
			const pathname = decodeURIComponent(url.pathname)
			if (pathname.includes("\\") || pathname.includes("\0")
				|| pathname.split("/").some(part => part === ".." || part === ".")) {
				return new Response("Invalid path", { status: 400 })
			}
			const file = await realpath(path.join(root, pathname))
			// Resolve symlinks before checking containment; lexical checks alone leak files.
			const relative = path.relative(root, file)
			if (relative === ".." || relative.startsWith(`..${path.sep}`)
				|| path.isAbsolute(relative) || !(await stat(file)).isFile()) {
				return new Response("Not found", { status: 404 })
			}
			const response = await net.fetch(pathToFileURL(file).href)
			const headers = new Headers(response.headers)
			headers.set("Content-Security-Policy", csp)
			return new Response(response.body, { status: response.status, headers })
		} catch (error) {
			if (error instanceof URIError) return new Response("Invalid path", { status: 400 })
			if (error instanceof Error && "code" in error
				&& (error.code === "ENOENT" || error.code === "ENOTDIR")) {
				return new Response("Not found", { status: 404 })
			}
			console.error("Unable to load a bundled renderer resource:", error)
			return new Response("Unable to load resource", { status: 500 })
		}
	})
}
