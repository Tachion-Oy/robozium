"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { DisplayArt } from "@/app/components/branding/DisplayArt"
import { useCapabilities } from "@/hooks/useCapabilities"
import { resolveCapabilitySelection } from "@/lib/robozium/capabilities"
import type { LaunchDraft } from "@/lib/robozium/hud-navigation"
import type { CapabilitySelection, CapabilityView } from "@/lib/robozium/wire"

type CapabilitySelectorProps = {
	draft: LaunchDraft
	disabled: boolean
	onChange: (change: Partial<Pick<LaunchDraft, "name" | "selection">>) => void
	onCancel: () => void
	onSubmit: (selection: CapabilitySelection) => void
}

const CAPABILITY_GROUPS = [
	{ label: "Defaults", selectable: false },
	{ label: "Selectable", selectable: true },
] as const

export function CapabilitySelector({
	draft: { project, name, selection: draftSelection },
	disabled,
	onChange,
	onCancel,
	onSubmit,
}: CapabilitySelectorProps) {
	const { catalog, initialSelection, error: loadError, retry } = useCapabilities(project)
	const currentSelection = draftSelection ?? initialSelection
	const title = useRef<HTMLHeadingElement>(null)

	useEffect(() => {
		if (project !== null) title.current?.focus()
	}, [project])

	const handleSubmit: NonNullable<ComponentProps<"form">["onSubmit"]> = (event) => {
		event.preventDefault()
		if (disabled || catalog === null || currentSelection === null || loadError || !name.trim()) return
		onSubmit(resolveCapabilitySelection(catalog, currentSelection))
	}

	const handleCapabilityToggle = ({ name, loading }: CapabilityView) => {
		const nextSelection = {
			...currentSelection,
			[name]: initialSelection && Object.hasOwn(initialSelection, name)
				? initialSelection[name]
				: loading ?? true,
		}
		if (currentSelection && Object.hasOwn(currentSelection, name) && currentSelection[name]) {
			delete nextSelection[name]
		}
		onChange({ selection: nextSelection })
	}

	return (
		<form
			aria-label="Capability selector"
			aria-busy={disabled}
			className="agent-hud__project-view agent-hud__capability-selector"
			onSubmit={handleSubmit}
			onKeyDown={(event) => {
				if (event.key !== "Escape") return
				event.preventDefault()
				event.stopPropagation()
				if (!disabled) onCancel()
			}}>
			<h2 ref={title} tabIndex={-1} className="text-center">
				{project === null ? "New Project" : `Project: ${project}`}
			</h2>
			<div className="min-h-12">
				{project === null ? (
					<label className="agent-hud__capability-project">
						Project name
						<input
							type="text"
							autoFocus
							value={name}
								onChange={(event) => onChange({ name: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === "Enter") event.preventDefault()
							}}
							disabled={disabled}
							placeholder="Project name"
							className="agent-hud__project-input"
						/>
					</label>
				) : null}
			</div>
			<p>Choose agent capabilities for this launch.</p>
			<div className="agent-hud__table-scroll agent-hud__capability-list space-y-6 p-2">
				{loadError ? (
					<div role="alert">
						<p>{loadError}</p>
						<button
							type="button"
							className="agent-hud__row-action agent-hud__row-tools"
								onClick={retry}>
							Retry
						</button>
					</div>
				) : catalog === null ? (
					<p role="status">Loading capabilities…</p>
				) : (
					CAPABILITY_GROUPS.map((group) => {
						const capabilities = catalog.filter((capability) => capability.selectable === group.selectable)
						if (capabilities.length === 0) return null
						return (
							<section key={group.label} aria-label={group.label}>
								<h3 className="agent-hud__capability-group-heading mb-3">{group.label}</h3>
								<div className="flex flex-wrap gap-3">
									{capabilities.map((capability) => (
										<button
											key={capability.name}
											type="button"
											role="checkbox"
											aria-label={capability.name.replaceAll("_", " ")}
											aria-checked={!capability.selectable || (currentSelection !== null && Object.hasOwn(currentSelection, capability.name) && Boolean(currentSelection[capability.name]))}
											disabled={disabled || !capability.selectable}
											className="agent-hud__row-action agent-hud__capability-option flex items-center gap-3"
											onClick={() => handleCapabilityToggle(capability)}>
											<span className="agent-hud__capability-name">
												{capability.name.replaceAll("_", " ")}
											</span>
											{capability.kind === "skill" ? (
												<span className="agent-hud__capability-badge">Skill</span>
											) : null}
										</button>
									))}
								</div>
							</section>
						)
					})
				)}
			</div>
			<div className="agent-hud__capability-actions">
				<button
					type="submit"
					className="app-nav__cta agent-hud__start"
						disabled={disabled || catalog === null || currentSelection === null || Boolean(loadError) || !name.trim()}>
					<DisplayArt name="launch" label={disabled ? "Launching…" : "Launch"} />
				</button>
				<button
					type="button"
					className="app-nav__cta agent-hud__start"
					disabled={disabled}
					onClick={onCancel}>
					<DisplayArt name="cancel" />
				</button>
			</div>
		</form>
	)
}
