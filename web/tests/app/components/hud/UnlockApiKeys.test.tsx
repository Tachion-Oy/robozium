import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { UnlockApiKeys } from "../../../../app/components/hud/UnlockApiKeys"

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

it("submits a transient password, removes keys, and supports another unlock", async () => {
	const fetchMock = vi.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, locked: true, removable: false }), { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Could not unlock Secrets" }), { status: 400 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, locked: false, removable: true }), { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, locked: false, removable: true }), { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, locked: true, removable: false }), { status: 200 }))
		.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, locked: false, removable: true }), { status: 200 }))
	vi.stubGlobal("fetch", fetchMock)
	render(<UnlockApiKeys />)

	fireEvent.click(await screen.findByRole("button", { name: "Secrets locked" }))
	const field = screen.getByLabelText("Secret password") as HTMLInputElement
	expect(field.type).toBe("password")
	fireEvent.change(field, { target: { value: "wrong" } })
	fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }))
	await screen.findByRole("alert")
	expect(field.value).toBe("")
	fireEvent.change(field, { target: { value: "test-password" } })
	fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }))
	await waitFor(() => expect(screen.getByRole("button", { name: "Secrets unlocked" })).toBeTruthy())
	expect(screen.queryByLabelText("Secret password")).toBeNull()
	expect(fetchMock.mock.calls[2][0]).toBe("/api/credentials/unlock")
	expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ password: "test-password" })
	fireEvent.click(screen.getByRole("button", { name: "Secrets unlocked" }))
	fireEvent.click(await screen.findByRole("button", { name: "Clear unlocked secrets" }))
	await waitFor(() => expect(screen.getByRole("button", { name: "Secrets locked" })).toBeTruthy())
	expect(fetchMock.mock.calls[4][0]).toBe("/api/credentials/clear")
	fireEvent.click(screen.getByRole("button", { name: "Secrets locked" }))
	fireEvent.change(screen.getByLabelText("Secret password"), { target: { value: "test-password" } })
	fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }))
	await screen.findByRole("button", { name: "Secrets unlocked" })
})

it("hides the control without encrypted keys", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
		available: false, locked: false, removable: false,
	}), { status: 200 })))
	render(<UnlockApiKeys />)
	await waitFor(() => expect(fetch).toHaveBeenCalled())
	expect(screen.queryByRole("button", { name: /Secrets/ })).toBeNull()
})

it("keeps removal available in the unlocked menu", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
		available: true, locked: false, removable: true,
	}), { status: 200 })))
	render(<UnlockApiKeys />)
	fireEvent.click(await screen.findByRole("button", { name: "Secrets unlocked" }))
	expect(screen.getByRole("button", { name: "Clear unlocked secrets" }).hasAttribute("disabled")).toBe(false)
	expect(screen.queryByText("Available when all work finishes.")).toBeNull()
})
