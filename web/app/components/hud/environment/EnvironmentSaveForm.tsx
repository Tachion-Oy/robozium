import { useState, type SubmitEvent } from "react"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { HudButton } from "../HudButton"

type EnvironmentSaveFormProps = {
	editable: boolean
	dirty: boolean
	pending: boolean
	needsPassword: boolean
	confirmPassword: boolean
	onValidate: () => boolean
	onSave: (password: string) => Promise<void>
}

export function EnvironmentSaveForm({
	editable, dirty, pending, needsPassword, confirmPassword, onValidate, onSave,
}: EnvironmentSaveFormProps) {
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const label = needsPassword ? "Encrypt and save" : "Save"

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!editable || !dirty || !onValidate()) return
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
						disabled={!editable || !dirty}
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
							disabled={!editable || !dirty}
							placeholder="Confirm password"
							value={confirmation}
							onChange={event => setConfirmation(event.target.value)}
						/>
					)}
				</div>
			)}
			<div className="flex justify-end">
				<HudButton type="submit" variant="success" disabled={!editable || !dirty}>
					{pending ? "Saving…" : label}
				</HudButton>
			</div>
		</form>
	)
}
