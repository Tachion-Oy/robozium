// Startup stopped because the hub folder is unusable: retry once it is back, or choose another.
import { hubFolderConfirmation, useHubFolder } from "../../hub-folder/useHubFolder"
import { HudButton } from "../HudButton"

export function StartupHubFolder({ onRetry }: { onRetry: () => void }) {
	// A newly recorded folder retries startup at once.
	const hub = useHubFolder(onRetry)
	if (hub.picked) return <>
		<p role="alert">{hubFolderConfirmation(hub.picked)}</p>
		<div className="backend-startup__actions">
			<HudButton variant="warning" disabled={hub.pending} onClick={() => void hub.confirm()}>Use folder</HudButton>
			<HudButton disabled={hub.pending} onClick={hub.cancel}>Cancel</HudButton>
		</div>
	</>
	return <>
		{hub.error && <p role="alert">{hub.error}</p>}
		<div className="backend-startup__actions">
			<HudButton disabled={hub.pending} onClick={onRetry}>Retry</HudButton>
			<HudButton disabled={hub.pending} onClick={() => void hub.choose()}>Choose folder…</HudButton>
		</div>
	</>
}
