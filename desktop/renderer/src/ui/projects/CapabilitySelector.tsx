// App owns the capability reads and passes their state in; a failed read
// is a toast with Retry, so the list never shifts. An existing project's name
// slot holds Rename, which swaps for the name field: Enter saves the rename at
// once, Escape or leaving the field drops it.
import { useEffect, useRef, useState, type ComponentProps } from "react"
import { DisplayArt } from "../branding/DisplayArt"
import type { CapabilitiesState } from "../../capabilities/useCapabilities"
import { resolveCapabilitySelection } from "../../capabilities/capabilities"
import type { LaunchDraft } from "../../app/hud-navigation"
import type { CapabilitySelection, CapabilityView } from "../../capabilities/capabilities-api"
import { CapabilityItem } from "../hud/CapabilityItem"
import { HudButton } from "../hud/HudButton"
import { Toast } from "../feedback/Toast"

type CapabilitySelectorProps = {
	draft: LaunchDraft
	capabilities: CapabilitiesState
	disabled: boolean
	onChange: (change: Partial<Pick<LaunchDraft, "name" | "selection">>) => void
	onCancel: () => void
	/** Resolves true once the project carries the new name. */
	onRename: (project: string, name: string) => Promise<boolean>
	onSubmit: (selection: CapabilitySelection) => void
}

const CAPABILITY_GROUPS = [
	{ label: "Defaults", selectable: false },
	{ label: "Selectable", selectable: true },
] as const

export function CapabilitySelector({
	draft: { project, name, selection: draftSelection },
	capabilities,
	disabled,
	onChange,
	onCancel,
	onRename,
	onSubmit,
}: CapabilitySelectorProps) {
	const { catalog, initialSelection, error: loadError, retry } = capabilities
	const currentSelection = draftSelection ?? initialSelection
	const title = useRef<HTMLHeadingElement>(null)
	const [renaming, setRenaming] = useState(false)

	useEffect(() => {
		if (project !== null) title.current?.focus()
	}, [project])

	const handleSubmit: NonNullable<ComponentProps<"form">["onSubmit"]> = (event) => {
		event.preventDefault()
		if (disabled || renaming || catalog === null || currentSelection === null || loadError || !name.trim()) return
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
			{loadError && <Toast tone="error" title="Could not load capabilities" message={loadError} actions={[{ label: "Retry", onClick: retry }]} />}
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
				) : renaming ? (
					<label className="agent-hud__capability-project">
						Project name
						<input
							type="text"
							autoFocus
							defaultValue={project}
							onFocus={(event) => event.target.select()}
							onBlur={() => setRenaming(false)}
							onKeyDown={async (event) => {
								const input = event.currentTarget
								if (event.key === "Escape") {
									event.preventDefault()
									event.stopPropagation()
									// The title takes the focus, so the next Escape still reaches the form.
									title.current?.focus()
								}
								if (event.key !== "Enter") return
								event.preventDefault()
								// Read-only while the request is out, so a second Enter sends nothing.
								if (input.readOnly || !input.value.trim()) return
								input.readOnly = true
								const renamed = await onRename(project, input.value.trim())
								input.readOnly = false
								if (renamed) setRenaming(false)
							}}
							disabled={disabled}
							placeholder="Project name"
							className="agent-hud__project-input"
						/>
					</label>
				) : (
					<div className="flex justify-center">
						<HudButton disabled={disabled} onClick={() => setRenaming(true)}>
							Rename
						</HudButton>
					</div>
				)}
			</div>
			<p>Choose agent capabilities for this launch.</p>
			<div className="agent-hud__table-scroll agent-hud__capability-list space-y-6 p-2">
				{loadError ? null : catalog === null ? (
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
										<CapabilityItem
											key={capability.name}
											capability={capability}
											selection={{
												checked: !capability.selectable || Boolean(currentSelection && Object.hasOwn(currentSelection, capability.name) && currentSelection[capability.name]),
												disabled: disabled || !capability.selectable,
												onToggle: () => handleCapabilityToggle(capability),
											}}
										/>
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
					className="agent-hud__panel-action agent-hud__start"
						disabled={disabled || renaming || catalog === null || currentSelection === null || Boolean(loadError) || !name.trim()}>
					<DisplayArt name="launch" label={disabled ? "Launching…" : "Launch"} />
				</button>
				<button
					type="button"
					className="agent-hud__panel-action agent-hud__start"
					disabled={disabled}
					onClick={onCancel}>
					<DisplayArt name="cancel" />
				</button>
			</div>
		</form>
	)
}
