// The draft and its writes arrive as props from App, so unsaved edits
// survive leaving the screen, and App supplies the restart and backend actions. A key file
// row adopts an existing .env.encrypt. The hub folder row shows and changes where projects live.
// Loading, a failed read and a blocked edit are toasts, so the settings never shift.
import { useEffect, useState, type KeyboardEvent } from "react"
import { Toast } from "../feedback/Toast"
import type { EnvironmentDraft } from "../../environment/useEnvironmentDraft"
import type { EnvironmentMutations } from "../../environment/useEnvironmentMutations"
import { hubRestartNeeded, type HubFolder } from "../../hub-folder/useHubFolder"
import { EnvironmentFolderImport } from "./EnvironmentFolderImport"
import { BackendControls } from "./BackendControls"
import { EnvironmentHubFolder } from "./EnvironmentHubFolder"
import { EnvironmentKeyFileImport } from "./EnvironmentKeyFileImport"
import { EnvironmentRestart } from "./EnvironmentRestart"
import { EnvironmentImportList } from "./EnvironmentImportList"
import { EnvironmentRepositoryImport } from "./EnvironmentRepositoryImport"
import { EnvironmentSaveForm } from "./EnvironmentSaveForm"
import { EnvironmentVariableEditor } from "./EnvironmentVariableEditor"
import { EnvironmentVariableList } from "./EnvironmentVariableList"

export function EnvironmentPanel({ draft, mutations, hub, onRestart, onManageBackend }: {
	draft: EnvironmentDraft
	mutations: EnvironmentMutations
	hub: HubFolder
	onRestart: () => Promise<void>
	onManageBackend: (operation: "restart" | "recreate") => Promise<void>
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

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape" || !editor) return
		event.preventDefault()
		event.stopPropagation()
		draft.closeEditor()
	}

	return (
		<section
			aria-label="Environment settings"
			className="agent-hud__project-view agent-hud__settings-view agent-hud__environment flex min-h-0 flex-1 flex-col gap-4"
			onKeyDown={handleKeyDown}>
			{loading && slowLoad && <Toast tone="info" title="Environment" message="Loading settings…" />}
			{loadError !== null && <Toast tone="error" title="Could not load settings" message={loadError} actions={[{ label: "Retry", onClick: draft.retry }]} />}
			{view && !view.editable && <Toast tone="info" title="Editing paused" message="Stop all runs and background work before editing." />}
			<h2 className="text-center">Environment</h2>
			<p className="agent-hud__environment-lead">Choose settings and secrets.</p>
			<div className="agent-hud__table-scroll min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
				<div className="flex min-w-0 flex-col gap-4 pe-3 pb-4">
					<h3 className="agent-hud__capability-group-heading">Hub folder</h3>
					{/* Opening stays available during runs; changing the folder waits for them. */}
					<EnvironmentHubFolder hub={hub} disabled={!editable || editor !== null} />
				</div>
				<fieldset disabled={!editable} className="flex min-w-0 flex-col gap-4 pe-3">
					<h3 className="agent-hud__capability-group-heading">Key file</h3>
					<EnvironmentKeyFileImport
						disabled={!editable || editor !== null}
						replacing={(view?.entries.length ?? 0) > 0}
						onReplace={async (file, password) => view ? mutations.replaceFile(file, password, view.revision) : "Settings cannot be changed right now."}
					/>
					<EnvironmentFolderImport
						disabled={!editable || editor !== null}
						onImport={mutations.importPackage}
					/>
					{/* A saved token rewrites the settings file, so unsaved variable edits block it. */}
					<EnvironmentRepositoryImport
						disabled={!editable || editor !== null || draft.dirty}
						newPassword={!view?.requires_password}
						onPreview={mutations.previewRepository}
						onImport={mutations.importRepository}
					/>
					<h3 className="agent-hud__capability-group-heading">Variables</h3>
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
					<EnvironmentImportList
						imported={view?.imports ?? []}
						disabled={!editable || editor !== null}
						onRemove={mutations.removeImport}
						onUpdate={mutations.updateRepository}
					/>
				</fieldset>
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
				<EnvironmentRestart required={mutations.restartRequired || hubRestartNeeded(hub)} importedPending={view?.imports.some(item => !item.active) ?? false}
					dirty={draft.dirty || editor !== null} onRestart={onRestart} />
				<BackendControls onManage={onManageBackend} />
			</EnvironmentSaveForm>
			{view && view.overrides.length > 0 && <p>Manual .env overrides: {view.overrides.join(", ")}.</p>}
		</section>
	)
}
