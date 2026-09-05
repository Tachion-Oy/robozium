"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { ModelSelection, Project, RunView } from "@/lib/robosprawl/wire"
import { useRunNotifications } from "@/hooks/useRunNotifications"
import {
	RunSessionProvider,
	useRunSessionSelector,
} from "@/hooks/useRunSession"
import { shouldExitRunView } from "@/lib/robosprawl/session/reducer"
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
		// App Router navigation preserves this client module, so returning home
		// through the app nav skips the already-seen entrance. A real browser
		// refresh reloads the module and restores the fresh-landing intro.
		if (runId === null) landingIntroSeenInClientRuntime = true
	}, [runId])

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
	const router = useRouter()
	const shouldReturnHome = useRunSessionSelector(shouldExitRunView, false)
	const redirectedRunId = useRef<string | null>(null)

	useEffect(() => {
		if (
			!runId ||
			!shouldReturnHome ||
			redirectedRunId.current === runId
		) {
			return
		}
		redirectedRunId.current = runId
		// Replacement keeps Back from reopening a run that the backend may have
		// already discarded. The app marker reuses the established no-boot-intro
		// landing path and is cleaned from the visible URL by AgentHUD.
		router.replace("/?from=app", { scroll: false })
	}, [router, runId, shouldReturnHome])

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
