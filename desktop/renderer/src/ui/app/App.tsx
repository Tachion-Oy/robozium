// Compose feature state into the reference HUD frame; keep navigation and draft ownership here.
import { useMemo, useReducer, useState, type ReactNode } from "react"
import { ViewPlaceholder } from "./ViewPlaceholder"
import { RunHud } from "../run/RunHud"
import { HubFileUrlContext } from "../run/HudImage"
import { ToastViewport } from "../feedback/ToastViewport"
import { AgentHud } from "../hud/AgentHud"
import { MessageLog } from "../log/MessageLog"
import { HudHeader } from "../hud/HudHeader"
import { ModelSelector } from "../hud/ModelSelector"
import type { LayoutMode } from "../hud/HudCornerControls"
import { resolveHudPresentation, type HudScreen } from "../hud/hudPresentation"
import { ProjectOverview } from "../projects/ProjectOverview"
import { OnboardingHud } from "../onboarding/OnboardingHud"
import { ProjectOverviewPanel } from "../projects/ProjectOverviewPanel"
import { CapabilitySelector } from "../projects/CapabilitySelector"
import { mockMessages, modelOptions } from "../../app/preview"
import { initialHudNavigation, reduceHudNavigation } from "../../app/hud-navigation"
import type { DesktopApiClient } from "../../api/client"
import { useModels, type ModelsState } from "../../models/useModels"
import { useProjectQuery } from "../../projects/useProjectQuery"
import { useProjectMutations } from "../../projects/useProjectMutations"
import { ProjectStatus, type ProjectRow } from "../../projects/landing"
import { useCapabilities } from "../../capabilities/useCapabilities"
import { HudButton } from "../HudButton"
import { UnlockApiKeys } from "../hud/UnlockApiKeys"
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
import type { HudDisplay } from "../../hud/hud-view"
import { useMessageLog } from "../../log/useMessageLog"
import "./interim-content.css"

const noEvents: readonly RunRecord[] = []

interface AppProps {
	connectionNotice?: ReactNode
	client?: DesktopApiClient | null
	connected?: boolean
	/** Restart readiness polling, which stops while the backend is unreachable. */
	onReconnect?: () => void
}

/** Standalone preview shows its local messages as plain text. */
function previewDisplay(index: number): HudDisplay {
	const last = mockMessages.length - 1
	return {
		id: String(index), text: mockMessages[index], contentType: "plain-text", streaming: false, working: false,
		index, currentIndex: last, count: mockMessages.length,
	}
}

