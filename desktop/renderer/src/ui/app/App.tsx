import { useEffect, useRef, useState, type ReactNode } from "react"
import type { BackendMode } from "../../../../src/bridge"
import type { DesktopApiClient } from "../../api/client"
import { viewOptions, runViewOptions } from "../../app/navigation"
import { mockMessages, modelOptions } from "../../app/preview"
import { useRunWorkspace } from "../../app/useRunWorkspace"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"
import { HudHeader } from "../hud/HudHeader"
import { HudPanels } from "../hud/HudPanels"
import { HudDividerControls, type LayoutMode } from "../hud/HudDividerControls"
import { HudFooter } from "../hud/HudFooter"
import { Projects } from "../projects/Projects"
import { RunOverview } from "../run/RunOverview"
import { RunFeedback } from "../run/RunFeedback"
import { AppIdentity } from "./AppIdentity"
import { ModelFeedback } from "./ModelFeedback"
import { ViewPlaceholder } from "./ViewPlaceholder"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
	mode?: BackendMode | null
}

/** Compose screens; only theme, panel layout and standalone-preview choices live here. */
export function App({ connectionNotice, client = null, connected = true, mode = null }: AppProps) {
	const workspace = useRunWorkspace(client, connected, mode)
	const { run, projects, models, draft, navigation } = workspace
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [previewModel, setPreviewModel] = useState("mock")
	const [previewMessage, setPreviewMessage] = useState(mockMessages.length - 1)
	const editor = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		document.documentElement.dataset.theme = theme
	}, [theme])

	function toggleTheme() {
		setTheme(current => current === "dark" ? "light" : "dark")
	}

	function chooseModel(value: string) {
		if (!client) setPreviewModel(value)
		else if (!run.creating) models.choose(value)
	}

	function clearDraft() {
		draft.change("")
		editor.current?.focus()
	}

	const display = selectRunDisplay(run.session)
	const message = client ? display.text : mockMessages[previewMessage]
	const messageIndex = client ? display.index : previewMessage
	const messageId = client ? display.id : String(previewMessage)
	const availableModels = client
		? models.selection?.models.map(model => ({ value: model.model_id, label: model.label })) ?? []
		: modelOptions

	let status = "Awaiting input"
	if (run.session?.run.unavailable) status = "Run unavailable"
	else if (run.session) status = runLabels[run.session.run.status]

	let modelPlaceholder = "No models available"
	if (models.pending) modelPlaceholder = "Loading models…"
	else if (models.error) modelPlaceholder = "Models unavailable"

	function renderContent() {
		switch (navigation.view) {
			case "run":
				return (
					<HudPanels
						message={message}
						messageId={messageId}
						streaming={Boolean(client && display.streaming)}
						notice={run.session && <RunFeedback
							run={run.session.run}
							status={status}
							actionError={run.actionError}
							projectError={projects.actionError}
							canRetry={connected && !run.creating}
							onRetry={run.retry}
							onOpenProjects={() => navigation.navigate("projects")}
						/>}
						draft={draft.value}
						onDraftChange={draft.change}
						onSend={client ? workspace.reply.onClick : undefined}
						layout={layout}
						focusOnOpen={navigation.focusRunEditor}
						editor={editor}
					/>
				)
			case "projects":
				return (
					<div className={client ? "selection-overview" : "preview-overview"}>
						{client && <Projects state={projects} connected={connected} initialFocus={navigation.overviewFocus} />}
						<RunOverview
							connected={Boolean(client)}
							hasRun={workspace.hasRun}
							onOpen={navigation.showRun}
							onStart={workspace.launch.start}
							disabled={!workspace.launch.enabled}
							existing={workspace.launch.existing}
							creating={run.creating}
							error={run.createError}
							project={projects.selected}
						/>
					</div>
				)
			default:
				return <ViewPlaceholder view={navigation.view} />
		}
	}

	return (
		<main className="hud-frame">
			<HudHeader
				model={client ? models.selection?.selected_model_id ?? "" : previewModel}
				models={availableModels}
				modelDisabled={Boolean(client && (!connected || models.pending || run.creating))}
				modelPlaceholder={modelPlaceholder}
				onSelectModel={chooseModel}
				view={navigation.view}
				views={workspace.hasRun ? runViewOptions : viewOptions}
				onSelectView={navigation.navigate}
				theme={theme}
				onToggleTheme={toggleTheme}
			/>
			<AppIdentity>
				{client && <ModelFeedback models={models} connected={connected} creatingRun={run.creating} />}
				{connectionNotice}
				{workspace.recoveryError && <p role="alert">{workspace.recoveryError}</p>}
			</AppIdentity>
			<div className="hud-frame__content">{renderContent()}</div>
			{navigation.view === "run" && <HudFooter
				message={message}
				selected={messageIndex}
				status={status}
				count={client ? display.count : mockMessages.length}
				currentIndex={client ? display.currentIndex : undefined}
				onSelect={client ? run.select : setPreviewMessage}
				draft={draft.value}
				reply={workspace.reply}
				interrupt={workspace.interrupt}
				cancel={workspace.cancel}
				onClear={clearDraft}
			/>}
			<HudDividerControls mode={layout} disabled={navigation.view !== "run"} onChange={setLayout} />
		</main>
	)
}
