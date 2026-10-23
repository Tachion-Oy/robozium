import { expect } from "@playwright/test"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { hubFilePath } from "../src/links"
import { test, documentUrl, preload } from "./native"

test("only http(s) links open, and only for the app's own document", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ shell }) => {
		const opened: string[] = []
		Reflect.set(globalThis, "openedLinks", opened)
		shell.openExternal = async url => { opened.push(url) }
	})
	await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
	const attempt = (value: unknown) => page.evaluate(async value => {
		try {
			await Reflect.apply(window.robozium.openExternal, window.robozium, [value])
			return "allowed"
		} catch {
			return "denied"
		}
	}, value)
	expect(await attempt("http://example.com/")).toBe("allowed")
	for (const value of ["file:///etc/passwd", "javascript:alert(1)", "robozium://app/index.html", "mailto:a@example.com", "example.com", 42, null]) {
		expect(await attempt(value)).toBe("denied")
	}
	expect(await app.evaluate(async ({ BrowserWindow }, { documentUrl, preload }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript(`window.robozium.openExternal("https://example.com/other").then(() => "allowed", () => "denied")`)
		} finally { other.destroy() }
	}, { documentUrl, preload })).toBe("denied")
	expect(await app.evaluate(() => Reflect.get(globalThis, "openedLinks"))).toEqual(["http://example.com/"])
})

test("hub file paths resolve inside the hub only, through symlinks too", async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "robozium-links-")))
	try {
		const hub = path.join(root, "hub")
		await mkdir(path.join(hub, "projects/demo/documents"), { recursive: true })
		await writeFile(path.join(hub, "projects/demo/documents/note.txt"), "note")
		await writeFile(path.join(root, "secret.txt"), "secret")
		await symlink(path.join(root, "secret.txt"), path.join(hub, "escape.txt"))
		await symlink(root, path.join(hub, "outside"))
		await symlink(path.join(hub, "projects/demo/documents/note.txt"), path.join(hub, "alias.txt"))

		expect(await hubFilePath(hub, "projects/demo/documents/note.txt")).toBe(path.join(hub, "projects/demo/documents/note.txt"))
		expect(await hubFilePath(hub, "projects/demo")).toBe(path.join(hub, "projects/demo"))
		expect(await hubFilePath(hub, "alias.txt")).toBe(path.join(hub, "projects/demo/documents/note.txt"))
		for (const value of ["../secret.txt", "projects/../../secret.txt", "/etc/passwd", "", "a//b", "./note.txt", "projects\\demo", 42]) {
			await expect(hubFilePath(hub, value)).rejects.toThrow(/relative path inside the hub|must be a path/)
		}
		await expect(hubFilePath(hub, "escape.txt")).rejects.toThrow("The file is outside the hub.")
		await expect(hubFilePath(hub, "outside/secret.txt")).rejects.toThrow("The file is outside the hub.")
		await expect(hubFilePath(hub, "projects/missing.txt")).rejects.toThrow("The file does not exist.")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
