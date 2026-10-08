import { expect, test } from "./fixtures"
import fs from "node:fs/promises"
import path from "node:path"
import { createProject, projectRow, waitForProjectRowStatus } from "./helpers"

test("backend restart preserves projects and capability choices and clears stale running state", async ({ page, request }) => {
    const control = process.env.ROBOZIUM_E2E_CONTROL_DIR
    const hub = process.env.ROBOZIUM_E2E_HUB_BASE_DIR
    if (!control || !hub) throw new Error("Restart test requires the isolated runner")
    const slug = await createProject(request, `Restart recovery ${Date.now()}`)
    await page.goto("/?from=app")
    await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
    const selector = page.getByRole("form", { name: "Capability selector" })
    await selector.getByRole("checkbox", { name: "mock information", exact: true }).check()
    await selector.getByRole("checkbox", { name: "mock guidance", exact: true }).check()
    await selector.getByRole("button", { name: "Launch", exact: true }).click()
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
    await expect(selector.getByRole("checkbox", { name: "mock information", exact: true })).toBeChecked()
    await expect(selector.getByRole("checkbox", { name: "mock guidance", exact: true })).toBeChecked()
    await selector.getByRole("button", { name: "Cancel", exact: true }).click()
    await projectRow(page, slug).getByRole("button", { name: "Launch", exact: true }).click()
    await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 20_000 })
    const resumedRun = new URL(page.url()).searchParams.get("runId")!
    expect(resumedRun).not.toBe(runId)
    const response = await request.get(`/api/runs/${encodeURIComponent(resumedRun)}/view`)
    expect((await response.json()).capabilities).toMatchObject({ mock_information: true, mock_guidance: "on_demand" })
})
