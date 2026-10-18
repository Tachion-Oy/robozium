import { createElement, useState } from "react"
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReplyImages } from "../../../../../hooks/useReplyImages"
import { AgentActivityState } from "../../../../../lib/robozium/session/reducer"
vi.mock("@/lib/robozium/public-config", () => ({
	HUB_HOME_ARIA_LABEL: "Hub home",
}))
import { ReplyForm } from "../../../../../app/components/hud/run/ReplyForm"

type Props = Parameters<typeof ReplyForm>[0]
type Overrides = {
	message?: Partial<Props["message"]>
	composer?: Partial<Props["composer"]>
	navigation?: Partial<Props["navigation"]>
	layoutMode?: Props["layoutMode"]
	controls?: {
		dictation?: Partial<Props["controls"]["dictation"]>
		cancel?: Props["controls"]["cancel"]
		interrupt?: Props["controls"]["interrupt"]
	}
}

function createProps(overrides: Overrides = {}): Props {
	return {
		message: {
			contentType: "markdown",
			id: "live:passive",
			content: "",
			mode: "current",
			...overrides.message,
		},
		composer: {
			value: "",
			images: { images: [], error: null, onDrop: () => {}, onRemove: () => {}, onClear: () => {} },
			isReplyAvailable: false,
			isSubmitting: false,
			onChange: () => {},
			onSubmit: () => {},
			...overrides.composer,
		},
		navigation: {
			agentActivityState: AgentActivityState.Working,
			enabled: {
				first: false,
				previous: false,
				next: false,
				latest: false,
			},
			onNavigate: () => {},
			...overrides.navigation,
		},
		layoutMode: overrides.layoutMode ?? "top",
		controls: {
			dictation: {
				isRecording: false,
				isTranscribing: false,
				onToggle: () => {},
				...overrides.controls?.dictation,
			},
			cancel: overrides.controls?.cancel,
			interrupt: overrides.controls?.interrupt,
		},
	}
}

function renderForm(overrides: Overrides = {}) {
	return render(createElement(ReplyForm, createProps(overrides)))
}

describe("ReplyForm", () => {
	it("keeps history editable when newer messages are navigable", () => {
		const { container } = renderForm({
			message: { contentType: "markdown",  content: "Older prompt", mode: "history" },
			composer: {
				value: "saved draft",
				isReplyAvailable: true,
			},
			navigation: {
				agentActivityState: AgentActivityState.AwaitingInput,
				enabled: {
					first: false,
					previous: false,
					next: true,
					latest: true,
				},
			},
		})

		expect(container.querySelector("form")?.dataset.history).toBe("true")
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
			"saved draft",
		)
		expect(
			screen
				.getByRole("button", { name: "Next agent message" })
				.hasAttribute("data-new-message"),
		).toBe(false)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(false)
			expect(
				container
					.querySelector(".agent-hud__logo--actions")
					?.getAttribute("data-agent-state"),
			).toBe(AgentActivityState.AwaitingInput)
		expect(container.querySelector("form")?.dataset.agentState).toBe(
			AgentActivityState.AwaitingInput,
		)
	})

	it("keeps the composer available while the agent is working", () => {
		const { container } = renderForm({
			message: { mode: "streaming" },
			navigation: { agentActivityState: AgentActivityState.Working },
		})
		expect(
			(screen.getByRole("textbox") as HTMLTextAreaElement).disabled,
		).toBe(false)
		expect(screen.getByRole("button", { name: "Record" })).not.toBeNull()
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(
			container
				.querySelector(".agent-hud__logo--actions")
				?.getAttribute("data-agent-state"),
		).toBe(AgentActivityState.Working)
		expect(container.querySelector(".agent-hud__seam")).toBeNull()
	})

	it("keeps drafting and recording available during other control requests", () => {
		const onToggle = vi.fn()
		renderForm({
			composer: {
				value: "next thought",
				isReplyAvailable: true,
				isSubmitting: true,
			},
			controls: {
				dictation: { onToggle },
				cancel: { isPending: true, onTrigger: () => {} },
				interrupt: { isPending: true, onTrigger: () => {} },
			},
		})

		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		fireEvent.click(screen.getByRole("button", { name: "Record" }))
		expect(onToggle).toHaveBeenCalledTimes(1)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("allows submit shortcuts when a reply is available", () => {
		const onSubmit = vi.fn()
		renderForm({
			composer: {
				value: "reply",
				isReplyAvailable: true,
				onSubmit,
			},
		})

		fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Enter",
			shiftKey: false,
		})
		expect(onSubmit).toHaveBeenCalledTimes(1)
	})

	it("copies the exact controlled reply draft from before the Record control", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		const { container } = renderForm({
			composer: { value: "  transcribed reply\n" },
		})

		fireEvent.click(screen.getByRole("button", { name: "Copy user reply" }))
		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith("  transcribed reply\n"),
		)
		const controls = Array.from(
			container.querySelectorAll(".agent-hud__actions-submit button"),
		)
		expect(controls[0].getAttribute("aria-label")).toBe("Clear reply")
		expect(controls[1].getAttribute("aria-label")).toBe("User reply copied")
		expect(controls[3].textContent?.trim()).toBe("image")
		expect(controls[4].textContent).toBe("Record")
	})

	it("clears the controlled lower-panel reply", () => {
		const onChange = vi.fn()
		renderForm({ composer: { value: "Remove me", onChange } })

		fireEvent.click(screen.getByRole("button", { name: "Clear reply" }))
		expect(onChange).toHaveBeenCalledWith("")
	})

})

