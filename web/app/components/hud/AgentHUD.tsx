"use client"

import { useEffect, useReducer, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useStore } from "zustand"
import {
	agentActivityStateForPhase,
	hasPermanentRunFailure,
	RunHudPhase,
} from "@/lib/robozium/session/reducer"
import type { ModelSelection, Project } from "@/lib/robozium/wire"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import { useHudEscapeDismiss } from "@/hooks/useHudEscapeDismiss"
import { useRunSessionSelector } from "@/hooks/useRunSession"
import { useProjectLaunch } from "@/hooks/useProjectLaunch"
import { initialHudNavigation, reduceHudNavigation } from "@/lib/robozium/hud-navigation"
import {
	HudCornerControls,
	type LayoutMode,
	moveLayoutMode,
} from "./HudCornerControls"
import { HudHeader } from "./HudHeader"
import { HudProjectBadge } from "./HudProjectBadge"
import {
	resolveHudPresentation,
	type HudScreen,
} from "./hudPresentation"
import { HudScreenContent } from "./HudScreenContent"
import { ResizableHudBox } from "./HudResizeHandle"
import { MinimizedHudControl } from "./MinimizedHudControl"

type AgentHUDProps = {
	runId: string | null
	introDone?: boolean
	initialProjects?: Project[] | null
	modelSelectionPromise?: Promise<ModelSelection | null> | null
	defaultModelSelectionPromise?: Promise<ModelSelection | null> | null
}

export function AgentHUD({
	runId,
	introDone = false,
	initialProjects = null,
	modelSelectionPromise = null,
	defaultModelSelectionPromise = null,
}: AgentHUDProps) {
	const [layoutMode, setLayoutMode] = useState<LayoutMode>("top")
	const [navigation, dispatch] = useReducer(reduceHudNavigation, runId, initialHudNavigation)
	const launchProject = useProjectLaunch(() => dispatch({ type: "launch_closed" }))
	const [replyDraft, setReplyDraft] = useState("")
	if (runId !== navigation.runId) {
		dispatch({ type: "reset", runId })
		setLayoutMode("top")
		setReplyDraft("")
	}
	const phase = useRunSessionSelector(
		(state) => state.hud.phase,
		RunHudPhase.Passive,
	)
	const projectSlug = useRunSessionSelector(
		(state) => state.projectSlug,
		null,
	)
	const runStatus = useRunSessionSelector(
		(state) => state.hud.status,
		null,
	)
	const isCancelling = useRunSessionSelector(
		(state) => state.hud.isCancelling,
		false,
	)
	const runUnavailable = useRunSessionSelector(
		hasPermanentRunFailure,
		false,
	)
	const isRunInactive = useRunSessionSelector(
		(state) => state.hud.phase !== RunHudPhase.Prompting,
		true,
	)

	const presentation = resolveHudPresentation({
		hasRun: Boolean(runId),
		phase,
		runUnavailable,
		selectedScreen: navigation.screen,
		launch: navigation.launch,
	})
	const { context } = presentation
	const isLanding = context === "landing"
	const isRecovery = context === "recovery"
	const visibleModelSelectionPromise = presentation.modelScope === "default"
		? (defaultModelSelectionPromise ?? modelSelectionPromise)
		: modelSelectionPromise
	const minimizedAgentActivityState =
		isRecovery ||
		isCancelling ||
		runStatus === "cancelling"
			? null
			: agentActivityStateForPhase(phase)
	const isOpen = useStore(hudVisibilityStore, (state) => state.open)
	const searchParams = useSearchParams()
	const fromApp = searchParams.get("from") === "app"
	const showPanel = fromApp || Boolean(runId) || introDone
	const [enteredViaIntro, setEnteredViaIntro] = useState(false)
	const [waitedForIntro] = useState(!introDone)
	if (
		!enteredViaIntro &&
		waitedForIntro &&
		!fromApp &&
		isLanding &&
		introDone
	) {
		setEnteredViaIntro(true)
	}

	useEffect(() => {
		if (fromApp) window.history.replaceState(null, "", "/")
	}, [fromApp])

	useEffect(() => {
		hudVisibilityStore.setState({ open: true })
	}, [runId])

	useEffect(() => {
		hudVisibilityStore.setState({
			runActive: context === "active-run",
			prompting: phase === RunHudPhase.Prompting,
		})
	}, [context, phase])

	// Reset only on unmount. Clearing inside the phase effect's cleanup would
	// briefly publish runActive=false on every phase change and unlock the log.
	useEffect(() => {
		return () =>
			hudVisibilityStore.setState({ runActive: false, prompting: false })
	}, [])

	const dismiss = () => {
		dispatch({ type: "launch_closed" })
		hudVisibilityStore.setState({ open: false })
	}
	useHudEscapeDismiss(
		dismiss,
		!isLanding && isOpen && showPanel,
	)

	const showHud = isLanding || Boolean(runId)
	if (!showHud) return null
	const selectScreen = (screen: HudScreen) => dispatch({ type: "screen_selected", screen })
	// Intro entrance classes must not leak into the run view: their finished
	// fill-mode:both animations hold opacity/background at animation priority,
	// which would override the agent-hud--hidden dismissal styles.
	const hudBoxClassName = `agent-hud__box${
		presentation.headerVariant === "landing"
			? " agent-hud__box--landing"
			: ""
	}${enteredViaIntro && isLanding ? " agent-hud__box--intro" : ""}${
		!isLanding && isRunInactive ? " agent-hud__box--inactive" : ""
	}`

	const hudClassName = [
		"agent-hud",
		isLanding ? "agent-hud--landing" : "",
		enteredViaIntro && isLanding ? "agent-hud--intro" : "",
		!isLanding ? "agent-hud--fade" : "",
		!isLanding && !isOpen ? "agent-hud--hidden" : "",
	]
		.filter(Boolean)
		.join(" ")
	return (
		<>
			{showPanel ? (
				<div
					className={hudClassName}
					aria-live="polite">
					<ResizableHudBox
						className={hudBoxClassName}
						inert={!isLanding && !isOpen}>
						<HudCornerControls
							disabled={!presentation.enableCornerControls}
							layout={{
								mode: layoutMode,
								onMove: (direction) =>
									setLayoutMode((mode) =>
										moveLayoutMode(mode, direction),
									),
								onMinimize: dismiss,
							}}
						/>
						{presentation.showProjectBadge ? (
							<HudProjectBadge projectSlug={projectSlug} />
						) : null}
						{isLanding || isOpen ? (
							<HudHeader
								presentation={presentation}
								runId={runId}
								modelSelectionPromise={visibleModelSelectionPromise}
								onSelectScreen={selectScreen}
							/>
						) : null}
						<HudScreenContent
							projectsVisible={isLanding || isOpen}
							navigation={navigation}
							dispatch={dispatch}
							onLaunch={launchProject}
							presentation={presentation}
							runId={runId}
							replyDraft={replyDraft}
							onReplyDraftChange={setReplyDraft}
							initialProjects={initialProjects}
							layoutMode={layoutMode}
							onReturnToRun={() => selectScreen("run")}
						/>
					</ResizableHudBox>
				</div>
			) : null}
			{showPanel && !isLanding ? (
				<MinimizedHudControl
					visible={!isOpen}
					agentActivityState={minimizedAgentActivityState}
					onExpand={() =>
						hudVisibilityStore.setState({ open: true })
					}
				/>
			) : null}
		</>
	)
}
