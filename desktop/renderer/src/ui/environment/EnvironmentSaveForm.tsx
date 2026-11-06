// Desktop import paths: the save shows its own outcome, so the form only waits for it,
// and the encryption password is entered in the password dialog instead of inline fields.
// Save, the restart controls the panel passes in, and Reset share one row; Reset acts
// on its click and reports in a toast, so the buttons never move.
import { useState, type ReactNode, type SubmitEvent } from "react"
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
	/** Saves and reports the outcome itself; the form only waits for it. */
	onSave: (password: string) => Promise<unknown>
	onReset: () => Promise<boolean>
	children?: ReactNode
}

export function EnvironmentSaveForm({
	editable, dirty, pending, needsPassword, confirmPassword, canReset, onValidate, onSave, onReset, children,
}: EnvironmentSaveFormProps) {
	const [asking, setAsking] = useState(false)
	const [resetting, setResetting] = useState(false)
	const label = needsPassword ? "Encrypt and save" : "Save"
	const canSave = editable && dirty

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSave || !onValidate()) return
		if (needsPassword) setAsking(true)
		else void onSave("")
	}
	// The dialog closes whether or not the save succeeds: a failure's reason shows as a toast,
	// which an open modal dialog would hide, and the edits stay for another try.
	const save = async (password: string) => {
		await onSave(password)
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
					<HudButton variant="danger" pending={resetting} disabled={!canReset} onClick={() => void reset()}>Reset environment</HudButton>
				</div>
			</form>
			<PasswordDialog open={asking} title="Encrypt and save" label="Encryption password" confirm={confirmPassword}
				submitLabel="Encrypt and save" pendingLabel="Saving…" onSubmit={save} onCancel={() => setAsking(false)}>
				<p>{confirmPassword ? "Choose a password to encrypt your secrets." : "Enter the password your secrets are encrypted with."}</p>
			</PasswordDialog>
		</>
	)
}
