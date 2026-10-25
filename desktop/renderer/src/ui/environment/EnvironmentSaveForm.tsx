// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentSaveForm.tsx at 076b2c9.
// Adapted: desktop import paths, the save reports whether it succeeded, and the
// encryption password is entered in the password dialog instead of inline fields.
import { useState, type SubmitEvent } from "react"
import { HudButton } from "../hud/HudButton"
import { PasswordDialog } from "../hud/PasswordDialog"

type EnvironmentSaveFormProps = {
	editable: boolean
	dirty: boolean
	pending: boolean
	needsPassword: boolean
	confirmPassword: boolean
	canReset: boolean
	onValidate: () => boolean
	onSave: (password: string) => Promise<boolean>
	onReset: () => Promise<boolean>
}

export function EnvironmentSaveForm({
	editable, dirty, pending, needsPassword, confirmPassword, canReset, onValidate, onSave, onReset,
}: EnvironmentSaveFormProps) {
	const [asking, setAsking] = useState(false)
	const [confirmingReset, setConfirmingReset] = useState(false)
	const label = needsPassword ? "Encrypt and save" : "Save"
	const canSave = editable && dirty && !confirmingReset

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSave || !onValidate()) return
		if (needsPassword) setAsking(true)
		else void onSave("")
	}
	const save = async (password: string) => {
		if (!await onSave(password)) return "The settings were not saved."
		setAsking(false)
		return null
	}
	const reset = async () => {
		if (!canReset) return
		await onReset()
		setConfirmingReset(false)
	}

	// The dialog's form sits beside this one; forms cannot nest.
	return (
		<>
			<form
				aria-label="Save environment settings"
				className="agent-hud__environment-save flex shrink-0 flex-col gap-3 pt-4"
				onSubmit={submit}>
				{confirmingReset && <p>Are you sure? This permanently deletes all saved settings and secrets.</p>}
				<div className="flex flex-wrap justify-between gap-3">
					<div className="flex gap-3">
						{confirmingReset ? <>
							<HudButton variant="danger-confirm" disabled={!canReset} onClick={() => void reset()}>Yes, reset</HudButton>
							<HudButton variant="warning" disabled={!canReset} onClick={() => setConfirmingReset(false)}>Keep settings</HudButton>
						</> : <HudButton variant="danger" disabled={!canReset} onClick={() => setConfirmingReset(true)}>Reset environment</HudButton>}
					</div>
					<HudButton type="submit" variant="success" disabled={!canSave}>
						{pending ? "Saving…" : label}
					</HudButton>
				</div>
			</form>
			<PasswordDialog open={asking} title="Encrypt and save" label="Encryption password" confirm={confirmPassword}
				submitLabel="Encrypt and save" pendingLabel="Saving…" onSubmit={save} onCancel={() => setAsking(false)}>
				<p>{confirmPassword ? "Choose a password to encrypt your secrets." : "Enter the password your secrets are encrypted with."}</p>
			</PasswordDialog>
		</>
	)
}
