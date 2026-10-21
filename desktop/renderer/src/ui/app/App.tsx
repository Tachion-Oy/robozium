// Compose feature state into the reference HUD frame; keep navigation and draft ownership here.
import { useReducer, useState, type ReactNode } from "react"
import { ViewPlaceholder } from "./ViewPlaceholder"
import { RunHud } from "../run/RunHud"
import { ErrorNotices, useErrorNotices } from "../feedback/ErrorToast"
import { AgentHud } from "../hud/AgentHud"
import { HudHeader } from "../hud/HudHeader"
import { ModelSelector } from "../hud/ModelSelector"
import type { LayoutMode } from "../hud/HudCornerControls"
import { resolveHudPresentation, type HudScreen } from "../hud/hudPresentation"
import { ProjectOverview } from "../projects/ProjectOverview"
import { ProjectOverviewPanel } from "../projects/ProjectOverviewPanel"
import { CapabilitySelector } from "../projects/CapabilitySelector"
import { mockMessages, modelOptions } from "../../app/preview"
import { initialHudNavigation, reduceHudNavigation } from "../../app/hud-navigation"
import type { DesktopApiClient } from "../../api/client"
import { useModels, type ModelsState } from "../../models/useModels"
import { useProjectQuery } from "../../projects/useProjectQuery"
import { useProjectMutations } from "../../projects/useProjectMutations"
import { useProjectLaunch } from "../../projects/useProjectLaunch"
import { ProjectStatus, type ProjectRow } from "../../projects/landing"
import { useCapabilities } from "../../capabilities/useCapabilities"
import { HudButton } from "../HudButton"
import { UnlockApiKeys } from "../hud/UnlockApiKeys"
import { useCredentials } from "../../credentials/useCredentials"
import { EnvironmentPanel } from "../environment/EnvironmentPanel"
import { useEnvironmentEditor } from "../../environment/useEnvironmentEditor"
import { useRunSession } from "../../session/useRunSession"
import { useRunMutations } from "../../session/useRunMutations"
import { runLabels } from "../../hud/hud-view"
import { selectRunDisplay } from "../../session/session-reducer"
import { isTerminal, RunStatus } from "../../run/run-contracts"
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

