"use client"

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type SubmitEvent,
} from "react"
import {
	clearApiKeys,
	getCredentialStatus,
	unlockApiKeys,
} from "@/lib/robozium/client"
import type { CredentialStatus } from "@/lib/robozium/wire"

export function UnlockApiKeys() {
	const [status, setStatus] = useState<CredentialStatus | null>(null)
	const [open, setOpen] = useState(false)
	const [password, setPassword] = useState("")
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const statusVersion = useRef(0)

	const refresh = useCallback(async (signal?: AbortSignal) => {
		const version = statusVersion.current
		try {
			const next = await getCredentialStatus({ signal })
			if (next && !signal?.aborted && version === statusVersion.current)
				setStatus(next)
		} catch {}
	}, [])

	useEffect(() => {
		const controller = new AbortController()
		const version = statusVersion.current
		const loadInitialStatus = async () => {
			try {
				const next = await getCredentialStatus({
					signal: controller.signal,
				})
				if (
					next &&
					!controller.signal.aborted &&
					version === statusVersion.current
				) {
					setStatus(next)
				}
			} catch {}
		}
		void loadInitialStatus()
		return () => controller.abort()
	}, [])

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
		setPending(true)
		statusVersion.current += 1
		setError("")
		try {
			setStatus(await unlockApiKeys({ password }))
			close()
		} catch {
			setError(
				"Could not unlock API keys. Check the password and try again.",
			)
			setPassword("")
		} finally {
			setPending(false)
		}
	}

	const remove = async () => {
		if (pending || !status?.removable) return
		setPending(true)
		statusVersion.current += 1
		setError("")
		try {
			setStatus(await clearApiKeys())
			close()
		} catch {
			setError("Could not remove API keys. Try again.")
		} finally {
			setPending(false)
		}
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
					{status.locked ? "API keys locked" : "API keys unlocked"}
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
					aria-label="API keys">
					{status.locked ? (
						<form
							className="agent-hud__credential-form"
							onSubmit={submit}>
							<label
								className="agent-hud__credential-sr-only"
								htmlFor="hud-key-password">
								API key password
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
								{pending ? "Removing…" : "Remove API keys"}
							</button>
							{error ? <p role="alert">{error}</p> : null}
						</>
					)}
				</div>
			) : null}
		</div>
	)
}
