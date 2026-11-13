// The draft and its writes arrive as props from App, so unsaved edits
// survive leaving the screen, and App supplies Restart app.
// Four sections: the hub folder, the key file, imported tools and skills, and the
// variables. Loading, a failed read and a blocked edit are toasts, so the settings never
// shift; an import in progress shows the wait over the whole screen.
import { useEffect, useState, type KeyboardEvent } from "react"
import { Toast } from "../feedback/Toast"
import type { EnvironmentDraft } from "../../environment/useEnvironmentDraft"
import type { EnvironmentMutations } from "../../environment/useEnvironmentMutations"
import { hubRestartNeeded, type HubFolder } from "../../hub-folder/useHubFolder"
import { HudBadge } from "../hud/HudBadge"
import { HudBusy } from "../hud/HudBusy"
import { EnvironmentFolderImport } from "./EnvironmentFolderImport"
import { EnvironmentHubFolder } from "./EnvironmentHubFolder"
import { EnvironmentKeyFileImport } from "./EnvironmentKeyFileImport"
import { EnvironmentRestart } from "./EnvironmentRestart"
import { EnvironmentImportList } from "./EnvironmentImportList"
import { EnvironmentSaveForm } from "./EnvironmentSaveForm"
import { EnvironmentVariableEditor } from "./EnvironmentVariableEditor"
import { EnvironmentVariableList } from "./EnvironmentVariableList"

export function EnvironmentPanel({ draft, mutations, hub, restartRequired, onRestart }: {
	draft: EnvironmentDraft
	mutations: EnvironmentMutations
	hub: HubFolder
	/** The backend refuses new runs and Check dependencies until Restart app. */
	restartRequired: boolean
	onRestart: () => Promise<void>
}) {
	const { view, editor, editable, loadFailed, loadError } = draft
	// A read that finishes quickly shows no loading toast at all.
	const loading = !view && !loadFailed
	const [slowLoad, setSlowLoad] = useState(false)
	useEffect(() => {
		if (!loading) { setSlowLoad(false); return }
		const timer = window.setTimeout(() => setSlowLoad(true), 600)
		return () => window.clearTimeout(timer)
	}, [loading])
	// The folder being imported: null before its name is read, undefined when no import runs.
	const [importing, setImporting] = useState<string | null | undefined>(undefined)

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape" || !editor) return
		event.preventDefault()
		event.stopPropagation()
		draft.closeEditor()
	}

	return (
		<section
			aria-label="Environment settings"
			className="agent-hud__project-view agent-hud__settings-view agent-hud__environment flex min-h-0 flex-1 flex-col"
			onKeyDown={handleKeyDown}>
			<HudBusy window busy={importing !== undefined} label={importing ? `Importing ${importing}…` : "Importing…"} className="flex min-h-0 flex-1 flex-col gap-4">
				{loading && slowLoad && <Toast tone="info" title="Environment" message="Loading settings…" />}
				{loadError !== null && <Toast tone="error" title="Could not load settings" message={loadError} actions={[{ label: "Retry", onClick: draft.retry }]} />}
				{draft.paused && <Toast tone="info" title="Editing paused" message="Stop all runs and background work before editing." />}
				<h2 className="text-center">Environment</h2>
				<div className="agent-hud__table-scroll min-h-0 flex-1 overflow-auto px-3 [scrollbar-gutter:stable]">
					<div className="agent-hud__environment-sections pb-4">
						<section aria-label="Hub folder" className="agent-hud__environment-section">
							<h3 className="agent-hud__environment-heading"><HudBadge>Hub folder</HudBadge></h3>
							{/* Opening stays available during runs; changing the folder waits for them. */}
							<EnvironmentHubFolder hub={hub} disabled={!editable || editor !== null} />
						</section>
						<fieldset disabled={!editable} className="agent-hud__environment-sections">
							<section aria-label="Key file" className="agent-hud__environment-section">
								<h3 className="agent-hud__environment-heading"><HudBadge>Key file</HudBadge></h3>
								<EnvironmentKeyFileImport
									disabled={!editable || editor !== null}
									replacing={(view?.entries.length ?? 0) > 0}
									onReplace={async (file, password) => view ? mutations.replaceFile(file, password, view.revision) : "Settings cannot be changed right now."}
								/>
							</section>
							<section aria-label="Tools and skills" className="agent-hud__environment-section">
								<h3 className="agent-hud__environment-heading"><HudBadge>Tools and skills</HudBadge></h3>
								<EnvironmentFolderImport
									disabled={!editable || editor !== null}
									onImport={mutations.importPackage}
									onBusy={setImporting}
								/>
								<EnvironmentImportList
									imported={view?.imports ?? []}
									disabled={!editable || editor !== null}
									onRemove={mutations.removeImport}
								/>
							</section>
							<section aria-label="Variables" className="agent-hud__environment-section">
								<h3 className="agent-hud__environment-heading"><HudBadge>Variables</HudBadge></h3>
								<EnvironmentVariableList
									variables={draft.variables}
									editorName={editor?.original.name ?? null}
									onEdit={draft.openEditor}
									onDelete={draft.removeVariable}>
									{editor && (
										<EnvironmentVariableEditor
											entry={editor.entry}
											original={editor.original}
											disabled={!editable}
											onChange={draft.updateEditor}
											onApply={draft.applyEditor}
											onCancel={draft.closeEditor}
										/>
									)}
								</EnvironmentVariableList>
							</section>
						</fieldset>
					</div>
				</div>
				<EnvironmentSaveForm
					editable={editable}
					dirty={draft.dirty}
					pending={mutations.saving}
					needsPassword={draft.needsPassword}
					confirmPassword={!view?.requires_password}
					canReset={draft.canReset}
					onValidate={draft.validateSave}
					onSave={async password => view ? mutations.save(password, draft.currentEntries, view.revision) : false}
					onReset={mutations.reset}>
					<EnvironmentRestart required={restartRequired || hubRestartNeeded(hub)}
						dirty={draft.dirty || editor !== null} onRestart={onRestart} />
				</EnvironmentSaveForm>
				{view && view.overrides.length > 0 && <p>Manual .env overrides: {view.overrides.join(", ")}.</p>}
			</HudBusy>
		</section>
	)
}
