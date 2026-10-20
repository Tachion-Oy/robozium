// Copied from robozium-electron/desktop/web/app/components/hud/UnlockApiKeys.tsx at 076b2c9.
// Adapted: the status and the unlock and remove requests come from
// credentials/useCredentials as props; the menu keeps its open state, password
// field and error text.
import { useEffect, useRef, useState, type SubmitEvent } from "react"
import type { CredentialsState } from "../../credentials/useCredentials"

export function UnlockApiKeys({ credentials }: { credentials: CredentialsState }) {
	const { status, pending, refresh } = credentials
	const [open, setOpen] = useState(false)
	const [password, setPassword] = useState("")
	const [error, setError] = useState("")
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)

	const close = () => {
		setOpen(false)
		setPassword("")
		setError("")
	}

	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node) && !pending)
				close()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !pending) {
				event.preventDefault()
				event.stopImmediatePropagation()
				close()
				triggerRef.current?.focus()
			}
		}
		document.addEventListener("pointerdown", onPointerDown)
		document.addEventListener("keydown", onKeyDown, true)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown)
			document.removeEventListener("keydown", onKeyDown, true)
		}
	}, [open, pending])

	useEffect(() => {
		if (!open || status?.locked || pending) return
		const timer = window.setInterval(() => void refresh(), 2000)
		return () => window.clearInterval(timer)
	}, [open, status?.locked, pending, refresh])

	const submit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (pending || !password) return
		setError("")
		if (await credentials.unlock(password)) {
			close()
		} else {
			setError(
				"Could not unlock secrets. Check the password and try again.",
			)
			setPassword("")
		}
	}

	const remove = async () => {
		if (pending || !status?.removable) return
		setError("")
		if (await credentials.remove()) close()
		else setError("Could not remove secrets. Try again.")
	}

	if (!status?.available) return null

	return (
		<div
			ref={rootRef}
			className="agent-hud__model-selector agent-hud__model-selector--ready agent-hud__credential-selector">
			<button
				ref={triggerRef}
				type="button"
				className="agent-hud__selector-trigger agent-hud__model-trigger"
				title={status.locked ? "Secrets locked" : "Secrets unlocked"}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => {
					if (open) close()
					else {
						setError("")
						setOpen(true)
						if (!status.locked) void refresh()
					}
				}}>
				<span>
					{status.locked ? "Secrets locked" : "Secrets unlocked"}
				</span>
				<svg
					className="agent-hud__model-caret"
					data-open={open || undefined}
					viewBox="0 0 16 14"
					aria-hidden="true">
					<path d="M8 12.75 1.25 1.25h13.5Z" />
				</svg>
			</button>
			{open ? (
				<div
					className="agent-hud__model-menu agent-hud__credential-menu"
					role="dialog"
					aria-label="Secrets">
					{status.locked ? (
						<form
							className="agent-hud__credential-form"
							onSubmit={submit}>
							<label
								className="agent-hud__credential-sr-only"
								htmlFor="hud-key-password">
								Secret password
							</label>
							<input
								id="hud-key-password"
								type="password"
								autoComplete="off"
								autoFocus
								placeholder="Password"
								value={password}
								onChange={(event) =>
									setPassword(event.target.value)
								}
								disabled={pending}
							/>
							{error ? <p role="alert">{error}</p> : null}
							<button
								className="agent-hud__model-option"
								type="submit"
								disabled={pending || !password}>
								{pending ? "Unlocking…" : "Unlock"}
							</button>
						</form>
					) : (
						<>
							<button
								className="agent-hud__model-option"
								type="button"
								disabled={pending || !status.removable}
								onClick={() => void remove()}>
								{pending ? "Removing…" : "Remove secrets"}
							</button>
							{error ? <p role="alert">{error}</p> : null}
						</>
					)}
				</div>
			) : null}
		</div>
	)
}
