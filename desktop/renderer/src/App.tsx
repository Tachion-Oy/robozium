import { useEffect, useRef, useState, type ReactNode } from "react"
import { HudHeader } from "./components/hud/HudHeader"
import { ViewPlaceholder } from "./components/views/ViewPlaceholder"
import { RunOverview } from "./components/views/RunOverview"
import { HudPanels } from "./components/hud/HudPanels"
import { HudDividerControls, type LayoutMode } from "./components/hud/HudDividerControls"
import { HudFooter } from "./components/hud/HudFooter"
import { mockMessages } from "./fixtures/run"
import { modelOptions, type HudView } from "./fixtures/header"
import type { DesktopApiClient } from "./api/client"
import { useModels, useProjects } from "./api/useSelection"
import { Projects } from "./components/views/Projects"
import { HudButton } from "./components/hud/HudButton"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
}

export function App({ connectionNotice, client = null, connected = true }: AppProps) {
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [model, setModel] = useState<string>("mock")
	const [view, setView] = useState<HudView>("projects")
	const projects = useProjects(client, view === "projects")
	const models = useModels(client, connected)
	const [hasRun, setHasRun] = useState(false)
	const [draft, setDraft] = useState("")
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const editor = useRef<HTMLTextAreaElement>(null)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)

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
				modelDisabled={Boolean(client && (!connected || models.pending))}
				modelPlaceholder={models.pending ? "Loading models…" : models.error ? "Models unavailable" : "No models available"}
				onSelectModel={client ? models.choose : setModel} view={view} hasRun={hasRun}
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
					<HudButton aria-disabled={!connected || models.pending} onClick={models.refresh}>Refresh models</HudButton>
					<HudButton aria-label="Retry model change" aria-disabled={!models.canRetry} onClick={models.retry}>Retry change</HudButton>
				</div>}
				{connectionNotice}
			</div>
			<div className="hud-frame__content">
				{view === "run" ? (
					<HudPanels message={mockMessages[selectedMessage]} draft={draft} onDraftChange={setDraft}
						layout={layout} focusOnOpen={focusRunEditor} editor={editor} />
				) : view === "projects" ? (
					<div className={client ? "selection-overview" : "preview-overview"}>
					{client && <Projects state={projects} />}
					<RunOverview connected={Boolean(client)} hasRun={hasRun} onOpen={() => {
						setHasRun(true)
						setFocusRunEditor(true)
						setView("run")
					}} />
					</div>
				) : <ViewPlaceholder view={view} />}
			</div>
			{view === "run" && <HudFooter message={mockMessages[selectedMessage]} selected={selectedMessage}
				count={mockMessages.length} onSelect={setSelectedMessage} draft={draft}
				onClear={() => { setDraft(""); editor.current?.focus() }} />}
			<HudDividerControls mode={layout} disabled={view !== "run"} onChange={setLayout} />
		</main>
	)
}
