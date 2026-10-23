// Adopt an existing .env.encrypt: drop it or browse, then enter its password.
// Laid out like EnvironmentFolderImport; failures show in place, without a toast.
import { useState, type SubmitEvent } from "react"
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
	const dropzone = useDropzone({
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled: disabled || pending,
		onDropAccepted: ([dropped]) => { setFile(dropped); setError("") },
	})
	const submit = async (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!file || disabled || pending) return
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
	return (
		<form
			{...dropzone.getRootProps({ "aria-label": "Use key file" })}
			className="flex flex-col gap-3 data-[drag-active]:outline data-[drag-active]:outline-1 data-[drag-active]:outline-dashed"
			data-drag-active={dropzone.isDragActive || undefined}
			onSubmit={event => void submit(event)}>
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
			{file && <div className="flex flex-wrap gap-3">
				<input
					className="agent-hud__project-input min-w-0 flex-1"
					type="password"
					aria-label="Key file password"
					placeholder="Password it was encrypted with"
					autoComplete="off"
					value={password}
					onChange={event => setPassword(event.target.value)}
					disabled={disabled || pending}
				/>
				<HudButton type="submit" disabled={disabled || pending}>
					{pending ? "Checking…" : replacing ? "Replace saved settings" : "Use key file"}
				</HudButton>
			</div>}
			{file && replacing && <p>This replaces the saved settings below.</p>}
			{error && <p role="alert">{error}</p>}
		</form>
	)
}
