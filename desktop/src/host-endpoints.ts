import { lstatSync, unlinkSync } from "node:fs"
import net from "node:net"

/** A service's endpoint as declared in the layout file: its type plus that type's own settings. */
export type EndpointDeclaration = { type: string } & Readonly<Record<string, unknown>>

/** What the layout knows when an endpoint type turns a declaration into an address. */
export interface EndpointContext {
	/** The host path behind a container path. */
	hostPath(containerPath: string): string
	/** The API container's declared environment. */
	containerEnvironment: Readonly<Record<string, string>>
}

/** How the desktop reaches one kind of host service endpoint. A new transport is a new entry in `endpointTypes`. */
export interface EndpointType {
	/** The address the service serves on, from its declaration. */
	resolve(declaration: EndpointDeclaration, context: EndpointContext): string
	/** Whether a service accepts connections at `address`. */
	answers(address: string): Promise<boolean>
	/** Remove what a stopped service left at `address`; false when a running service already answers there. */
	clear(address: string): Promise<boolean>
}

function socketAnswers(address: string): Promise<boolean> {
	return new Promise(resolve => {
		const connection = net.createConnection(address)
		connection.setTimeout(1000)
		// Hang up without cutting off what the service sends first, so a probe is not a delivery failure.
		connection.once("connect", () => { resolve(true); connection.resume().end() })
		connection.once("timeout", () => { connection.destroy(); resolve(false) })
		connection.once("error", () => resolve(false))
	})
}

/** A socket file in a folder shared with the container; `variable` names the API's setting holding its container path. */
const unixSocket: EndpointType = {
	resolve(declaration, context) {
		const variable = declaration.variable
		const containerPath = typeof variable === "string" ? context.containerEnvironment[variable] : undefined
		if (!containerPath) throw new Error("A unix-socket endpoint names the API environment variable holding its path.")
		return context.hostPath(containerPath)
	},
	answers: socketAnswers,
	async clear(address) {
		let entry
		try {
			entry = lstatSync(address)
		} catch {
			return true
		}
		if (!entry.isSocket()) throw new Error(`${address} is not a socket. Remove it, then retry.`)
		if (await socketAnswers(address)) return false
		// A crashed service leaves its socket behind, and services refuse to replace one.
		unlinkSync(address)
		return true
	},
}

const endpointTypes: Readonly<Record<string, EndpointType>> = { "unix-socket": unixSocket }

export function endpointType(type: string): EndpointType {
	const endpoint = endpointTypes[type]
	if (!endpoint) throw new Error(`Unknown host service endpoint type ${type}.`)
	return endpoint
}
