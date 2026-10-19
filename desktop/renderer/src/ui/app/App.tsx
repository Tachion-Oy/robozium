// Compose feature state into the reference HUD frame; keep navigation and draft ownership here.
import { useState, type ReactNode } from "react"
import { ViewPlaceholder } from "./ViewPlaceholder"
import { RunOverview } from "../run/RunOverview"
import { RunHud } from "../run/RunHud"
import { ErrorNotices, useErrorNotices } from "../feedback/ErrorToast"
import { AgentHud } from "../hud/AgentHud"
import { HudHeader } from "../hud/HudHeader"
import { ModelSelector } from "../hud/ModelSelector"
import type { LayoutMode } from "../hud/HudCornerControls"
import { resolveHudPresentation, type HudScreen } from "../hud/hudPresentation"
import { mockMessages, modelOptions } from "../../app/preview"
import type { DesktopApiClient } from "../../api/client"
import { useModels, type ModelsState } from "../../models/useModels"
import { useProjects } from "../../projects/useProjects"
import { Projects } from "../projects/Projects"
import { HudButton } from "../HudButton"
import { useRunSession } from "../../session/useRunSession"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"
import type { HudDisplay } from "../../hud/hud-view"
import "./interim-content.css"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
}

/** Standalone preview shows its local messages as plain text. */
function previewDisplay(index: number): HudDisplay {
	const last = mockMessages.length - 1
	return {
		id: String(index), text: mockMessages[index], contentType: "plain-text", streaming: false,
		index, currentIndex: last, count: mockMessages.length,
	}
}

/** Standalone preview keeps a local model choice until previews use the mock backend. */
function usePreviewModels(): ModelsState {
	const [model, setModel] = useState<string>(modelOptions[0].value)
	return {
		selection: { models: modelOptions.map(option => ({ model_id: option.value, label: option.label })), selected_model_id: model },
		pending: false,
		error: "",
		choose: setModel,
		refresh: () => {},
	}
}

export function App({ connectionNotice, client = null, connected = true }: AppProps) {
	const [view, setView] = useState<HudScreen>("projects")
	const projects = useProjects(client, view === "projects")
	const backendModels = useModels(client, connected)
	const previewModels = usePreviewModels()
	const models = client ? backendModels : previewModels
	const [hasPreview, setHasPreview] = useState(false)
	const run = useRunSession(client)
	const session = run.session
	const hasRun = client ? session !== null : hasPreview
	const [draft, setDraft] = useState("")
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const display = client ? selectRunDisplay(session) : previewDisplay(selectedMessage)
	const errorNotices = useErrorNotices()
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	const canStart = connected && Boolean(projects.selected && models.selection?.selected_model_id) && !models.pending && !models.error && !run.creating
	// Finished and missing runs stay readable in Current Run until the reference's
	// recovery navigation arrives with cancellation and reconnection (roadmap 15 and 17).
	const presentation = resolveHudPresentation({
		hasRun,
		runEnded: false,
		runUnavailable: false,
		selectedScreen: view,
	})
	const screen = presentation.screen
	const showRun = () => { setFocusRunEditor(true); setView("run") }
	const startRun = async () => {
		if (!client) { setHasPreview(true); showRun(); return }
		if (canStart && await run.start(projects.selected)) showRun()
	}
	const selectScreen = (next: HudScreen) => { setFocusRunEditor(false); setView(next) }
	const modelError = client ? models.error : ""
	const runError = screen === "run" ? session?.run.error : ""
	const notices = (connectionNotice || modelError || runError || errorNotices.length > 0) &&
		<div className="desktop-interim-content__notices">
			{modelError && <p role="alert">{modelError}</p>}
			{runError && <p role="alert">{runError}</p>}
			{runError && <HudButton onClick={run.retry} disabled={!connected || run.creating}>Retry output</HudButton>}
			<ErrorNotices items={errorNotices} />
			{connectionNotice}
		</div>

	function renderContent() {
		switch (screen) {
			case "projects":
				return <div className={client ? "selection-overview" : "preview-overview"}>
					{client && <Projects state={projects} />}
					<RunOverview connected={Boolean(client)} hasRun={hasRun} onOpen={showRun}
						onStart={() => { void startRun() }} disabled={Boolean(client) && !canStart}
						creating={run.creating} error={run.createError} project={projects.selected} />
				</div>
			default:
				return <ViewPlaceholder title={presentation.screenOptions.find(option => option.value === screen)?.label ?? ""} />
		}
	}

	return (
		<AgentHud presentation={presentation} projectSlug={session?.run.project ?? null}
			layoutMode={layout} onLayoutModeChange={setLayout}
			header={<HudHeader presentation={presentation} onSelectScreen={selectScreen}
				modelSelector={<ModelSelector models={models} disabled={Boolean(client && (!connected || run.creating))} />} />}>
			{screen === "run" ? <>
				{notices && <div className="desktop-interim-content desktop-interim-content--notices">{notices}</div>}
				<div className="agent-hud__run-view">
					{session && <p className="sr-only" role="status" aria-label="Run status">{session.run.project} · {status}</p>}
					<RunHud key={session?.run.runId ?? "preview"} draft={draft} onDraftChange={setDraft}
						layoutMode={layout} display={display} awaitingInput={client ? Boolean(session?.run.prompt) : true}
						focusOnOpen={focusRunEditor} onSelect={client ? run.select : setSelectedMessage} />
				</div>
			</> : <div className="desktop-interim-content">
				{notices}
				<div className="desktop-interim-content__content">{renderContent()}</div>
			</div>}
		</AgentHud>
	)
}
