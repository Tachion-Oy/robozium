// Compose feature state into the reference HUD frame; keep navigation and draft ownership here.
import { useMemo, useReducer, useState } from "react"
import { RunHud } from "../run/RunHud"
import { HubFileUrlContext } from "../run/HudImage"
import { AgentHud } from "../hud/AgentHud"
import { MessageLog } from "../log/MessageLog"
import { HudHeader } from "../hud/HudHeader"
import { ModelSelector } from "../hud/ModelSelector"
import type { LayoutMode } from "../hud/HudCornerControls"
import { resolveHudPresentation, type HudScreen } from "../hud/hudPresentation"
import { ProjectOverview } from "../projects/ProjectOverview"
import { OnboardingHud } from "../onboarding/OnboardingHud"
import { CapabilitySelector } from "../projects/CapabilitySelector"
import { initialHudNavigation, reduceHudNavigation } from "../../app/hud-navigation"
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
import { useReplyImages } from "../../attachments/useReplyImages"
import { hubFileUrl } from "../../attachments/attachments-api"
import { useDictation } from "../../dictation/useDictation"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"
import { isTerminal, RunStatus, type RunRecord } from "../../run/run-contracts"
import { useMessageLog } from "../../log/useMessageLog"
import type { BackendOperations } from "../backend/BackendStartup"
import { Toast } from "../feedback/Toast"

const noEvents: readonly RunRecord[] = []

interface AppProps {
	client: DesktopApiClient
	connected: boolean
	/** The startup screen covers the HUD. */
	covered: boolean
	/** Backend restarts, covered by the startup screen. */
	backend: BackendOperations
}

