"use client"

import { useState, type ComponentProps } from "react"
import { DisplayArt } from "@/app/components/branding/DisplayArt"

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>

type CreateRunFormProps = {
	isCreating: boolean
	onCancel: () => void
	onSubmit: (projectName: string) => void
}

const HUD_TEXT =
	"font-[family-name:var(--font-agent-input)] text-[color:var(--hud-input-text)]"

export function CreateRunForm({
	isCreating,
	onCancel,
	onSubmit,
}: CreateRunFormProps) {
	const [projectName, setProjectName] = useState("")
	const trimmedProjectName = projectName.trim()

	const handleSubmit: FormSubmitHandler = (event) => {
		event.preventDefault()
		if (!trimmedProjectName || isCreating) return
		onSubmit(trimmedProjectName)
	}

	return (
		<form
			className="flex flex-wrap items-center justify-center gap-4"
			onSubmit={handleSubmit}>
			<label
				className="sr-only"
				htmlFor="project-name">
				Project name
			</label>
			<input
				id="project-name"
				type="text"
				autoFocus
				value={projectName}
				onChange={(event) => setProjectName(event.target.value)}
				disabled={isCreating}
				placeholder="Project name"
				className={`agent-hud__project-input ${HUD_TEXT}`}
			/>
			<button
				type="submit"
				disabled={isCreating || !trimmedProjectName}
				className="app-nav__cta agent-hud__start">
				<DisplayArt name="create-project" />
			</button>
			<button
				type="button"
				onClick={onCancel}
				disabled={isCreating}
				className="app-nav__cta agent-hud__start">
				<DisplayArt name="cancel" />
			</button>
		</form>
	)
}
