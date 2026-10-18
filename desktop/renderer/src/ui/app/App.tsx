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
import type { BackendMode } from "../../../../src/bridge"
import { useRecovery } from "../../recovery/useRecovery"
import type { DesktopApiClient } from "../../api/client"
import { useModels } from "../../models/useModels"
import { useProjects } from "../../projects/useProjects"
import { Projects } from "../projects/Projects"
import { HudButton } from "../HudButton"
import { isTerminal } from "../../run/run-contracts"
import { useRunSession } from "../../session/useRunSession"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
	mode?: BackendMode | null
}

export function App({ connectionNotice, client = null, connected = true, mode = null }: AppProps) {
	const recovery = useRecovery(mode)
	const [restored, setRestored] = useState(recovery.initial.run === null)
	const [theme, setTheme] = useState<"dark" | "light">("dark")
	const [model, setModel] = useState<string>("mock")
	const [view, setView] = useState<AppView>("projects")
	const run = useRunSession(client)
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const [overviewFocus, setOverviewFocus] = useState<string | null>(null)
	const returnAfterCancel = useRef<string | null>(null)
	const [returnOnCompletion, setReturnOnCompletion] = useState<string | null>(null)
	const recoveringRun = useRef(recovery.initial.run?.id ?? null)
	const navigate = (next: AppView) => {
		returnAfterCancel.current = null
		const activeRunId = run.session && !isTerminal(run.session.run.status) ? run.session.run.runId : null
		setReturnOnCompletion(next === "run" ? activeRunId : null)
		setOverviewFocus(null)
		setFocusRunEditor(false)
		setView(next)
	}
	const returnToOverview = (project: string) => {
		returnAfterCancel.current = null
		setReturnOnCompletion(null)
		setFocusRunEditor(false)
		setOverviewFocus(project)
		setView(current => current === "run" ? "projects" : current)
	}
	const activeSessionProject = run.session && !isTerminal(run.session.run.status) && !run.session.run.unavailable
		? run.session.run.project : ""
	const busyProjects = [activeSessionProject, run.creatingProject]
	if (run.session && (run.replying || run.interrupting)) busyProjects.push(run.session.run.project)
	const projects = useProjects(client, view === "projects", connected, {
		onDeleted: run.closeProject, busyProjects, initialSelected: recovery.initial.selectedProject,
		onCancelled: slug => {
			if (run.session?.run.project !== slug || run.session.run.runId !== returnAfterCancel.current) return
			run.refresh()
			returnToOverview(slug)
		},
	})
	const models = useModels(client, connected)
	const [hasPreview, setHasPreview] = useState(false)
	const session = run.session
	const hasRun = client ? session !== null : hasPreview
	const [draft, setDraft] = useState(recovery.initial.draft)
	const draftRevision = useRef(0)
	const changeDraft = (value: string) => { draftRevision.current++; setDraft(value) }
	const cancelling = session ? projects.cancelling.has(session.run.project) : false
	const deleting = session ? projects.deleting.has(session.run.project) : false
	const runActionsAvailable = connected && !deleting && !cancelling
	const canSend = runActionsAvailable && run.canReply && Boolean(draft.trim())
	const canInterrupt = runActionsAvailable && run.canInterrupt
	const hasActiveRun = session && !session.run.unavailable && !isTerminal(session.run.status) && session.run.status !== "cancelling"
	const hasBackgroundWork = projects.projects.some(project => project.slug === session?.run.project && project.status === "syncing")
	const canCancel = Boolean(client && runActionsAvailable && !run.creating && (hasActiveRun || hasBackgroundWork))
	const cancelCurrentProject = () => {
		if (!session || !canCancel) return
		returnAfterCancel.current = session.run.runId
		projects.cancelProject(session.run.project, Boolean(hasActiveRun))
	}
	const send = async () => {
		if (!canSend) return
		const revision = draftRevision.current
		if (await run.reply(draft) && revision === draftRevision.current) changeDraft("")
	}
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const editor = useRef<HTMLTextAreaElement>(null)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const [version, setVersion] = useState<string>()
	const [failed, setFailed] = useState(false)
	const display = selectRunDisplay(session)
	const messageIndex = client ? display.index : selectedMessage
	const message = client ? display.text : mockMessages[selectedMessage]
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	const selectedProject = projects.projects.find(project => project.slug === projects.selected)
	const existingRunId = selectedProject && (selectedProject.status === "running" || selectedProject.status === "awaiting_user_input")
		? selectedProject.runId : null
	const projectAvailable = connected && !run.creating && !projects.loadError
		&& !projects.cancelling.has(projects.selected) && !projects.deleting.has(projects.selected)
	const canOpen = projectAvailable && Boolean(existingRunId)
	const canStart = projectAvailable && selectedProject?.status === "dormant" && selectedProject.runId === null
		&& Boolean(models.selection?.selected_model_id)
		&& !models.pending && !models.error
	const showRun = () => {
		navigate("run")
		setFocusRunEditor(true)
	}
	const startRun = async () => {
		if (!client) { setHasPreview(true); showRun(); return }
		if (canOpen && existingRunId) {
			showRun()
			if (session?.run.runId !== existingRunId) {
				run.restore(existingRunId, projects.selected)
				setReturnOnCompletion(existingRunId)
			}
			return
		}
		if (!canStart) return
		returnAfterCancel.current = null
		setReturnOnCompletion(null)
		const runId = await run.start(projects.selected)
		if (runId) { projects.refresh(); showRun(); setReturnOnCompletion(runId) }
	}

	useEffect(() => {
		if (!client || !connected || restored) return
		const saved = recovery.initial.run
		if (saved) { run.restore(saved.id, saved.project); setView("run"); setReturnOnCompletion(saved.id) }
		setRestored(true)
	}, [client, connected, restored, recovery.initial.run, run.restore])

	useEffect(() => {
		if (!session?.run.synchronized) return
		const { runId, status, project } = session.run
		if (recoveringRun.current === runId) {
			recoveringRun.current = null
			// Reopening an already finished run is an explicit history view.
			if (isTerminal(status)) { setReturnOnCompletion(null); return }
		}
		if (runId === returnOnCompletion && isTerminal(status) && !run.creating) returnToOverview(project)
	}, [session?.run.runId, session?.run.status, session?.run.synchronized, returnOnCompletion, run.creating])

	useEffect(() => {
		if (session) projects.refresh()
	}, [session?.run.runId, session?.run.status, projects.refresh])

	useEffect(() => {
		if (!restored) return
		recovery.save({ version: 1, selectedProject: projects.selected, draft,
			run: session ? { id: session.run.runId, project: session.run.project } : null })
	}, [restored, recovery.save, projects.selected, draft, session?.run.runId, session?.run.project])

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
				onSelectView={navigate}
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
				{recovery.error && <p role="alert">{recovery.error}</p>}
			</div>
			<div className="hud-frame__content">
				{view === "run" ? (
					<HudPanels message={message} messageId={client ? display.id : String(selectedMessage)}
						streaming={Boolean(client && display.streaming)}
						notice={session && <div className="run-feedback">
							<p role="status" aria-label="Run status">{session.run.project} · {status}</p>
							{session.run.error && <p role="alert">{session.run.error}</p>}
							{projects.actionError && <p role="alert">{projects.actionError}</p>}
							{run.actionError && <p role="alert">{run.actionError}</p>}
							{session.run.unavailable && <p>The previous run is unavailable. Your draft is retained. Open Runs Overview to launch explicitly.</p>}
							{session.run.unavailable && <HudButton onClick={() => navigate("projects")}>Open Runs Overview</HudButton>}
							{session.run.error && !session.run.unavailable && <HudButton onClick={run.retry} disabled={!connected || run.creating}>Retry output</HudButton>}
						</div>}
						draft={draft} onDraftChange={changeDraft} onSend={client ? () => { void send() } : undefined}
						layout={layout} focusOnOpen={focusRunEditor} editor={editor} />
				) : view === "projects" ? (
					<div className={client ? "selection-overview" : "preview-overview"}>
					{client && <Projects state={projects} connected={connected} initialFocus={overviewFocus} />}
					<RunOverview connected={Boolean(client)} hasRun={hasRun} onOpen={showRun}
						onStart={() => { void startRun() }} disabled={Boolean(client) && !(canStart || canOpen)}
						existing={Boolean(existingRunId)}
						creating={run.creating} error={run.createError} project={projects.selected} />
					</div>
				) : <ViewPlaceholder view={view} />}
			</div>
			{view === "run" && <HudFooter message={message} selected={messageIndex} status={status}
				count={client ? display.count : mockMessages.length} currentIndex={client ? display.currentIndex : undefined}
				onSelect={client ? run.select : setSelectedMessage} draft={draft}
				reply={{ enabled: canSend, pending: run.replying, onClick: () => { void send() } }}
				interrupt={{ enabled: canInterrupt, pending: run.interrupting, onClick: () => { void run.interrupt() } }}
				cancel={{ enabled: canCancel, pending: cancelling, onClick: cancelCurrentProject }}
				onClear={() => { changeDraft(""); editor.current?.focus() }} />}
			<HudDividerControls mode={layout} disabled={view !== "run"} onChange={setLayout} />
		</main>
	)
}