/** Standalone preview lists one local project; launching it opens the local messages. */
function previewProjects(open: boolean): ProjectRow[] {
	return [open
		? { slug: "preview", status: ProjectStatus.AwaitingUserInput, runId: "preview", createdAt: null }
		: { slug: "preview", status: ProjectStatus.Dormant, runId: null, createdAt: null }]
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

export function App({ connectionNotice, client = null, connected = true, onReconnect = () => {} }: AppProps) {
	const [navigation, navigate] = useReducer(reduceHudNavigation, null, initialHudNavigation)
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const [hasPreview, setHasPreview] = useState(false)
	const runSession = useRunSession(client)
	const messageLog = useMessageLog()
	const credentials = useCredentials(client, connected)
	const showRun = () => { setFocusRunEditor(true); navigate({ type: "screen_selected", screen: "run" }) }
	const projectMutations = useProjectMutations(client, {
		onLaunched: (runId, project) => { runSession.open(runId, project); navigate({ type: "launch_closed" }); showRun() },
		onProjectCreated: (name, project) => navigate({ type: "launch_created", name, project }),
		onSecretsLocked: credentials.refresh,
	})
	const runMutations = useRunMutations(client, runSession, credentials.refresh)
	const session = runSession.session
	const runEnded = Boolean(session?.run.synchronized && isTerminal(session.run.status))
	// Above the screens, so switching views keeps the staged images.
	const replyImages = useReplyImages(client, session?.run.runId ?? null, runEnded)
	const fileUrl = useMemo(() => client ? (path: string) => hubFileUrl(client, path) : null, [client])
	const hasRun = client ? session !== null : hasPreview
	const [draft, setDraft] = useState("")
	// As in the reference, a transcript joins the draft after a space.
	const dictation = useDictation({ client, onTranscript: text =>
		setDraft(current => current.trim() ? `${current.trimEnd()} ${text}` : text) })
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const display = client ? selectRunDisplay(session) : previewDisplay(selectedMessage)
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	// A live start without keys locks the HUD on the guide and Environment, as in the web HUD.
	const setupRequired = Boolean(credentials.status?.setupRequired)
	// As in the reference, a run that ends or goes missing leaves Current Run for the overview.
	const presentation = resolveHudPresentation({
		hasRun,
		runEnded,
		runUnavailable: Boolean(session?.run.unavailable),
		selectedScreen: navigation.screen,
		launch: navigation.launch,
		setupRequired,
	})
	const screen = presentation.screen
	// As in the web HUD, Current Run shows and switches its live run's model; other screens set the default.
	const modelRun = screen === "run" && session && !runEnded && !session.run.unavailable ? session.run.runId : null
	const backendModels = useModels(client, connected, modelRun)
	const previewModels = usePreviewModels()
	const models = client ? backendModels : previewModels
	const projectQuery = useProjectQuery(client, screen === "projects", projectMutations)
	const capabilities = useCapabilities(client, navigation.launch?.project ?? null, screen === "launch")
	// Each write's outcome goes to the draft declared below; it runs only after both exist.
	const environmentMutations = useEnvironmentMutations(client, setupRequired, {
		onReplaced: next => environmentDraft.replaced(next),
		onImported: result => environmentDraft.imported(result),
		onRemoved: name => environmentDraft.removed(name),
		onReset: () => environmentDraft.reset(),
		// Keys that load without a restart end setup: refresh the status and return to Runs Overview.
		onKeysLoaded: () => {
			credentials.refresh()
			if (setupRequired) navigate({ type: "screen_selected", screen: "projects" })
		},
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
	const modelError = client ? models.error : ""
	const runError = screen === "run" ? session?.run.error : ""
	const notices = (connectionNotice || modelError || runError) &&
		<div className="desktop-interim-content__notices">
			{modelError && <p role="alert">{modelError}</p>}
			{runError && <p role="alert">{runError}</p>}
			{runError && <HudButton onClick={runSession.retry} disabled={!connected || projectMutations.launching}>Retry output</HudButton>}
			{connectionNotice}
		</div>
	const noticesRow = notices && <div className="desktop-interim-content desktop-interim-content--notices">{notices}</div>

	function renderContent() {
		switch (screen) {
			case "run":
				return <div className="agent-hud__run-view">
					{session && <p className="sr-only" role="status" aria-label="Run status">{session.run.project} · {status}</p>}
					<HubFileUrlContext value={fileUrl}>
						<RunHud key={session?.run.runId ?? "preview"} draft={draft} onDraftChange={setDraft} images={replyImages} dictation={dictation}
							layoutMode={layout} display={display} awaitingInput={client ? Boolean(session?.run.prompt) : true}
							focusOnOpen={focusRunEditor} onSelect={client ? runSession.select : setSelectedMessage}
							reply={{ available: runMutations.canReply, submitting: runMutations.replying, submit: runMutations.reply }}
							cancel={{ isPending: cancelling, available: Boolean(session && !isTerminal(session.run.status)),
								onTrigger: () => { if (session && !cancelling) void projectMutations.cancel(session.run.project) } }}
							interrupt={{ isPending: runMutations.interrupting, available: runMutations.canInterrupt,
								onTrigger: () => void runMutations.interrupt() }} />
					</HubFileUrlContext>
				</div>
			case "projects":
				return client
					? <ProjectOverview projects={projectQuery} mutations={projectMutations} navigationPending={navigationPending} isLaunching={projectMutations.isLaunching}
						currentRunId={session?.run.runId ?? null} onCurrentProjectClick={showRun} onOpenRun={openRun}
						onSelectCapabilities={project => navigate({ type: "launch_opened", project })}
						onLaunch={projectMutations.launch} locked={presentation.locked} onStartHere={() => selectScreen("onboarding")} />
					: <ProjectOverviewPanel projects={previewProjects(hasPreview)} navigationPending={false}
						currentRunId={hasPreview ? "preview" : null}
						onProjectClick={() => { if (hasPreview) showRun() }} onSelectCapabilities={() => {}} onNewProject={() => {}}
						onLaunchProject={() => { setHasPreview(true); showRun() }}
						onCancelRun={() => {}} onDeleteProject={() => {}} />
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
				if (client) return <DependencyPanel dependencies={dependencies} onBackendReconnect={onReconnect} />
				// Standalone preview has no dependency monitor; it shows the placeholder.
				return placeholder()
			case "environment":
				if (client) return <EnvironmentPanel draft={environmentDraft} mutations={environmentMutations} hub={hubFolder} onRestart={() => window.robozium.restartApp()} />
				// Standalone preview has no backend settings; it shows the placeholder.
				// falls through
			default:
				return placeholder()
		}
	}

	function placeholder() {
		return <div className="desktop-interim-content">
			<div className="desktop-interim-content__content">
				<ViewPlaceholder title={presentation.screenOptions.find(option => option.value === screen)?.label ?? ""} />
			</div>
		</div>
	}

	return (
		<>
			<AgentHud presentation={presentation} projectSlug={session?.run.project ?? null}
				layoutMode={layout} onLayoutModeChange={setLayout} messageLog={messageLog}
				logPane={() => <MessageLog active={presentation.context === "active-run"} events={session?.run.events ?? noEvents} />}
				header={<HudHeader presentation={presentation} onSelectScreen={selectScreen}
					modelSelector={<ModelSelector models={models} disabled={presentation.locked || Boolean(client && (!connected || projectMutations.launching))} />}
					secretsMenu={client && <UnlockApiKeys credentials={credentials} />} />}>
				{noticesRow}
				{renderContent()}
			</AgentHud>
			<ToastViewport />
		</>
	)
}