export function App({ client, connected, covered, backend }: AppProps) {
	const [navigation, navigate] = useReducer(reduceHudNavigation, null, initialHudNavigation)
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const runSession = useRunSession(client)
	const messageLog = useMessageLog()
	const credentials = useCredentials(client, connected, !covered)
	const showRun = () => { setFocusRunEditor(true); navigate({ type: "screen_selected", screen: "run" }) }
	const projectMutations = useProjectMutations(client, {
		onLaunched: (runId, project) => { runSession.open(runId, project); navigate({ type: "launch_closed" }); showRun() },
		onProjectCreated: (name, project) => navigate({ type: "launch_created", name, project }),
		secrets: credentials,
	})
	const runMutations = useRunMutations(client, runSession, credentials)
	const session = runSession.session
	const runEnded = Boolean(session?.run.synchronized && isTerminal(session.run.status))
	// Above the screens, so switching views keeps the staged images.
	const replyImages = useReplyImages(client, session?.run.runId ?? null, runEnded)
	const fileUrl = useMemo(() => (path: string) => hubFileUrl(client, path), [client])
	const [draft, setDraft] = useState("")
	// Like the images, the text belongs to one live run: opening another run or
	// ending this one empties it, so old text never resurfaces in a later run.
	const draftRun = runEnded ? null : session?.run.runId ?? null
	const [draftOwner, setDraftOwner] = useState(draftRun)
	if (draftOwner !== draftRun) {
		setDraftOwner(draftRun)
		setDraft("")
	}
	// As in the reference, a transcript joins the draft after a space.
	const dictation = useDictation({ client, onTranscript: text =>
		setDraft(current => current.trim() ? `${current.trimEnd()} ${text}` : text) })
	const [layout, setLayout] = useState<LayoutMode>("top")
	const display = selectRunDisplay(session)
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	// A live start without keys locks the HUD on the guide and Environment, as in the web HUD.
	const setupRequired = Boolean(credentials.status?.setupRequired)
	// As in the reference, a run that ends or goes missing leaves Current Run for the overview.
	const presentation = resolveHudPresentation({
		hasRun: session !== null,
		runEnded,
		runUnavailable: Boolean(session?.run.unavailable),
		selectedScreen: navigation.screen,
		launch: navigation.launch,
		setupRequired,
	})
	const screen = presentation.screen
	// As in the web HUD, Current Run shows and switches its live run's model; other screens set the default.
	const modelRun = screen === "run" && session && !runEnded && !session.run.unavailable ? session.run.runId : null
	const models = useModels(client, connected, modelRun)
	const projectQuery = useProjectQuery(client, screen === "projects", projectMutations)
	const capabilities = useCapabilities(client, navigation.launch?.project ?? null, screen === "launch")
	// Each write's outcome goes to the draft declared below; it runs only after both exist.
	const environmentMutations = useEnvironmentMutations(client, setupRequired, {
		onReplaced: next => environmentDraft.replaced(next),
		onImported: result => environmentDraft.imported(result),
		onRemoved: name => environmentDraft.removed(name),
		onReset: () => environmentDraft.reset(),
		// Keys that load without a restart end setup. A write in Environment never changes the screen.
		onKeysLoaded: credentials.refresh,
	})
	const environmentDraft = useEnvironmentDraft(client, screen === "environment", environmentMutations)
	const hubFolder = useHubFolder()
	const dependencies = useDependencies(client, screen === "dependencies")
	// A launch, a disconnection or an unconfirmed model change locks navigation.
	const navigationPending = projectMutations.launching || !connected || models.pending
	const selectScreen = (next: HudScreen) => { setFocusRunEditor(false); navigate({ type: "screen_selected", screen: next }) }
	const openRun = (runId: string, project: string) => { runSession.open(runId, project); showRun() }
	// The HUD and the overview rows share one cancellation per project.
	const cancelling = session !== null && (projectMutations.pending.has(session.run.project) || session.run.status === RunStatus.Cancelling)
	const runError = screen === "run" ? session?.run.error : ""

	function renderContent() {
		switch (screen) {
			case "run":
				return <div className="agent-hud__run-view">
					{session && <p className="sr-only" role="status" aria-label="Run status">{session.run.project} · {status}</p>}
					<HubFileUrlContext value={fileUrl}>
						<RunHud key={session?.run.runId} draft={draft} onDraftChange={setDraft} images={replyImages} dictation={dictation}
							layoutMode={layout} display={display} awaitingInput={Boolean(session?.run.prompt)}
							focusOnOpen={focusRunEditor} onSelect={runSession.select}
							reply={{ available: runMutations.canReply, submitting: runMutations.replying, submit: runMutations.reply }}
							cancel={{ isPending: cancelling, available: Boolean(session && !isTerminal(session.run.status)),
								onTrigger: () => { if (session && !cancelling) void projectMutations.cancel(session.run.project) } }}
							interrupt={{ isPending: runMutations.interrupting, available: runMutations.canInterrupt,
								onTrigger: () => void runMutations.interrupt() }} />
					</HubFileUrlContext>
				</div>
			case "projects":
				return <ProjectOverview projects={projectQuery} mutations={projectMutations} navigationPending={navigationPending} isLaunching={projectMutations.isLaunching}
					currentRunId={session?.run.runId ?? null} onCurrentProjectClick={showRun} onOpenRun={openRun}
					onSelectCapabilities={project => navigate({ type: "launch_opened", project })}
					onLaunch={projectMutations.launch} locked={presentation.locked} onStartHere={() => selectScreen("onboarding")} />
			case "onboarding":
				return <div className="agent-hud__run-view">
					<OnboardingHud layoutMode={layout} onExit={() => selectScreen("projects")} />
				</div>
			case "launch":
				return navigation.launch && <CapabilitySelector draft={navigation.launch} capabilities={capabilities}
					disabled={navigationPending}
					onChange={change => navigate({ type: "launch_changed", change })}
					onCancel={() => navigate({ type: "launch_closed" })}
					onSubmit={selection => { if (navigation.launch) void projectMutations.launch({ ...navigation.launch, selection }) }} />
			case "dependencies":
				return <DependencyPanel dependencies={dependencies} />
			case "environment":
				return <EnvironmentPanel draft={environmentDraft} mutations={environmentMutations} hub={hubFolder} onRestart={backend.restartApp} onManageBackend={backend.manage} />
		}
	}

	return (
		<>
			<AgentHud presentation={presentation}
				layoutMode={layout} onLayoutModeChange={setLayout} messageLog={messageLog}
				logPane={() => <MessageLog active={presentation.context === "active-run"} events={session?.run.events ?? noEvents} />}
				header={<HudHeader presentation={presentation} projectSlug={session?.run.project ?? null} onSelectScreen={selectScreen}
					modelSelector={<ModelSelector models={models} disabled={presentation.locked || !connected || projectMutations.launching} />} />}>
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
