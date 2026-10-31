import type { EnvironmentEntry } from "../../environment/environment-api"
import { HudButton } from "../hud/HudButton"

type EnvironmentVariableEditorProps = {
	entry: EnvironmentEntry
	original: EnvironmentEntry
	disabled: boolean
	onChange: (entry: EnvironmentEntry) => void
	onApply: () => void
	onCancel: () => void
}

export function EnvironmentVariableEditor({
	entry, original, disabled, onChange, onApply, onCancel,
}: EnvironmentVariableEditorProps) {
	return (
		<form
			aria-label="Variable editor"
			className="agent-hud__environment-editor flex flex-col gap-3 p-3"
			onSubmit={event => { event.preventDefault(); onApply() }}>
			<div className="flex flex-wrap gap-3">
				<label className="flex min-w-0 flex-1 flex-col gap-1">
					Name
					<input
						autoFocus
						className="agent-hud__project-input"
						value={entry.name}
						disabled={disabled}
						onChange={event => onChange({ ...entry, name: event.target.value })}
					/>
				</label>
				<label className="flex min-w-0 flex-1 flex-col gap-1">
					Value
					<input
						aria-label={`Value for ${entry.name || "new variable"}`}
						className="agent-hud__project-input"
						type={entry.secret ? "password" : "text"}
						autoComplete="off"
						disabled={disabled}
						value={entry.value ?? ""}
						placeholder={original.secret && original.value === null ? "Leave unchanged or replace" : ""}
						onChange={event => onChange({ ...entry, value: event.target.value })}
					/>
				</label>
			</div>
			{entry.overridden && <p>Overridden by .env</p>}
			<div className="flex flex-wrap items-center gap-3">
				<HudButton
					variant={entry.secret ? "danger-confirm" : "danger"}
					role="checkbox"
					aria-checked={entry.secret}
					disabled={disabled}
					onClick={() => onChange({ ...entry, secret: !entry.secret })}>
					Secret
				</HudButton>
				<HudButton type="submit" variant="success" disabled={disabled}>Apply</HudButton>
				<HudButton variant="warning" onClick={onCancel}>Cancel</HudButton>
			</div>
		</form>
	)
}
