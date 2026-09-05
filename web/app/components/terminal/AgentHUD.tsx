"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useStore } from "zustand"
import {
	agentActivityStateForPhase,
	hasPermanentRunFailure,
	RunHudPhase,
} from "@/lib/robosprawl/session/reducer"
import type { ModelSelection, Project } from "@/lib/robosprawl/wire"
import { hudVisibilityStore } from "@/lib/robosprawl/hud-visibility"
import { setHudSizeProgress } from "@/lib/robosprawl/hud-size"
import { useHudEscapeDismiss } from "@/hooks/useHudEscapeDismiss"
import { useRunSessionSelector } from "@/hooks/useRunSession"
import {
	HudCornerControls,
	type LayoutMode,
	moveLayoutMode,
} from "./HudControls"
import { AgentHudHeader } from "./AgentHudHeader"
import { AgentHudProjectBadge } from "./AgentHudProjectBadge"
import {
	AgentHudView,
	type HudView,
	type RecoveryView,
} from "./AgentHudView"
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
	const [hudView, setHudView] = useState<HudView>("main")
	const [recoveryView, setRecoveryView] = useState<RecoveryView>("agents")
	const [replyDraft, setReplyDraft] = useState("")
	const [prevRunId, setPrevRunId] = useState(runId)
	if (runId !== prevRunId) {
		setPrevRunId(runId)
		setLayoutMode("top")
		setHudView("main")
		setRecoveryView("agents")
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

	const isLanding = !runId
	const isRecovery =
		!isLanding && (phase === RunHudPhase.Done || runUnavailable)
	const visibleHudView = isRecovery ? recoveryView : hudView
	const visibleModelSelectionPromise = isRecovery
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

	// Apply the route/recovery size default before paint. User-selected views are
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
	const applyHudView = (view: HudView) => {
		if (isRecovery) {
			if (view !== "main") setRecoveryView(view)
			return
		}
		if (isLanding && view === "agents") return
		setHudView(view)
	}
	const selectHudView = (view: HudView) => {
		applyHudView(view)
	}
	// Intro entrance classes must not leak into the run view: their finished
	// fill-mode:both animations hold opacity/background at animation priority,
	// which would override the agent-hud--hidden dismissal styles.
	const hudBoxClassName = `agent-hud__box${
		isLanding && visibleHudView === "main"
			? " agent-hud__box--landing"
			: ""
	}${enteredViaIntro && isLanding ? " agent-hud__box--intro" : ""}${
		!isLanding && isRunInactive ? " agent-hud__box--inactive" : ""
	}`

	const hudClassName = [
		"agent-hud",
		enteredViaIntro && isLanding ? "agent-hud--intro" : "",
		!isLanding ? "agent-hud--fade" : "",
		!isLanding && !isOpen ? "agent-hud--hidden" : "",
	]
		.filter(Boolean)
		.join(" ")
	const sideControlsActive =
		!isLanding && !isRecovery && visibleHudView === "main"

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
							disabled={!sideControlsActive}
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
						{!isLanding && !isRecovery ? (
							<AgentHudProjectBadge projectSlug={projectSlug} />
						) : null}
						{isLanding || isRecovery || isOpen ? (
							<AgentHudHeader
								view={visibleHudView}
								isLanding={isLanding}
								isRecovery={isRecovery}
								runId={runId}
								modelSelectionPromise={visibleModelSelectionPromise}
								onSelectView={selectHudView}
							/>
						) : null}
						<AgentHudView
							view={visibleHudView}
							isLanding={isLanding}
							isRecovery={isRecovery}
							runId={runId}
							replyDraft={replyDraft}
							onReplyDraftChange={setReplyDraft}
							projectSlug={projectSlug}
							initialProjects={initialProjects}
							layoutMode={layoutMode}
							onReturnToRun={() => setHudView("main")}
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
