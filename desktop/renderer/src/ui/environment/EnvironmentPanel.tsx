// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentPanel.tsx at 076b2c9.
// Adapted: the environment owner arrives as a prop from App, so unsaved edits
// survive leaving the screen, and App supplies the restart action. A key file
// row adopts an existing .env.encrypt.
import { type KeyboardEvent } from "react"
import type { EnvironmentEditorState } from "../../environment/useEnvironmentEditor"
import { HudButton } from "../hud/HudButton"
import { EnvironmentFolderImport } from "./EnvironmentFolderImport"
import { EnvironmentKeyFileImport } from "./EnvironmentKeyFileImport"
import { EnvironmentRestart } from "./EnvironmentRestart"
import { EnvironmentImportList } from "./EnvironmentImportList"
import { EnvironmentSaveForm } from "./EnvironmentSaveForm"
import { EnvironmentVariableEditor } from "./EnvironmentVariableEditor"
import { EnvironmentVariableList } from "./EnvironmentVariableList"

export function EnvironmentPanel({ environment, onRestart }: {
	environment: EnvironmentEditorState
	onRestart: () => Promise<void>
}) {
	const { view, editor, editable, loadFailed } = environment

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "Escape" || !editor) return
		event.preventDefault()
		event.stopPropagation()
		environment.closeEditor()
	}

	return (
		<section
			aria-label="Environment settings"
			className="agent-hud__project-view agent-hud__settings-view agent-hud__environment flex min-h-0 flex-1 flex-col gap-4"
			onKeyDown={handleKeyDown}>
			<h2 className="text-center">Environment</h2>
			<p className="agent-hud__environment-lead">Choose settings and secrets.</p>
			{!view && !loadFailed && <p role="status">Loading settings…</p>}
			{loadFailed && <div className="flex items-center gap-3">
				<HudButton onClick={environment.retry}>Retry</HudButton>
			</div>}
			{view && !view.editable && <p role="status">Stop all runs and background work before editing.</p>}
			<div className="agent-hud__table-scroll min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
				<fieldset disabled={!editable} className="flex min-w-0 flex-col gap-4 pe-3">
					<h3 className="agent-hud__capability-group-heading">Key file</h3>
					<EnvironmentKeyFileImport
						disabled={!editable || editor !== null}
						replacing={(view?.entries.length ?? 0) > 0}
						onReplace={environment.replaceFile}
					/>
					<EnvironmentFolderImport
						disabled={!editable || editor !== null}
						onImport={environment.importPackage}
					/>
					<h3 className="agent-hud__capability-group-heading">Variables</h3>
					<EnvironmentVariableList
						variables={environment.variables}
						editorName={editor?.original.name ?? null}
						onEdit={environment.openEditor}
						onDelete={environment.removeVariable}>
						{editor && (
							<EnvironmentVariableEditor
								entry={editor.entry}
								original={editor.original}
								disabled={!editable}
								onChange={environment.updateEditor}
								onApply={environment.applyEditor}
								onCancel={environment.closeEditor}
							/>
						)}
					</EnvironmentVariableList>
					<EnvironmentImportList imported={view?.imports ?? []} />
				</fieldset>
			</div>
			<EnvironmentSaveForm
				editable={editable}
				dirty={environment.dirty}
				pending={environment.saving}
				needsPassword={environment.needsPassword}
				confirmPassword={!view?.requires_password}
				canReset={environment.canReset}
				onValidate={environment.validateSave}
				onSave={environment.save}
				onReset={environment.reset}
			/>
			<EnvironmentRestart required={environment.restartRequired} importedPending={view?.imports.some(item => !item.active) ?? false}
				dirty={environment.dirty || editor !== null} onRestart={onRestart} />
			{view && view.overrides.length > 0 && <p>Manual .env overrides: {view.overrides.join(", ")}.</p>}
		</section>
	)
}
