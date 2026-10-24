// Adopt an existing .env.encrypt: drop it or browse, then enter its password in a
// modal dialog that holds focus until the file is used or cancelled.
// Laid out like EnvironmentFolderImport; failures show in place, without a toast.
import { useEffect, useRef, useState, type SubmitEvent } from "react"
import { useDropzone } from "react-dropzone"
import { HudButton } from "../hud/HudButton"

export function EnvironmentKeyFileImport({ disabled, replacing, onReplace }: {
	disabled: boolean
	/** Saved settings exist, so the file replaces them. */
	replacing: boolean
	onReplace: (file: File, password: string) => Promise<string | null>
}) {
	const [file, setFile] = useState<File | null>(null)
	const [password, setPassword] = useState("")
	const [error, setError] = useState("")
	const [pending, setPending] = useState(false)
	const dialog = useRef<HTMLDialogElement>(null)
	const passwordInput = useRef<HTMLInputElement>(null)
	const dropzone = useDropzone({
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled: disabled || pending,
		onDropAccepted: ([dropped]) => { setFile(dropped); setPassword(""); setError("") },
	})
	// The native modal dialog keeps the rest of the HUD inert and returns focus on close.
	useEffect(() => {
		const element = dialog.current
		if (!element) return
		if (file && !element.open) {
			element.showModal()
			passwordInput.current?.focus()
		} else if (!file && element.open) {
			element.close()
		}
	}, [file])
	const cancel = () => {
		if (pending) return
		setFile(null)
		setPassword("")
		setError("")
	}
	const submit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!file || !password || disabled || pending) return
		setPending(true)
		try {
			const failure = await onReplace(file, password)
			if (failure === null) {
				setFile(null)
				setPassword("")
			}
			setError(failure ?? "")
		} finally {
			setPending(false)
		}
	}
	const action = replacing ? "Replace saved settings" : "Use key file"
	return (
		<>
			<div
				{...dropzone.getRootProps({ role: "group", "aria-label": "Key file" })}
				className="data-[drag-active]:outline data-[drag-active]:outline-1 data-[drag-active]:outline-dashed"
				data-drag-active={dropzone.isDragActive || undefined}>
				<input {...dropzone.getInputProps({ "aria-label": "Choose key file" })} />
				<div className="flex flex-wrap gap-3">
					<input
						className="agent-hud__project-input min-w-0 flex-1"
						aria-label="Selected key file"
						placeholder="Drop your .env.encrypt here"
						value={file?.name ?? ""}
						readOnly
						disabled={disabled || pending}
					/>
					<HudButton disabled={disabled || pending} onClick={dropzone.open}>Browse file</HudButton>
				</div>
			</div>
			<dialog
				ref={dialog}
				className="agent-hud__key-file-dialog"
				aria-labelledby="key-file-dialog-title"
				onCancel={event => { event.preventDefault(); cancel() }}>
				<form aria-label={action} className="flex flex-col gap-4" onSubmit={event => void submit(event)}>
					<h3 id="key-file-dialog-title" className="agent-hud__capability-group-heading">{action}</h3>
					<p>Enter the password <strong>{file?.name}</strong> was encrypted with.</p>
					{replacing && <p>This replaces the saved settings.</p>}
					<input
						ref={passwordInput}
						className="agent-hud__project-input"
						type="password"
						aria-label="Key file password"
						placeholder="Key file password"
						autoComplete="off"
						value={password}
						onChange={event => setPassword(event.target.value)}
						disabled={pending}
					/>
					{error && <p role="alert">{error}</p>}
					<div className="flex flex-wrap justify-end gap-3">
						<HudButton variant="warning" disabled={pending} onClick={cancel}>Cancel</HudButton>
						<HudButton type="submit" disabled={pending || !password}>{pending ? "Checking…" : action}</HudButton>
					</div>
				</form>
			</dialog>
		</>
	)
}
