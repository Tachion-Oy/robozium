import { portAvailable } from "../src/backend-controller.ts"

/**
 * A free loopback port for a test's backend.
 *
 * The port lies below the range the system assigns by itself. A port taken from
 * that range and released can go to another process, such as one of Electron's
 * debugging listeners, before the backend binds it.
 */
export async function freeApiPort(): Promise<number> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const port = 20_000 + Math.floor(Math.random() * 10_000)
		if (await portAvailable(port)) {
			return port
		}
	}
	throw new Error("No free API port between 20000 and 29999.")
}
