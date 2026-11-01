// The hub folder in use, opened in the file manager or changed with the native folder dialog.
// Laid out like the key file row. The confirmation and failures are toasts,
// so the row never grows; the restart it needs joins Restart required.
import { Toast } from "../feedback/Toast"
import { hubFolderConfirmation, type HubFolder } from "../../hub-folder/useHubFolder"
import { HudButton } from "../hud/HudButton"

export function EnvironmentHubFolder({ hub, disabled }: { hub: HubFolder; disabled: boolean }) {
	const { status, picked, pending, error } = hub
	const folder = status?.selected ?? status?.current ?? ""
	return (
		<div className="flex flex-col gap-3">
			{picked && <Toast tone="warning" title="Use this hub folder?" message={hubFolderConfirmation(picked)} actions={[
				{ label: "Use folder", disabled: pending, onClick: hub.confirm },
				{ label: "Cancel", disabled: pending, onClick: hub.cancel },
			]} />}
			{error && <Toast tone="error" title="Hub folder" message={error} />}
			<div className="flex flex-wrap gap-3">
				<input
					className="agent-hud__project-input min-w-0 flex-1"
					aria-label="Hub folder"
					placeholder={status ? "No hub folder" : "Reading the hub folder…"}
					value={folder}
					readOnly
				/>
				<HudButton disabled={!status?.current || pending} onClick={() => void hub.open()}>Open folder</HudButton>
				{status?.choosable && (
					<HudButton disabled={disabled || pending || picked !== null} onClick={() => void hub.choose()}>Choose folder…</HudButton>
				)}
			</div>
			{status && !status.choosable && <p>Mock mode keeps a throwaway hub of its own, and a launch given a backend uses that backend's hub, so no other hub folder can be used.</p>}
		</div>
	)
}
