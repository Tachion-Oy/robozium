// Import a folder of tools and skills: drop it on the row or browse. Laid out like
// EnvironmentKeyFileImport; the outcome is a toast from the import itself.
import { useRef, useState, type SubmitEvent } from "react"
import { useDropzone } from "react-dropzone"
import type { FolderFile } from "../../environment/environment-api"
import { HudButton } from "../hud/HudButton"

export function EnvironmentFolderImport({ disabled, onImport }: {
	disabled: boolean
	onImport: (files: FolderFile[]) => Promise<boolean>
}) {
	const picker = useRef<HTMLInputElement>(null)
	const [files, setFiles] = useState<FolderFile[]>([])
	const [pending, setPending] = useState(false)
	const importFiles = async (selected: FolderFile[]) => {
		if (disabled || pending || selected.length === 0) return
		setFiles(selected)
		setPending(true)
		try {
			if (await onImport(selected)) setFiles([])
		} finally {
			setPending(false)
		}
	}
	// react-dropzone gives each dropped file its path: "/folder/…" inside a dropped folder,
	// "./name" for a loose file, which the import then refuses for its missing robozium.json.
	const dropzone = useDropzone({
		noClick: true,
		noKeyboard: true,
		disabled: disabled || pending,
		onDropAccepted: dropped => void importFiles(dropped.map(file => ({
			file,
			path: ("relativePath" in file && typeof file.relativePath === "string" ? file.relativePath : file.name).replace(/^\.?\//, ""),
		}))),
	})
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		void importFiles(files)
	}
	return (
		<form
			{...dropzone.getRootProps({ role: "form", "aria-label": "Import tool or skill" })}
			className="flex flex-wrap gap-3 data-[drag-active]:outline data-[drag-active]:outline-1 data-[drag-active]:outline-dashed"
			data-drag-active={dropzone.isDragActive || undefined}
			onSubmit={submit}>
			<input
				ref={picker}
				type="file"
				{...{ webkitdirectory: "" }}
				multiple
				hidden
				aria-label="Choose tool or skill folder"
				disabled={disabled || pending}
				onChange={event => {
					const selected = Array.from(event.target.files ?? [], file => ({ file, path: file.webkitRelativePath }))
					event.target.value = ""
					void importFiles(selected)
				}}
			/>
			<input
				className="agent-hud__project-input min-w-0 flex-1"
				aria-label="Selected tool or skill folder"
				placeholder="Drop a tool or skill folder here"
				value={files[0]?.path.split("/")[0] ?? ""}
				readOnly
				disabled={disabled || pending}
			/>
			<HudButton disabled={disabled || pending} onClick={() => picker.current?.click()}>
				Browse folder
			</HudButton>
			<HudButton type="submit" pending={pending} disabled={disabled || files.length === 0}>
				{pending ? "Importing…" : "Import"}
			</HudButton>
		</form>
	)
}
