import { useEffect, useRef, useState, type ReactNode } from "react"
import type { EnvironmentVariable } from "../../environment/useEnvironmentDraft"
import type { EnvironmentEntry } from "../../environment/environment-api"
import { HudButton } from "../hud/HudButton"

type EnvironmentVariableListProps = {
	variables: EnvironmentVariable[]
	editorName: string | null
	onEdit: (entry?: EnvironmentEntry) => void
	onDelete: (name: string) => void
	children: ReactNode
}

/** The row holds no value yet: a suggestion nobody filled in, or a saved empty value. */
function missingValue({ entry, assigned }: EnvironmentVariable): boolean {
	if (!entry.configured && !assigned) return !entry.overridden
	return entry.secret ? entry.value === "" : !entry.value
}

function currentValue(variable: EnvironmentVariable): string {
	const { entry, assigned } = variable
	if (!entry.configured && !assigned) return entry.overridden ? "Set in .env" : "Not set"
	if (missingValue(variable)) return "Empty"
	return entry.secret ? "●●●●●●●●" : entry.value ?? ""
}

function VariableRow({ variable, editing, disabled, onEdit, onDelete, children }: {
	variable: EnvironmentVariable
	editing: boolean
	disabled: boolean
	onEdit: (button: HTMLButtonElement) => void
	onDelete: () => void
	children: ReactNode
}) {
	const { name } = variable.entry
	// Delete asks first: a deleted key is costly to fetch again. Editing elsewhere ends the question.
	const [confirming, setConfirming] = useState(false)
	useEffect(() => { if (disabled) setConfirming(false) }, [disabled])
	return (
		<li className="agent-hud__environment-row">
			<div className="flex flex-wrap items-center justify-between gap-3 py-2">
				<div
					className="agent-hud__environment-variable flex min-w-0 flex-1 flex-wrap items-baseline gap-x-6 gap-y-1"
					data-missing={missingValue(variable) ? "" : undefined}>
					<span className="min-w-0 break-all">
						{name}
						{variable.sources.length > 0 && <span className="agent-hud__environment-value"> [{variable.sources.join(", ")}]</span>}
					</span>
					<span aria-label={`Current value for ${name}`} className="agent-hud__environment-value min-w-0 break-all">
						{currentValue(variable)}
					</span>
				</div>
				<div className="flex gap-2">
					{confirming ? <>
						<HudButton variant="danger-confirm" aria-label={`Confirm deleting ${name}`} onClick={onDelete}>
							Yes, delete
						</HudButton>
						<HudButton variant="warning" onClick={() => setConfirming(false)}>Keep</HudButton>
					</> : <>
						<HudButton aria-label={`Change ${name}`} disabled={disabled} onClick={event => onEdit(event.currentTarget)}>
							Change
						</HudButton>
						<HudButton variant="danger" aria-label={`Delete ${name}`} disabled={disabled && !editing} onClick={() => setConfirming(true)}>
							Delete
						</HudButton>
					</>}
				</div>
			</div>
			{editing && children}
		</li>
	)
}

export function EnvironmentVariableList({ variables, editorName, onEdit, onDelete, children }: EnvironmentVariableListProps) {
	const opener = useRef<HTMLButtonElement | null>(null)
	const addButton = useRef<HTMLButtonElement | null>(null)
	const editing = editorName !== null

	useEffect(() => {
		if (editing || !opener.current) return
		if (opener.current.isConnected) opener.current.focus()
		else addButton.current?.focus()
	}, [editing])

	const openEditor = (button: HTMLButtonElement, entry?: EnvironmentEntry) => {
		opener.current = button
		onEdit(entry)
	}

	return (
		<>
			<ul aria-label="Environment variables" className="flex flex-col gap-2">
				{variables.map(variable => (
					<VariableRow
						key={variable.entry.name}
						variable={variable}
						editing={editorName === variable.entry.name}
						disabled={editing}
						onEdit={button => openEditor(button, variable.entry)}
						onDelete={() => onDelete(variable.entry.name)}>
						{children}
					</VariableRow>
				))}
			</ul>
			{editorName === "" && children}
			<HudButton
				ref={addButton}
				className="self-start"
				disabled={editing}
				onClick={event => openEditor(event.currentTarget)}>
				Add variable
			</HudButton>
		</>
	)
}
