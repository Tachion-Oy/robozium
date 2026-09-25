"use client"

import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import type { ModelSelection, Project, RunView } from "@/lib/robozium/wire"
import { useRunNotifications } from "@/hooks/useRunNotifications"
import {
	RunSessionProvider,
	useRunSessionSelector,
} from "@/hooks/useRunSession"
import { shouldExitRunView } from "@/lib/robozium/session/reducer"
import { TerminalFrame } from "@/app/components/terminal/TerminalFrame"
import { TerminalRunView } from "@/app/components/terminal/TerminalRunView"
import { AgentHUD } from "./hud/AgentHUD"

type AppViewProps = {
	runId: string | null
	error: string | null
	from: string | null
	/** Server-fetched run view, so the run paints populated on first render. */
	initialRunView?: RunView | null
	/** Server-fetched project list, same idea for the landing table. */
	initialProjects?: Project[] | null
	/** Started by the server before route data is resolved and streamed here. */
	modelSelectionPromise: Promise<ModelSelection | null>
	/** Global default used when a completed or unavailable run returns to the matrix. */
	defaultModelSelectionPromise?: Promise<ModelSelection | null> | null
}

let landingIntroSeenInClientRuntime = false

/** The whole "/" route: the landing panel when idle, or an active run. */
export function AppView({
	runId,
	error,
	from,
	initialRunView = null,
	initialProjects = null,
	modelSelectionPromise,
	defaultModelSelectionPromise = null,
}: AppViewProps) {
	const [isFreshLanding] = useState(
		() =>
			runId === null &&
			from !== "app" &&
			!landingIntroSeenInClientRuntime,
	)
	const [introDone, setIntroDone] = useState(!isFreshLanding)
	const playIntro = isFreshLanding && !introDone
	const [hasEverHadRun, setHasEverHadRun] = useState(false)
	if (!hasEverHadRun && runId) setHasEverHadRun(true)

	useEffect(() => {
		// Only the first page load in this client runtime can play the intro.
		// A direct run load counts too, so returning to landing skips it.
		landingIntroSeenInClientRuntime = true
		// A fresh server seed also commits navigation back to the same run ID.
		hudVisibilityStore.setState({ navigationPending: false })
	}, [runId, initialRunView])

	return (
		<RunSessionProvider
			runId={runId}
			initialRunView={initialRunView}>
			<AppViewContent
				runId={runId}
				error={error}
				introDone={introDone}
				playIntro={playIntro}
				onIntroDone={() => setIntroDone(true)}
				initialProjects={initialProjects}
				fadeInPlaceholder={hasEverHadRun}
				modelSelectionPromise={modelSelectionPromise}
				defaultModelSelectionPromise={defaultModelSelectionPromise}
			/>
		</RunSessionProvider>
	)
}

type AppViewContentProps = {
	runId: string | null
	error: string | null
	introDone: boolean
	playIntro: boolean
	onIntroDone: () => void
	initialProjects: Project[] | null
	fadeInPlaceholder: boolean
	modelSelectionPromise: Promise<ModelSelection | null> | null
	defaultModelSelectionPromise: Promise<ModelSelection | null> | null
}

function AppViewContent({
	runId,
	error,
	introDone,
	playIntro,
	onIntroDone,
	initialProjects,
	fadeInPlaceholder,
	modelSelectionPromise,
	defaultModelSelectionPromise,
}: AppViewContentProps) {
	useRunNotifications()
	const navigationPending = useStore(
		hudVisibilityStore,
		(state) => state.navigationPending,
	)
	const shouldReturnHome = useRunSessionSelector(shouldExitRunView, false)

	useEffect(() => {
		if (!runId || !shouldReturnHome || navigationPending) return
		// Keep the stopped session and mounted panels; a route fetch would reset
		// their state. Defer during user navigation because Next history updates
		// can interrupt it, and only replace a URL that still belongs to this run.
		if (new URL(window.location.href).searchParams.get("runId") !== runId) return
		window.history.replaceState(null, "", "/")
	}, [runId, shouldReturnHome, navigationPending])

	return (
		<>
			<TerminalFrame>
				<TerminalRunView
					runId={runId}
					error={error}
					playIntro={playIntro}
					onIntroDone={onIntroDone}
					fadeInPlaceholder={fadeInPlaceholder}
				/>
			</TerminalFrame>
			<AgentHUD
				runId={runId}
				introDone={introDone}
				initialProjects={initialProjects}
				modelSelectionPromise={modelSelectionPromise}
				defaultModelSelectionPromise={defaultModelSelectionPromise}
			/>
		</>
	)
}
