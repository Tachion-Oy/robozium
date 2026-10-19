// Compose feature state into the reference HUD frame; keep navigation and draft ownership here.
import { useRef, useState, type ReactNode } from "react"
import { ViewPlaceholder } from "./ViewPlaceholder"
import { RunOverview } from "../run/RunOverview"
import { HudPanels } from "../hud/HudPanels"
import { HudFooter } from "../hud/HudFooter"
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
import "./interim-content.css"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
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
	const editor = useRef<HTMLTextAreaElement>(null)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const display = selectRunDisplay(session)
	const messageIndex = client ? display.index : selectedMessage
	const message = client ? display.text : mockMessages[selectedMessage]
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

	function renderContent() {
		switch (screen) {
			case "run":
				return <HudPanels message={message} messageId={client ? display.id : String(selectedMessage)}
					streaming={Boolean(client && display.streaming)}
					notice={session && <div className="run-feedback">
						<p role="status" aria-label="Run status">{session.run.project} · {status}</p>
						{session.run.error && <p role="alert">{session.run.error}</p>}
						{session.run.error && <HudButton onClick={run.retry} disabled={!connected || run.creating}>Retry output</HudButton>}
					</div>}
					draft={draft} onDraftChange={setDraft}
					layout={layout} focusOnOpen={focusRunEditor} editor={editor} />
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
			<div className="desktop-interim-content">
				{(connectionNotice || modelError) && <div className="desktop-interim-content__notices">
					{modelError && <p role="alert">{modelError}</p>}
					{connectionNotice}
				</div>}
				<div className="desktop-interim-content__content">{renderContent()}</div>
				{screen === "run" && <HudFooter message={message} selected={messageIndex} status={status}
					count={client ? display.count : mockMessages.length} currentIndex={client ? display.currentIndex : undefined}
					onSelect={client ? run.select : setSelectedMessage} draft={draft}
					onClear={() => { setDraft(""); editor.current?.focus() }} />}
			</div>
		</AgentHud>
	)
}
