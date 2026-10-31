// Desktop import paths, the save reports whether it succeeded, and the
// encryption password is entered in the password dialog instead of inline fields.
// Reset is confirmed in a toast, so the buttons never move. Save, the restart
// controls the panel passes in, and Reset share one row.
import { useState, type ReactNode, type SubmitEvent } from "react"
import { Toast } from "../feedback/Toast"
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
	children?: ReactNode
}

export function EnvironmentSaveForm({
	editable, dirty, pending, needsPassword, confirmPassword, canReset, onValidate, onSave, onReset, children,
}: EnvironmentSaveFormProps) {
	const [asking, setAsking] = useState(false)
	const [confirmingReset, setConfirmingReset] = useState(false)
	const [resetting, setResetting] = useState(false)
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
		if (!canReset || resetting) return
		setResetting(true)
		try {
			await onReset()
		} finally {
			setResetting(false)
			setConfirmingReset(false)
		}
	}

	// The dialog's form sits beside this one; forms cannot nest.
	return (
		<>
			<form
				aria-label="Save environment settings"
				className="agent-hud__environment-save flex shrink-0 flex-col gap-3 pt-4"
				onSubmit={submit}>
				<div className="flex flex-wrap items-center gap-3">
					<HudButton type="submit" variant="success" pending={pending} disabled={!canSave}>
						{pending ? "Saving…" : label}
					</HudButton>
					{children}
					<HudButton variant="danger" pending={resetting} disabled={!canReset || confirmingReset}
						onClick={() => setConfirmingReset(true)}>Reset environment</HudButton>
				</div>
			</form>
			<PasswordDialog open={asking} title="Encrypt and save" label="Encryption password" confirm={confirmPassword}
				submitLabel="Encrypt and save" pendingLabel="Saving…" onSubmit={save} onCancel={() => setAsking(false)}>
				<p>{confirmPassword ? "Choose a password to encrypt your secrets." : "Enter the password your secrets are encrypted with."}</p>
			</PasswordDialog>
			{confirmingReset && !resetting && <Toast tone="warning" title="Reset environment?"
				message="This permanently deletes all saved settings and secrets." actions={[
					{ label: "Yes, reset", disabled: !canReset, onClick: reset },
					{ label: "Keep settings", onClick: () => setConfirmingReset(false) },
				]} />}
		</>
	)
}
