// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentFolderImport.tsx at 076b2c9.
// Adapted: desktop import paths.
import { useRef, useState, type SubmitEvent } from "react"
import { HudButton } from "../hud/HudButton"

export function EnvironmentFolderImport({ disabled, onImport }: {
	disabled: boolean
	onImport: (files: File[]) => Promise<boolean>
}) {
	const picker = useRef<HTMLInputElement>(null)
	const [files, setFiles] = useState<File[]>([])
	const [pending, setPending] = useState(false)
	const importFiles = async (selected: File[]) => {
		if (disabled || pending || selected.length === 0) return
		setFiles(selected)
		setPending(true)
		try {
			if (await onImport(selected)) setFiles([])
		} finally {
			setPending(false)
		}
	}
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault()
		void importFiles(files)
	}
	return (
		<form aria-label="Import tool or skill" className="flex flex-wrap gap-3" onSubmit={submit}>
			<input
				ref={picker}
				type="file"
				{...{ webkitdirectory: "" }}
				multiple
				hidden
				aria-label="Choose tool or skill folder"
				disabled={disabled || pending}
				onChange={event => {
					const selected = Array.from(event.target.files ?? [])
					event.target.value = ""
					void importFiles(selected)
				}}
			/>
			<input
				className="agent-hud__project-input min-w-0 flex-1"
				aria-label="Selected tool or skill folder"
				placeholder="Choose tool or skill folder"
				value={files[0]?.webkitRelativePath.split("/")[0] ?? ""}
				readOnly
				disabled={disabled || pending}
			/>
			<HudButton disabled={disabled || pending} onClick={() => picker.current?.click()}>
				Browse folder
			</HudButton>
			<HudButton type="submit" disabled={disabled || pending || files.length === 0}>
				{pending ? "Importing…" : "Import"}
			</HudButton>
		</form>
	)
}