export function App({ connectionNotice, client = null, connected = true }: AppProps) {
	const [navigation, navigate] = useReducer(reduceHudNavigation, null, initialHudNavigation)
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const backendModels = useModels(client, connected)
	const previewModels = usePreviewModels()
	const models = client ? backendModels : previewModels
	const [hasPreview, setHasPreview] = useState(false)
	const run = useRunSession(client)
	const credentials = useCredentials(client, connected)
	const showRun = () => { setFocusRunEditor(true); navigate({ type: "screen_selected", screen: "run" }) }
	const launch = useProjectLaunch(client,
		(runId, project) => { run.open(runId, project); navigate({ type: "launch_closed" }); showRun() },
		(name, project) => navigate({ type: "launch_created", name, project }),
		credentials.refresh)
	const runMutations = useRunMutations(client, run, credentials.refresh)
	const session = run.session
	const hasRun = client ? session !== null : hasPreview
	const [draft, setDraft] = useState("")
	const [selectedMessage, setSelectedMessage] = useState(mockMessages.length - 1)
	const [layout, setLayout] = useState<LayoutMode>("top")
	const display = client ? selectRunDisplay(session) : previewDisplay(selectedMessage)
	const errorNotices = useErrorNotices()
	const status = session?.run.unavailable ? "Run unavailable" : session ? runLabels[session.run.status] : "Awaiting input"
	// As in the reference, a run that ends or goes missing leaves Current Run for the overview.
	const presentation = resolveHudPresentation({
		hasRun,
		runEnded: Boolean(session?.run.synchronized && isTerminal(session.run.status)),
		runUnavailable: Boolean(session?.run.unavailable),
		selectedScreen: navigation.screen,
		launch: navigation.launch,
	})
	const screen = presentation.screen
	const projectMutations = useProjectMutations(client)
	const projects = useProjectQuery(client, screen === "projects", { ...projectMutations, opening: launch.opening })
	const capabilities = useCapabilities(client, navigation.launch?.project ?? null, screen === "launch")
	const environment = useEnvironmentEditor(client, screen === "environment")
	// A launch, a disconnection or an unconfirmed model change locks navigation.
	const navigationPending = launch.pending || !connected || models.pending
	const selectScreen = (next: HudScreen) => { setFocusRunEditor(false); navigate({ type: "screen_selected", screen: next }) }
	const openRun = (runId: string, project: string) => { run.open(runId, project); showRun() }
	// The HUD and the overview rows share one cancellation per project.
	const cancelling = session !== null && (projectMutations.pending.has(session.run.project) || session.run.status === RunStatus.Cancelling)
	const modelError = client ? models.error : ""
	const runError = screen === "run" ? session?.run.error : ""
	const notices = (connectionNotice || modelError || runError || errorNotices.length > 0) &&
		<div className="desktop-interim-content__notices">
			{modelError && <p role="alert">{modelError}</p>}
			{runError && <p role="alert">{runError}</p>}
			{runError && <HudButton onClick={run.retry} disabled={!connected || launch.pending}>Retry output</HudButton>}
			<ErrorNotices items={errorNotices} />
			{connectionNotice}
		</div>
	const noticesRow = notices && <div className="desktop-interim-content desktop-interim-content--notices">{notices}</div>

	function renderContent() {
		switch (screen) {
			case "run":
				return <div className="agent-hud__run-view">
					{session && <p className="sr-only" role="status" aria-label="Run status">{session.run.project} · {status}</p>}
					<RunHud key={session?.run.runId ?? "preview"} draft={draft} onDraftChange={setDraft}
						layoutMode={layout} display={display} awaitingInput={client ? Boolean(session?.run.prompt) : true}
						focusOnOpen={focusRunEditor} onSelect={client ? run.select : setSelectedMessage}
						reply={{ available: runMutations.canReply, submitting: runMutations.replying, submit: runMutations.reply }}
						cancel={{ isPending: cancelling, available: Boolean(session && !isTerminal(session.run.status)),
							onTrigger: () => { if (session && !cancelling) void projectMutations.cancel(session.run.project) } }}
						interrupt={{ isPending: runMutations.interrupting, available: runMutations.canInterrupt,
							onTrigger: () => void runMutations.interrupt() }} />
				</div>
			case "projects":
				return client
					? <ProjectOverview projects={projects} mutations={projectMutations} navigationPending={navigationPending} isLaunching={launch.isLaunching}
						currentRunId={session?.run.runId ?? null} onCurrentProjectClick={showRun} onOpenRun={openRun}
						onSelectCapabilities={project => navigate({ type: "launch_opened", project })}
						onLaunch={launch.launch} />
					: <ProjectOverviewPanel projects={previewProjects(hasPreview)} navigationPending={false}
						currentRunId={hasPreview ? "preview" : null}
						onProjectClick={() => { if (hasPreview) showRun() }} onSelectCapabilities={() => {}} onNewProject={() => {}}
						onLaunchProject={() => { setHasPreview(true); showRun() }}
						onCancelRun={() => {}} onDeleteProject={() => {}} />
			case "launch":
				return navigation.launch && <CapabilitySelector draft={navigation.launch} capabilities={capabilities}
					disabled={navigationPending}
					onChange={change => navigate({ type: "launch_changed", change })}
					onCancel={() => navigate({ type: "launch_closed" })}
					onSubmit={selection => { if (navigation.launch) void launch.launch({ ...navigation.launch, selection }) }} />
			case "environment":
				if (client) return <EnvironmentPanel environment={environment} onRestart={() => window.robozium.restartApp()} />
				// Standalone preview has no backend settings; it shows the placeholder.
				// falls through
			default:
				return <div className="desktop-interim-content">
					<div className="desktop-interim-content__content">
						<ViewPlaceholder title={presentation.screenOptions.find(option => option.value === screen)?.label ?? ""} />
					</div>
				</div>
		}
	}

	return (
		<AgentHud presentation={presentation} projectSlug={session?.run.project ?? null}
			layoutMode={layout} onLayoutModeChange={setLayout}
			header={<HudHeader presentation={presentation} onSelectScreen={selectScreen}
				modelSelector={<ModelSelector models={models} disabled={Boolean(client && (!connected || launch.pending))} />}
				secretsMenu={client && <UnlockApiKeys credentials={credentials} />} />}>
			{noticesRow}
			{renderContent()}
		</AgentHud>
	)
}
