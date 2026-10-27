// Startup stopped because the hub folder is unusable: retry once it is back, or choose another.
// The choice is a toast over the startup screen, so the loader never moves.
import { Toast } from "../feedback/Toast"
import { hubFolderConfirmation, useHubFolder } from "../../hub-folder/useHubFolder"

export function StartupHubFolder({ message, onRetry }: { message: string; onRetry: () => void }) {
	// A newly recorded folder retries startup at once.
	const hub = useHubFolder(onRetry)
	if (hub.picked) return <Toast tone="warning" title="Use this hub folder?" message={hubFolderConfirmation(hub.picked)} actions={[
		{ label: "Use folder", disabled: hub.pending, onClick: hub.confirm },
		{ label: "Cancel", disabled: hub.pending, onClick: hub.cancel },
	]} />
	return <Toast tone="error" title="Hub folder unavailable" message={hub.error || message} detail={hub.error ? message : null} actions={[
		{ label: "Retry", disabled: hub.pending, onClick: onRetry },
		{ label: "Choose folder…", disabled: hub.pending, onClick: hub.choose },
	]} />
}
