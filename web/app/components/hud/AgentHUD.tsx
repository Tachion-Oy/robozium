"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useStore } from "zustand"
import {
	agentActivityStateForPhase,
	hasPermanentRunFailure,
	RunHudPhase,
} from "@/lib/robozium/session/reducer"
import type { ModelSelection, Project } from "@/lib/robozium/wire"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import { setHudSizeProgress } from "@/lib/robozium/hud-size"
import { useHudEscapeDismiss } from "@/hooks/useHudEscapeDismiss"
import { useRunSessionSelector } from "@/hooks/useRunSession"
import {
	HudCornerControls,
	type LayoutMode,
	moveLayoutMode,
} from "./HudCornerControls"
import { HudHeader } from "./HudHeader"
import { HudProjectBadge } from "./HudProjectBadge"
import {
	DEFAULT_HUD_SCREEN_SELECTIONS,
	resolveHudPresentation,
	selectHudScreen,
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
	const [screenSelections, setScreenSelections] = useState(
		DEFAULT_HUD_SCREEN_SELECTIONS,
	)
	const [replyDraft, setReplyDraft] = useState("")
	const [prevRunId, setPrevRunId] = useState(runId)
	if (runId !== prevRunId) {
		setPrevRunId(runId)
		setLayoutMode("top")
		setScreenSelections(DEFAULT_HUD_SCREEN_SELECTIONS)
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
		selections: screenSelections,
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
		if (isRecovery) hudVisibilityStore.setState({ open: true })
	}, [isRecovery])

	// Apply the route/recovery size default before paint. User-selected screens are
	// deliberately absent from these dependencies so checking Runs Overview from
	// a live run preserves the current size.
	useLayoutEffect(() => {
		setHudSizeProgress(runId && !isRecovery ? 1 : 0)
	}, [isRecovery, runId])

	useEffect(() => {
		hudVisibilityStore.setState({
			runActive: !isLanding,
			prompting: phase === RunHudPhase.Prompting,
		})
	}, [isLanding, phase])

	// Reset only on unmount. Clearing inside the phase effect's cleanup would
	// briefly publish runActive=false on every phase change and unlock the log.
	useEffect(() => {
		return () =>
			hudVisibilityStore.setState({ runActive: false, prompting: false })
	}, [])

	useHudEscapeDismiss(
		() => hudVisibilityStore.setState({ open: false }),
		!isLanding && isOpen && showPanel,
	)

	const showHud = isLanding || Boolean(runId)
	if (!showHud) return null
	const selectScreen = (screen: typeof presentation.screen) =>
		setScreenSelections((current) =>
			selectHudScreen(current, context, screen),
		)
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
								onMinimize: () =>
									hudVisibilityStore.setState({ open: false }),
							}}
						/>
						{presentation.showProjectBadge ? (
							<HudProjectBadge projectSlug={projectSlug} />
						) : null}
						{isLanding || isRecovery || isOpen ? (
							<HudHeader
								presentation={presentation}
								runId={runId}
								modelSelectionPromise={visibleModelSelectionPromise}
								onSelectScreen={selectScreen}
							/>
						) : null}
						<HudScreenContent
							presentation={presentation}
							runId={runId}
							replyDraft={replyDraft}
							onReplyDraftChange={setReplyDraft}
							projectSlug={projectSlug}
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
