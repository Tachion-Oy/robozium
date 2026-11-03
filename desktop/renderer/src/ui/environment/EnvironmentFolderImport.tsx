// Import a folder of tools and skills: drop it on the row or browse. Reading the folder
// and uploading it can take a while, so the screen shows the wait (onBusy); the outcome
// is a toast from the import itself.
import { useEffect, useState, type SubmitEvent } from "react"
import { useDropzone, type FileWithPath } from "react-dropzone"
import type { FolderFile } from "../../environment/environment-api"
import { showErrorToast } from "../../feedback/notices"
import { HudButton } from "../hud/HudButton"

export function EnvironmentFolderImport({ disabled, onImport, onBusy }: {
	disabled: boolean
	onImport: (files: FolderFile[]) => Promise<boolean>
	/** The folder being read or uploaded, null while its name is not known yet, undefined when idle. */
	onBusy: (folder: string | null | undefined) => void
}) {
	const [files, setFiles] = useState<FolderFile[]>([])
	const [pending, setPending] = useState(false)
	const importFiles = async (selected: FolderFile[]) => {
		if (disabled || pending) return
		if (new Set(selected.map(({ path }) => path.split("/")[0])).size !== 1) {
			showErrorToast({ title: "Import failed", message: "Drop or choose one folder that contains files." })
			return
		}
		setFiles(selected)
		setPending(true)
		try {
			if (await onImport(selected)) setFiles([])
		} finally {
			setPending(false)
		}
	}
	// Dropped and browsed files both arrive here. file-selector gives each a relativePath,
	// "/folder/…" for a drop and "folder/…" for Browse; react-dropzone types them as File.
	const dropzone = useDropzone({
		noClick: true,
		noKeyboard: true,
		disabled: disabled || pending,
		onDropAccepted: (selected: File[]) => void importFiles(selected.map(file => ({
			file,
			path: (file as FileWithPath).relativePath.replace(/^\//, ""),
		}))),
	})
	const reading = dropzone.isProcessing
	const folder = files[0]?.path.split("/")[0] ?? null
	useEffect(() => {
		onBusy(reading || pending ? folder : undefined)
	}, [reading, pending, folder, onBusy])
	const busy = disabled || pending || reading
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		void importFiles(files)
	}
	return (
		<form
			{...dropzone.getRootProps({ role: "form", "aria-label": "Import tool or skill" })}
			className="agent-hud__environment-controls"
			data-drag-active={dropzone.isDragActive || undefined}
			onSubmit={submit}>
			<input {...dropzone.getInputProps({ "aria-label": "Choose tool or skill folder", webkitdirectory: "" })} />
			<input
				className="agent-hud__project-input min-w-0 flex-1"
				aria-label="Selected tool or skill folder"
				placeholder="Drop a tool or skill folder here"
				value={folder ?? ""}
				readOnly
				disabled={busy}
			/>
			<HudButton disabled={busy} onClick={dropzone.open}>
				Browse folder
			</HudButton>
			<HudButton type="submit" disabled={busy || files.length === 0}>
				Import
			</HudButton>
		</form>
	)
}
