// Compose feature state and HUD controls; keep app navigation, theme and draft ownership here.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { HudHeader } from "../hud/HudHeader"
import { ViewPlaceholder } from "./ViewPlaceholder"
import { RunOverview } from "../run/RunOverview"
import { HudPanels } from "../hud/HudPanels"
import { HudDividerControls, type LayoutMode } from "../hud/HudDividerControls"
import { HudFooter } from "../hud/HudFooter"
import { mockMessages, modelOptions } from "../../app/preview"
import { viewOptions, runViewOptions, type AppView } from "../../app/navigation"
import type { DesktopApiClient } from "../../api/client"
import { useModels } from "../../models/useModels"
import { useProjects } from "../../projects/useProjects"
import { Projects } from "../projects/Projects"
import { HudButton } from "../HudButton"
import { useRunSession } from "../../session/useRunSession"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
}

export function App({ connectionNotice, client = null, connected = true }: AppProps) {
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [model, setModel] = useState<string>("mock")
	const [view, setView] = useState<AppView>("projects")
	const projects = useProjects(client, view === "projects")
	const models = useModels(client, connected)
	const [hasPreview, setHasPreview] = useState(false)
	const run = useRunSession(client)
	const session = run.session
	const hasRun = client ? session !== null : hasPreview
	const [draft, setDraft] = useState("")
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const editor = useRef<HTMLTextAreaElement>(null)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)
	const display = selectRunDisplay(session)
	const messageIndex = client ? display.index : selectedMessage
	const message = client ? display.text : mockMessages[selectedMessage]
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	const canStart = connected && Boolean(projects.selected && models.selection?.selected_model_id) && !models.pending && !models.error && !run.creating
	const showRun = () => { setFocusRunEditor(true); setView("run") }
	const startRun = async () => {
		if (!client) { setHasPreview(true); showRun(); return }
		if (canStart && await run.start(projects.selected)) showRun()
	}

	useEffect(() => {
		document.documentElement.dataset.theme = theme
	}, [theme])

	useEffect(() => {
		let active = true
		const GetVersion = async () => {
			try {
				const value = await window.robozium.getVersion()
				if (value) {
					if (active) setVersion(value)
					return
				}
			} catch {
				if (active) setFailed(true)
			}
		}
		GetVersion()
		return () => {
			active = false
		}
	}, [])

	return (
		<main className="hud-frame">
			<HudHeader
				model={client ? models.selection?.selected_model_id ?? "" : model}
				models={client ? models.selection?.models.map(item => ({ value: item.model_id, label: item.label })) ?? [] : modelOptions}
				modelDisabled={Boolean(client && (!connected || models.pending || run.creating))}
				modelPlaceholder={models.pending ? "Loading models…" : models.error ? "Models unavailable" : "No models available"}
				onSelectModel={client ? value => { if (!run.creating) models.choose(value) } : setModel} view={view} views={hasRun ? runViewOptions : viewOptions}
				onSelectView={next => { setFocusRunEditor(false); setView(next) }}
				theme={theme}
				onToggleTheme={() =>
					setTheme((current) =>
						current === "dark" ? "light" : "dark",
					)
				}
			/>
			<div className="hud-frame__identity">
				<h1>Robozium</h1>
				<p role={failed ? "alert" : "status"}>
					{failed
						? "Unable to read the application version."
						: version === undefined
							? "Loading version…"
							: `Version ${version}`}
				</p>
				{client && <div className="model-feedback">
					<p role={models.error ? "alert" : "status"}>{models.error || (models.pending
						? "Updating models…" : models.selection?.models.length ? "" : "No models available.")}</p>
					<HudButton aria-disabled={!connected || models.pending || run.creating} onClick={() => { if (!run.creating) models.refresh() }}>Refresh models</HudButton>
					<HudButton aria-label="Retry model change" aria-disabled={!models.canRetry || run.creating} onClick={() => { if (!run.creating) models.retry() }}>Retry change</HudButton>
				</div>}
				{connectionNotice}
			</div>
			<div className="hud-frame__content">
				{view === "run" ? (
					<HudPanels message={message} messageId={client ? display.id : String(selectedMessage)}
						streaming={Boolean(client && display.streaming)}
						notice={session && <div className="run-feedback">
							<p role="status" aria-label="Run status">{session.run.project} · {status}</p>
							{session.run.error && <p role="alert">{session.run.error}</p>}
							{session.run.error && <HudButton onClick={run.retry} disabled={!connected || run.creating}>Retry output</HudButton>}
						</div>}
						draft={draft} onDraftChange={setDraft}
						layout={layout} focusOnOpen={focusRunEditor} editor={editor} />
				) : view === "projects" ? (
					<div className={client ? "selection-overview" : "preview-overview"}>
					{client && <Projects state={projects} />}
					<RunOverview connected={Boolean(client)} hasRun={hasRun} onOpen={showRun}
						onStart={() => { void startRun() }} disabled={Boolean(client) && !canStart}
						creating={run.creating} error={run.createError} project={projects.selected} />
					</div>
				) : <ViewPlaceholder view={view} />}
			</div>
			{view === "run" && <HudFooter message={message} selected={messageIndex} status={status}
				count={client ? display.count : mockMessages.length} currentIndex={client ? display.currentIndex : undefined}
				onSelect={client ? run.select : setSelectedMessage} draft={draft}
				onClear={() => { setDraft(""); editor.current?.focus() }} />}
			<HudDividerControls mode={layout} disabled={view !== "run"} onChange={setLayout} />
		</main>
	)
}
