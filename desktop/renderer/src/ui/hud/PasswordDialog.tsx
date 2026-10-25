// The one place the user types a secrets password: a modal dialog that holds focus
// until the password is accepted or the dialog is cancelled. Failures show in place.
import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react"
import { HudButton } from "./HudButton"

export function PasswordDialog({ open, title, children, label, confirm = false, submitLabel, pendingLabel, onSubmit, onCancel }: {
	open: boolean
	title: string
	/** What the password is for, above the field. */
	children: ReactNode
	/** The password field's accessible name and placeholder. */
	label: string
	/** A new password: ask for it twice. */
	confirm?: boolean
	submitLabel: string
	pendingLabel: string
	/** Resolves null once the password is accepted, otherwise the error to show. */
	onSubmit: (password: string) => Promise<string | null>
	onCancel: () => void
}) {
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const [error, setError] = useState("")
	const [pending, setPending] = useState(false)
	const dialog = useRef<HTMLDialogElement>(null)
	const passwordInput = useRef<HTMLInputElement>(null)
	// The native modal dialog keeps the rest of the HUD inert and returns focus on close.
	useEffect(() => {
		const element = dialog.current
		if (!element) return
		if (open && !element.open) {
			setPassword("")
			setConfirmation("")
			setError("")
			element.showModal()
			passwordInput.current?.focus()
		} else if (!open && element.open) {
			element.close()
		}
	}, [open])
	const cancel = () => {
		if (!pending) onCancel()
	}
	const submit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!password || pending) return
		if (confirm && password !== confirmation) {
			setError("The passwords do not match.")
			return
		}
		setPending(true)
		try {
			const failure = await onSubmit(password)
			setPassword("")
			setConfirmation("")
			setError(failure ?? "")
		} finally {
			setPending(false)
		}
	}
	return (
		<dialog
			ref={dialog}
			className="agent-hud__password-dialog"
			aria-label={title}
			onCancel={event => { event.preventDefault(); cancel() }}>
			<form aria-label={title} className="flex flex-col gap-4" onSubmit={event => void submit(event)}>
				<h3 className="agent-hud__capability-group-heading">{title}</h3>
				{children}
				<input
					ref={passwordInput}
					className="agent-hud__project-input"
					type="password"
					aria-label={label}
					placeholder={label}
					autoComplete="off"
					value={password}
					onChange={event => setPassword(event.target.value)}
					disabled={pending}
				/>
				{confirm && <input
					className="agent-hud__project-input"
					type="password"
					aria-label="Confirm password"
					placeholder="Confirm password"
					autoComplete="off"
					value={confirmation}
					onChange={event => setConfirmation(event.target.value)}
					disabled={pending}
				/>}
				{error && <p role="alert">{error}</p>}
				<div className="flex flex-wrap justify-end gap-3">
					<HudButton variant="warning" disabled={pending} onClick={cancel}>Cancel</HudButton>
					<HudButton type="submit" disabled={pending || !password || (confirm && !confirmation)}>{pending ? pendingLabel : submitLabel}</HudButton>
				</div>
			</form>
		</dialog>
	)
}