function DraftForm({ onSubmit = () => {} }: { onSubmit?: () => void }) {
	const [value, onChange] = useState("Draft text")
	const images = useReplyImages("run-1")
	return <ReplyForm {...createProps({ composer: { value, onChange, images, isReplyAvailable: true, onSubmit } })} />
}

describe("local image replies", () => {
	let nextUrl = 0
	beforeEach(() => {
		nextUrl = 0
		vi.stubGlobal("URL", class extends URL {
			static createObjectURL = vi.fn(() => `blob:preview-${++nextUrl}`)
			static revokeObjectURL = vi.fn()
		})
	})
	afterEach(() => { vi.unstubAllGlobals() })

	async function addFile(target: HTMLElement, name: string, type = "image/png", event = "paste") {
		const file = new File(["image"], name, { type })
		const transfer = {
			files: [file], types: ["Files"],
			items: [{ kind: "file", type, getAsFile: () => file }],
		}
		if (event === "drop") fireEvent.drop(target, { dataTransfer: transfer })
		else fireEvent.paste(target, { clipboardData: transfer })
		await waitFor(() => expect(screen.getByRole("img", { name })).not.toBeNull())
	}

	it("pastes across the panel, keeps selection, and scrolls to the new image and start of text", async () => {
		render(<DraftForm />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
		textarea.focus()
		textarea.setSelectionRange(1, 4, "backward")
		textarea.scrollTop = 25
		await addFile(screen.getByRole("group", { name: "Reply composer" }), "one.png")
		expect(textarea.value).toBe("Draft text")
		expect([textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection]).toEqual([1, 4, "backward"])
		expect(document.activeElement).toBe(textarea)
		expect(textarea.scrollTop).toBe(0)
		const list = screen.getByRole("list", { name: "Image previews" })
		Object.defineProperty(list, "scrollHeight", { value: 300 })
		textarea.scrollTop = 30
		await addFile(textarea, "two.jpg", "image/jpeg")
		await addFile(screen.getByRole("img", { name: "one.png" }), "three.webp", "image/webp")
		await addFile(screen.getByRole("button", { name: "Remove two.jpg" }), "four.gif", "image/gif")
		expect(list.scrollTop).toBe(300)
		expect(textarea.scrollTop).toBe(0)
		expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual(["one.png", "two.jpg", "three.webp", "four.gif"])
	})

	it("leaves text paste, Shift+Enter, and editing shortcuts untouched", () => {
		render(<DraftForm />)
		const textarea = screen.getByRole("textbox")
		const paste = createEvent.paste(textarea, { clipboardData: { types: ["text/plain"], items: [], files: [], getData: () => "text" } })
		fireEvent(textarea, paste)
		expect(paste.defaultPrevented).toBe(false)
		for (const options of [{ key: "Enter", shiftKey: true }, { key: "a", ctrlKey: true }, { key: "z", metaKey: true }]) {
			const event = createEvent.keyDown(textarea, options)
			fireEvent(textarea, event)
			expect(event.defaultPrevented).toBe(false)
		}
	})

	it("accepts picker and drop input repeatedly, loads previews, and removes only the chosen image", async () => {
		const { container } = render(<DraftForm />)
		const input = container.querySelector<HTMLInputElement>("input[type=file]")!
		const click = vi.spyOn(input, "click")
		fireEvent.click(screen.getByRole("button", { name: "image" }))
		expect(click).toHaveBeenCalledTimes(1)
		fireEvent.change(input, { target: { files: [new File(["png"], "one.png", { type: "image/png" })] } })
		await waitFor(() => expect(screen.getByRole("img", { name: "one.png" })).not.toBeNull())
		expect(screen.getByText("Loading…")).not.toBeNull()
		fireEvent.load(screen.getByRole("img", { name: "one.png" }))
		expect(screen.queryByText("Loading…")).toBeNull()
		await addFile(screen.getByRole("group", { name: "Reply composer" }), "two.png", "image/png", "drop")
		fireEvent.error(screen.getByRole("img", { name: "two.png" }))
		expect(screen.queryByText("Loading…")).toBeNull()
		expect(screen.getByText("Preview unavailable")).not.toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }))
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")
		expect(screen.getAllByRole("img")).toHaveLength(1)
		expect(document.activeElement).toBe(screen.getByRole("textbox"))
		fireEvent.click(screen.getByRole("button", { name: "Remove two.png" }))
		expect(screen.queryByRole("list", { name: "Image previews" })).toBeNull()
		expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false)
	})

	it("blocks button, Enter, and direct form submission until all images are removed", async () => {
		const onSubmit = vi.fn()
		const { container } = render(<DraftForm onSubmit={onSubmit} />)
		await addFile(screen.getByRole("textbox"), "one.png")
		expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByText("Images can be previewed but not sent yet.")).not.toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Send" }))
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
		fireEvent.submit(container.querySelector("form")!)
		expect(onSubmit).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }))
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
		expect(onSubmit).toHaveBeenCalledTimes(1)
	})

	it("rejects unsupported, oversized, and excess additions without losing existing images", async () => {
		const { container } = render(<DraftForm />)
		const input = container.querySelector<HTMLInputElement>("input[type=file]")!
		await addFile(screen.getByRole("textbox"), "kept.png")
		const invalid = new File(["svg"], "bad.svg", { type: "image/svg+xml" })
		const large = new File(["png"], "large.png", { type: "image/png" })
		Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 })
		for (const [files, reason] of [
			[[invalid], "Use PNG, JPEG, WebP, or GIF"],
			[[large], "10 MiB or smaller"],
			[Array.from({ length: 4 }, (_, i) => new File(["png"], `${i}.png`, { type: "image/png" })), "up to four images"],
			[Array.from({ length: 5 }, (_, i) => new File(["png"], `${i}.png`, { type: "image/png" })), "up to four images"],
		] as const) {
			fireEvent.change(input, { target: { files } })
			await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(reason))
			expect(screen.getAllByRole("img")).toHaveLength(1)
			expect(screen.getByRole("img", { name: "kept.png" })).not.toBeNull()
		}
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
		const boundary = new File(["png"], "at-limit.png", { type: "image/png" })
		Object.defineProperty(boundary, "size", { value: 10 * 1024 * 1024 })
		fireEvent.change(input, { target: { files: [boundary] } })
		await waitFor(() => expect(screen.getByRole("img", { name: "at-limit.png" })).not.toBeNull())
		expect(screen.queryByRole("alert")).toBeNull()
	})

	it("copies text only and clears text and all images, including image-only drafts", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		render(<DraftForm />)
		await addFile(screen.getByRole("textbox"), "one.png")
		fireEvent.click(screen.getByRole("button", { name: "Copy user reply" }))
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("Draft text"))
		fireEvent.click(screen.getByRole("button", { name: "Clear reply" }))
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
		expect(screen.queryByRole("img")).toBeNull()
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")
		await addFile(screen.getByRole("textbox"), "only.png")
		expect((screen.getByRole("button", { name: "Clear reply" }) as HTMLButtonElement).disabled).toBe(false)
		fireEvent.click(screen.getByRole("button", { name: "Clear reply" }))
		expect(screen.queryByRole("img")).toBeNull()
	})
})
