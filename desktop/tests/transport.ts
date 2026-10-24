import { readFile } from "node:fs/promises"
import path from "node:path"
import { transpileModule, ModuleKind, ScriptTarget } from "typescript"
import type { Page } from "@playwright/test"
import type { DesktopApiClient } from "../renderer/src/api/client"

declare global {
	interface Window { testApi: DesktopApiClient }
}

/** Execute the actual client in the native renderer without production test controls. */
export async function installTestClient(page: Page, baseUrl: string) {
	const source = await readFile(path.resolve(import.meta.dirname, "../renderer/src/api/client.ts"), "utf8")
	const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } })
	await page.evaluate(`(() => { const exports = {}; ${outputText}\nwindow.testApi = new exports.DesktopApiClient(${JSON.stringify(baseUrl)}); })()`)
}
