import { expect, test } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { createProject, waitForProjectRowStatus } from "./helpers"

test("backend restart preserves projects and clears stale running state", async ({ page, request }) => {
    const control = process.env.ROBOSPRAWL_E2E_CONTROL_DIR
    const hub = process.env.ROBOSPRAWL_E2E_HUB_BASE_DIR
    if (!control || !hub) throw new Error("Restart test requires the isolated runner")
    const slug = await createProject(request, `Restart recovery ${Date.now()}`)
    await page.goto("/?from=app")
    await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
    await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 20_000 })
    const runId = new URL(page.url()).searchParams.get("runId")
    expect(runId).toBeTruthy()
    const sentinel = path.join(hub, "projects", slug, "retained.txt")
    await fs.writeFile(sentinel, "survives backend restart")
    await fs.rm(path.join(control, "restart.done"), { force: true })
    await fs.writeFile(path.join(control, "restart.request"), "restart")
    await expect.poll(async () => {
        try { return await fs.readFile(path.join(control, "restart.done"), "utf8") }
        catch { return "waiting" }
    }, { timeout: 30_000 }).toBe("ready")
    // Refresh the persisted run URL as a user would after an interrupted server.
    await page.goto(`/?runId=${encodeURIComponent(runId!)}`)
    await expect.poll(() => new URL(page.url()).searchParams.get("runId")).toBeNull()
    await waitForProjectRowStatus(page, slug, "DORMANT")
    expect(await fs.readFile(sentinel, "utf8")).toBe("survives backend restart")
    await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
    await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get("runId")).not.toBe(runId)
})
