// It covers the application inside the renderer, so its state arrives as
// props from BackendStartup. A failure shows as a toast over it, so the loader never
// moves, and reduced motion requested during the introduction settles it.
import { useEffect, useState, type ReactNode } from "react"
import { AgentActivityState } from "../run/run-view"
import { MinimizedHudFrame } from "../hud/MinimizedHudFrame"
import { TerminalBackdrop } from "../terminal/TerminalBackdrop"
import { IntroStream, PlaceholderLog } from "../terminal/demo/DemoLog"
import type { StartupScreenMode } from "../../backend/useStartupScreen"
import { StartupProgress } from "./StartupProgress"
import "./startup.css"

export interface StartupScreenProps {
	/** "intro" plays the launch animation; "loading" shows the loading HUD at once, as during a restart. */
	mode: StartupScreenMode
	/** The backend is ready and the application beneath has painted. */
	ready: boolean
	/** The startup step, announced to assistive technology; the screen itself shows only the loader. */
	status: string
	/** The backend image is being rebuilt, so the label reads "Updating" rather than "Loading". */
	updating: boolean
	/** 0–1 through a startup that rebuilds the backend; absent when no build runs. */
	progress?: number
	/** The screen has faded out; the owner removes it. */
	onFaded: () => void
}

// Equal sides and 135-degree interior angles; the cut is 100 / (2 + sqrt(2)).
const octagonPoints = "29.289322,0 70.710678,0 100,29.289322 100,70.710678 70.710678,100 29.289322,100 0,70.710678 0,29.289322"
// Removes the screen if its fade never reports an end.
const FADE_FALLBACK_MS = 1000
const reduceMotion = "(prefers-reduced-motion: reduce)"

/** Local presentation runs independently of Docker and the application's data. */
export function StartupScreen({ mode, ready, status, updating, progress, onFaded }: StartupScreenProps): ReactNode {
	const skipIntro = mode === "loading"
	const [reducedMotion, setReducedMotion] = useState(() => matchMedia(reduceMotion).matches)
	const [introDone, setIntroDone] = useState(skipIntro || reducedMotion)
	const [loadingStarted, setLoadingStarted] = useState(skipIntro || reducedMotion)
	const revealing = introDone && ready
	// The bar follows each status until ready, then holds and fills as the screen fades.
	// A status without progress, such as a failure or a retry that builds nothing, clears it.
	const [lastProgress, setLastProgress] = useState<number>()
	if (!ready && progress !== lastProgress) setLastProgress(progress)
	const shownProgress = lastProgress === undefined ? undefined : ready ? 1 : lastProgress
	const finishIntro = () => {
		setIntroDone(true)
		if (!ready) setLoadingStarted(true)
	}

	useEffect(() => {
		// Asking for reduced motion during the introduction settles it at once.
		const query = matchMedia(reduceMotion)
		const change = () => {
			if (!query.matches) return
			setReducedMotion(true)
			setIntroDone(true)
			setLoadingStarted(true)
		}
		query.addEventListener("change", change)
		return () => query.removeEventListener("change", change)
	}, [])

	useEffect(() => {
		if (!revealing) return
		if (reducedMotion) { onFaded(); return }
		const timer = window.setTimeout(onFaded, FADE_FALLBACK_MS)
		return () => window.clearTimeout(timer)
	}, [revealing, reducedMotion, onFaded])

	return (
		<main
			className={`startup${revealing ? " startup--revealing" : ""}`}
			data-stage={revealing ? "handoff" : introDone ? "loading" : "intro"}
			onTransitionEnd={event => {
				if (revealing && event.target === event.currentTarget && event.propertyName === "opacity") onFaded()
			}}>
			<TerminalBackdrop animateTitle={!skipIntro}>
				{skipIntro || reducedMotion ? <PlaceholderLog /> : <IntroStream onIntroDone={finishIntro} />}
			</TerminalBackdrop>
			{loadingStarted && (
				<div
					className={`agent-hud agent-hud--landing startup__hud${skipIntro ? "" : " startup__hud--enter"}`}>
					<div className="agent-hud__box">
						<div className="startup__loading">
							<MinimizedHudFrame
								agentActivityState={AgentActivityState.Working}
								heading={<div className="startup__heading">
									<p className="startup__label" role="status" data-updating={updating || undefined}>
										<span className="startup__loading-art" aria-hidden="true" />
										<span className="startup__updating-art" aria-hidden="true" />
										<span className="sr-only">{status}</span>
									</p>
									{shownProgress !== undefined && <StartupProgress fraction={shownProgress} label={updating ? "Updating" : "Loading"} />}
								</div>}>
								<svg className="startup__outline" viewBox="0 0 100 100" aria-hidden="true">
									<polygon points={octagonPoints} strokeWidth="1" vectorEffect="non-scaling-stroke" />
									<polygon points={octagonPoints} transform="translate(1.5 1.5) scale(0.97)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
								</svg>
							</MinimizedHudFrame>
						</div>
					</div>
				</div>
			)}
		</main>
	)
}
