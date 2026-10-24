// The hub folder in use, opened in the file manager or changed with the native folder dialog.
// Laid out like EnvironmentFolderImport; failures show in place, without a toast.
import { hubFolderConfirmation, hubRestartNeeded, type HubFolder } from "../../hub-folder/useHubFolder"
import { HudButton } from "../hud/HudButton"

export function EnvironmentHubFolder({ hub, disabled }: { hub: HubFolder; disabled: boolean }) {
	const { status, picked, pending, error } = hub
	const folder = status?.selected ?? status?.current ?? ""
	return (
		<div className="flex flex-col gap-3">
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
			{picked && <div className="flex flex-wrap items-center gap-3">
				<p role="alert">{hubFolderConfirmation(picked)}</p>
				<HudButton variant="danger-confirm" disabled={pending} onClick={() => void hub.confirm()}>Use folder</HudButton>
				<HudButton variant="warning" disabled={pending} onClick={hub.cancel}>Cancel</HudButton>
			</div>}
			{hubRestartNeeded(hub) && <p role="status">Restart the app to use this folder. Until then, the hub stays {status?.current}.</p>}
			{status && !status.choosable && <p>Mock mode and previews keep a throwaway hub of their own, so no other hub folder can be used.</p>}
			{error && <p role="alert">{error}</p>}
		</div>
	)
}
