// Import a folder of tools and skills: drop it on the row or browse. Reading the folder
// and uploading it can take a while, so the screen shows the wait (onBusy); the outcome
// is a toast from the import itself.
import { useEffect, useRef, useState, type SubmitEvent } from "react"
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
	// The folder dialog closed and Chromium is reading the chosen folder, before any file arrives.
	const [choosing, setChoosing] = useState(false)
	const dialogOpen = useRef(false)
	const importFiles = async (selected: FolderFile[]) => {
		setChoosing(false)
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
		// A folder that cannot be read reports why instead of doing nothing.
		onError: error => showErrorToast({ title: "Import failed", message: error.message || "The folder could not be read." }),
		onDropAccepted: (selected: File[]) => void importFiles(selected.map(file => ({
			file,
			path: (file as FileWithPath).relativePath.replace(/^\//, ""),
		}))),
		// Every selection ends here, an empty folder included, before its files are accepted.
		onDrop: () => {
			dialogOpen.current = false
			setChoosing(false)
		},
	})
	// Browse: the window regains focus as the dialog closes, long before a large folder is
	// read, so the wait starts there. The input's cancel event, which also answers an
	// unchanged selection such as an empty folder, ends it whether it comes before or after.
	const browse = () => {
		setFiles([])
		dialogOpen.current = true
		dropzone.open()
	}
	const { inputRef } = dropzone
	useEffect(() => {
		const input = inputRef.current
		const focus = () => {
			if (!dialogOpen.current) return
			dialogOpen.current = false
			setChoosing(true)
		}
		const cancel = () => {
			dialogOpen.current = false
			setChoosing(false)
		}
		window.addEventListener("focus", focus)
		input?.addEventListener("cancel", cancel)
		return () => {
			window.removeEventListener("focus", focus)
			input?.removeEventListener("cancel", cancel)
		}
	}, [inputRef])
	const reading = dropzone.isProcessing
	const folder = files[0]?.path.split("/")[0] ?? null
	useEffect(() => {
		onBusy(choosing || reading || pending ? folder : undefined)
	}, [choosing, reading, pending, folder, onBusy])
	const busy = disabled || pending || reading
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		void importFiles(files)
	}
	return (
		<form
			{...dropzone.getRootProps({ role: "form", "aria-label": "Import tool or skill",
				// A new folder replaces the last one, so the wait never names the previous folder.
				onDrop: () => setFiles([]) })}
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
			<HudButton disabled={busy} onClick={browse}>
				Browse folder
			</HudButton>
			<HudButton type="submit" disabled={busy || files.length === 0}>
				Import
			</HudButton>
		</form>
	)
}
