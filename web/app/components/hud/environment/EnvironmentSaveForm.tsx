import { useState, type SubmitEvent } from "react"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { HudButton } from "../HudButton"

type EnvironmentSaveFormProps = {
	editable: boolean
	dirty: boolean
	pending: boolean
	needsPassword: boolean
	confirmPassword: boolean
	canReset: boolean
	onValidate: () => boolean
	onSave: (password: string) => Promise<void>
	onReset: () => Promise<boolean>
}

export function EnvironmentSaveForm({
	editable, dirty, pending, needsPassword, confirmPassword, canReset, onValidate, onSave, onReset,
}: EnvironmentSaveFormProps) {
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const [confirmingReset, setConfirmingReset] = useState(false)
	const label = needsPassword ? "Encrypt and save" : "Save"
	const canSave = editable && dirty && !confirmingReset

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!canSave || !onValidate()) return
		if (needsPassword && !password) {
			showErrorToast({
				title: "Encryption password required",
				message: "Enter an encryption password before saving.",
			})
			return
		}
		if (needsPassword && confirmPassword && password !== confirmation) {
			showErrorToast({
				title: "Passwords do not match",
				message: "Enter the same password in both fields.",
			})
			return
		}
		setPassword("")
		setConfirmation("")
		void onSave(password)
	}
	const reset = async () => {
		if (!canReset) return
		if (await onReset()) {
			setPassword("")
			setConfirmation("")
		}
		setConfirmingReset(false)
	}

	return (
		<form
			aria-label="Save environment settings"
			className="agent-hud__environment-save flex shrink-0 flex-col gap-3 pt-4"
			onSubmit={submit}>
			{needsPassword && (
				<div className="flex flex-wrap gap-3">
					<input
						aria-label="Encryption password"
						className="agent-hud__project-input min-w-0 flex-1"
						type="password"
						autoComplete="off"
						disabled={!canSave}
						placeholder="Encryption password"
						value={password}
						onChange={event => setPassword(event.target.value)}
					/>
					{confirmPassword && (
						<input
							aria-label="Confirm encryption password"
							className="agent-hud__project-input min-w-0 flex-1"
							type="password"
							autoComplete="off"
							disabled={!canSave}
							placeholder="Confirm password"
							value={confirmation}
							onChange={event => setConfirmation(event.target.value)}
						/>
					)}
				</div>
			)}
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
	)
}
