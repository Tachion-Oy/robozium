// Compose feature state into the HUD; keep navigation and draft ownership here.
import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react"
import { RunHud } from "../run/RunHud"
import { HudCopyControls } from "../run/HudCopyControls"
import { HubFileUrlContext } from "../run/HudImage"
import { AgentHud } from "../hud/AgentHud"
import { MessageLog } from "../log/MessageLog"
import { HudHeader } from "../hud/HudHeader"
import { HudRunSelector } from "../hud/HudRunSelector"
import { ModelSelector } from "../hud/ModelSelector"
import type { LayoutMode } from "../hud/HudCornerControls"
import { ProjectOverview } from "../projects/ProjectOverview"
import { OnboardingHud } from "../onboarding/OnboardingHud"
import { CapabilitySelector } from "../projects/CapabilitySelector"
import { initialHudNavigation, reduceHudNavigation, screenOptions, visibleScreen, type HudLimits, type HudScreen } from "../../app/hud-navigation"
import type { DesktopApiClient } from "../../api/client"
import { useModels } from "../../models/useModels"
import { useProjectQuery } from "../../projects/useProjectQuery"
import { useProjectMutations } from "../../projects/useProjectMutations"
import { useCapabilities } from "../../capabilities/useCapabilities"
import { PasswordDialog } from "../hud/PasswordDialog"
import { useCredentials } from "../../credentials/useCredentials"
import { EnvironmentPanel } from "../environment/EnvironmentPanel"
import { useEnvironmentDraft } from "../../environment/useEnvironmentDraft"
import { useEnvironmentMutations } from "../../environment/useEnvironmentMutations"
import { useHubFolder } from "../../hub-folder/useHubFolder"
import { DependencyPanel } from "../dependencies/DependencyPanel"
import { useDependencies } from "../../dependencies/useDependencies"
import { useRunSession } from "../../session/useRunSession"
import { useRunMutations } from "../../session/useRunMutations"
import { useReplyAttachments } from "../../attachments/useReplyAttachments"
import { hubFileUrl } from "../../attachments/attachments-api"
import { useDictation } from "../../dictation/useDictation"
import { THINKING_LINE_INTERVAL_MS } from "../../hud/hud-display"
import { isTerminal, runLabels, RunStatus, type RunRecord } from "../../run/run-contracts"
import { useMessageLog } from "../../log/useMessageLog"
import type { BackendOperations } from "../backend/BackendStartup"
import { Toast } from "../feedback/Toast"

const noEvents: readonly RunRecord[] = []

interface AppProps {
	client: DesktopApiClient
	connected: boolean
	/** The startup screen covers the HUD. */
	covered: boolean
	/** A backend restart, recreate or the close runs under the startup screen; the backend may be down. */
	operating: boolean
	/** Backend restarts, covered by the startup screen. */
	backend: BackendOperations
}

