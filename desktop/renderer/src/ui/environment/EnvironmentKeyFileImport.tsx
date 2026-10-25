// Adopt an existing .env.encrypt: drop it or browse, then enter its password in the
// password dialog. Laid out like EnvironmentFolderImport; failures show in the dialog.
import { useState } from "react"
import { useDropzone } from "react-dropzone"
import { HudButton } from "../hud/HudButton"
import { PasswordDialog } from "../hud/PasswordDialog"

export function EnvironmentKeyFileImport({ disabled, replacing, onReplace }: {
	disabled: boolean
	/** Saved settings exist, so the file replaces them. */
	replacing: boolean
	onReplace: (file: File, password: string) => Promise<string | null>
}) {
	const [file, setFile] = useState<File | null>(null)
	const dropzone = useDropzone({
		multiple: false,
		noClick: true,
		noKeyboard: true,
		disabled,
		onDropAccepted: ([dropped]) => setFile(dropped),
	})
	const replace = async (password: string) => {
		if (!file || disabled) return "Settings cannot be changed right now."
		const failure = await onReplace(file, password)
		if (failure === null) setFile(null)
		return failure
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
						disabled={disabled}
					/>
					<HudButton disabled={disabled} onClick={dropzone.open}>Browse file</HudButton>
				</div>
			</div>
			<PasswordDialog open={file !== null} title={action} label="Key file password"
				submitLabel={action} pendingLabel="Checking…" onSubmit={replace} onCancel={() => setFile(null)}>
				<p>Enter the password <strong>{file?.name}</strong> was encrypted with.</p>
				{replacing && <p>This replaces the saved settings.</p>}
			</PasswordDialog>
		</>
	)
}