export function App({ client, connected, covered, operating, backend }: AppProps) {
	const [navigation, navigate] = useReducer(reduceHudNavigation, initialHudNavigation)
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const runSession = useRunSession(client)
	const messageLog = useMessageLog()
	// Polls wait for a connected backend and stop while a restart or the close runs, so a poll
	// that fails against a stopping or starting backend never flashes an error. Under the launch
	// animation the screens load as usual, so the HUD is drawn before the animation fades into it.
	const polling = connected && !operating
	const credentials = useCredentials(client, connected, !covered)
	const showRun = () => { setFocusRunEditor(true); navigate({ type: "screen_selected", screen: "run" }) }
	const projectMutations = useProjectMutations(client, {
		onLaunched: (runId, project) => { runSession.open(runId, project); navigate({ type: "launch_closed" }); showRun() },
		onProjectCreated: (name, project) => navigate({ type: "launch_created", name, project }),
		secrets: credentials,
	})
	const runMutations = useRunMutations(client, runSession, credentials)
	const run = runSession.run
	const runEnded = Boolean(run?.synchronized && isTerminal(run.status))
	// Above the screens, so switching views keeps the staged attachments.
	const replyAttachments = useReplyAttachments(client, run?.runId ?? null, runEnded)
	const fileUrl = useMemo(() => (path: string) => hubFileUrl(client, path), [client])
	const [draft, setDraft] = useState("")
	// Like the attachments, the text belongs to one live run: opening another run or
	// ending this one empties it, so old text never resurfaces in a later run.
	const draftRunId = runEnded ? null : run?.runId ?? null
	const [draftOwner, setDraftOwner] = useState(draftRunId)
	if (draftOwner !== draftRunId) {
		setDraftOwner(draftRunId)
		setDraft("")
	}
	// A transcript joins the draft after a space.
	const dictation = useDictation({ client, onTranscript: text =>
		setDraft(current => current.trim() ? `${current.trimEnd()} ${text}` : text) })
	const [layout, setLayout] = useState<LayoutMode>("top")
	const display = runSession.display
	const statusLabel = run?.unavailable ? "Run unavailable" : run ? runLabels[run.status] : "Awaiting input"
	// A live start without keys locks the HUD on the guide and Environment.
	const setupRequired = Boolean(credentials.status?.setupRequired)
	// A change that applies after a restart locks the HUD on Environment until Restart app.
	const restartRequired = Boolean(credentials.status?.restartRequired)
	const locked = setupRequired || restartRequired
	const runLive = run !== null && !runEnded && !run.unavailable
	const limits: HudLimits = { runLive, setupRequired, restartRequired }
	// Current Runs is open only for a live run with nothing locked.
	const screen = visibleScreen(navigation.screen, limits)
	// Current Runs shows and switches its live run's model; other screens set the default.
	const modelRunId = screen === "run" && run ? run.runId : null
	const models = useModels(client, connected, modelRunId)
	// While Current Runs shows a live run, each tick lets the working HUD add a line naming its model.
	const modelLabel = models.selection?.models.find(model => model.model_id === models.selection?.selected_model_id)?.label
	const tick = runSession.tick
	useEffect(() => {
		if (modelRunId === null || !modelLabel) return
		const timer = setInterval(() => tick(new Date(), modelLabel), THINKING_LINE_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [modelRunId, modelLabel, tick])
	// Current Runs lists the live runs as the overview does.
	const projectQuery = useProjectQuery(client, (screen === "projects" || screen === "run") && polling, projectMutations)
	const capabilities = useCapabilities(client, navigation.launch?.project ?? null, screen === "launch")
	// Each write's outcome goes to the draft declared below; it runs only after both exist.
	const environmentMutations = useEnvironmentMutations(client, setupRequired, restartRequired, {
		onReplaced: next => environmentDraft.replaced(next),
		onImported: result => environmentDraft.imported(result),
		onRemoved: name => environmentDraft.removed(name),
		onReset: () => environmentDraft.reset(),
		onUnread: () => environmentDraft.reload(),
		// Keys that load end setup; a change that needs a restart locks the HUD. A write never changes the screen.
		onSettled: credentials.refresh,
	})
	const environmentDraft = useEnvironmentDraft(client, screen === "environment" && polling, environmentMutations)
	const hubFolder = useHubFolder()
	const dependencies = useDependencies(client, screen === "dependencies")
	// A launch, a disconnection or an unconfirmed model change locks navigation.
	const navigationPending = projectMutations.launching || !connected || models.pending
	const selectScreen = (next: HudScreen) => { setFocusRunEditor(false); navigate({ type: "screen_selected", screen: next }) }
	// The displayed run's own row only shows it again.
	const openRun = (runId: string, project: string) => {
		if (run?.runId !== runId) runSession.open(runId, project)
		showRun()
	}
	// The HUD and the overview rows share one cancellation per project.
	const cancelling = run !== null && (projectMutations.pending.has(run.project) || run.status === RunStatus.Cancelling)
	const runError = screen === "run" ? run?.error : ""
	// The right edge's copy and clear buttons act on the displayed run's message and draft; the guide shows them disabled.
	let copyControls: ReactNode = null
	if (screen === "run" && run) {
		copyControls = <HudCopyControls key={run.runId} message={display} replyDraft={draft} hasAttachments={replyAttachments.items.length > 0}
			onClearReply={() => { setDraft(""); replyAttachments.onClear() }} />
	} else if (screen === "onboarding") {
		copyControls = <HudCopyControls message={null} replyDraft="" hasAttachments={false} disabled onClearReply={() => {}} />
	}

	function renderContent() {
		switch (screen) {
			case "run":
				return <div className="agent-hud__run-view">
					{run && <p className="sr-only" role="status" aria-label="Run status">{run.project} · {statusLabel}</p>}
					<HubFileUrlContext value={fileUrl}>
						<RunHud key={run?.runId} draft={draft} onDraftChange={setDraft} attachments={replyAttachments} dictation={dictation}
							layoutMode={layout} display={display} awaitingInput={Boolean(run?.prompt)}
							focusOnOpen={focusRunEditor} onSelect={runSession.select}
							mutations={runMutations}
							cancel={{ isPending: cancelling, available: Boolean(run && !isTerminal(run.status)),
								onTrigger: () => { if (run && !cancelling) void projectMutations.cancel(run.project) } }}
							interrupt={{ isPending: runMutations.interrupting, available: runMutations.canInterrupt,
								onTrigger: () => void runMutations.interrupt() }} />
					</HubFileUrlContext>
				</div>
			case "projects":
				return <ProjectOverview projects={projectQuery} mutations={projectMutations} navigationPending={navigationPending}
					locked={locked} onOpenRun={openRun}
					onSelectCapabilities={project => navigate({ type: "launch_opened", project })}
					onStartHere={() => selectScreen("onboarding")} />
			case "onboarding":
				return <div className="agent-hud__run-view">
					<OnboardingHud layoutMode={layout} onExit={() => selectScreen("projects")} />
				</div>
			case "launch":
				return navigation.launch && <CapabilitySelector draft={navigation.launch} capabilities={capabilities}
					disabled={navigationPending}
					onChange={change => navigate({ type: "launch_changed", change })}
					onCancel={() => navigate({ type: "launch_closed" })}
					onRename={async (from, name) => {
						const project = await projectMutations.rename(from, name)
						if (project === null) return false
						navigate({ type: "launch_renamed", from, project })
						return true
					}}
					onSubmit={selection => { if (navigation.launch) void projectMutations.launch({ ...navigation.launch, selection }) }} />
			case "dependencies":
				return <DependencyPanel dependencies={dependencies} />
			case "environment":
				return <EnvironmentPanel draft={environmentDraft} mutations={environmentMutations} hub={hubFolder} restartRequired={restartRequired} onRestart={backend.restartApp} />
		}
	}

	return (
		<>
			<AgentHud screen={screen} inactive={run !== null && !runLive}
				layoutMode={layout} onLayoutModeChange={setLayout} messageLog={messageLog}
				logPane={() => <MessageLog key={run?.runId} active={runLive} events={run?.events ?? noEvents} />}
				header={<HudHeader screen={screen} screenOptions={screenOptions(screen, navigation.launch !== null, limits)}
					projectSlug={run?.project ?? null} onSelectScreen={selectScreen}
					runSelector={<HudRunSelector runId={run?.runId ?? null} project={run?.project ?? null} rows={projectQuery.rows}
						disabled={navigationPending || locked} onOpenRun={openRun} />}
					modelSelector={<ModelSelector models={models} disabled={locked || !connected || projectMutations.launching} />} />}
				copyControls={copyControls}>
				{renderContent()}
			</AgentHud>
			<PasswordDialog open={credentials.asking} title="Unlock secrets" label="Password" submitLabel="Unlock" pendingLabel="Unlocking…"
				onSubmit={async password => await credentials.unlock(password) ? null : "Could not unlock secrets. Check the password and try again."}
				onCancel={credentials.cancel}>
				<p>Enter the password your secrets are encrypted with.</p>
			</PasswordDialog>
			{/* Problems are toasts, never lines above the panels. */}
			{models.error && <Toast tone="error" title="Model unavailable" message={models.error} />}
			{runError && <Toast tone="error" title="Run output unavailable" message={runError}
				actions={[{ label: "Retry output", disabled: !connected || projectMutations.launching, onClick: runSession.retry }]} />}
		</>
	)
}
