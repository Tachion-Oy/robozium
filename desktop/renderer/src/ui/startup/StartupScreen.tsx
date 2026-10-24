// Copied from robozium-electron/desktop/web/startup/StartupScreen.tsx at 076b2c9.
// Adapted: it covers the application in the same document instead of a separate
// native view, so its state arrives as props from BackendStartup rather than over
// the launcher bridge, and its failure carries the startup's own actions. Reduced
// motion requested during the introduction settles it, as #101's splash did. The
// status shows the startup step, since a first launch can take minutes.
import { useEffect, useState, type ReactNode } from "react"
import { AgentActivityState } from "../run/run-view"
import { MinimizedHudFrame } from "../hud/MinimizedHudFrame"
import { TerminalBackdrop } from "../terminal/TerminalBackdrop"
import { IntroStream, PlaceholderLog } from "../terminal/demo/DemoLog"
import type { StartupScreenMode } from "../../backend/useStartupScreen"
import "./startup.css"

/** Why startup stopped, and the controls that continue it. */
export interface StartupFailure {
	message: string
	actions: ReactNode
}

export interface StartupScreenProps {
	/** "intro" plays the launch animation; "loading" shows the loading HUD at once, as during a restart. */
	mode: StartupScreenMode
	/** The backend is ready and the application beneath has painted. */
	ready: boolean
	/** Announced progress, such as the backend's startup step. */
	status: string
	failure: StartupFailure | null
	/** The screen has faded out; the owner removes it. */
	onFaded: () => void
}

// Equal sides and 135-degree interior angles; the cut is 100 / (2 + sqrt(2)).
const octagonPoints = "29.289322,0 70.710678,0 100,29.289322 100,70.710678 70.710678,100 29.289322,100 0,70.710678 0,29.289322"
// Removes the screen if its fade never reports an end, as the experiment's main process did.
const FADE_FALLBACK_MS = 1000
const reduceMotion = "(prefers-reduced-motion: reduce)"

/** Local presentation runs independently of Docker and the application's data. */
export function StartupScreen({ mode, ready, status, failure, onFaded }: StartupScreenProps): ReactNode {
	const skipIntro = mode === "loading"
	const [reducedMotion, setReducedMotion] = useState(() => matchMedia(reduceMotion).matches)
	const [introDone, setIntroDone] = useState(skipIntro || reducedMotion)
	const [loadingStarted, setLoadingStarted] = useState(skipIntro || reducedMotion)
	const revealing = introDone && ready
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
					className={`agent-hud agent-hud--landing startup__hud${skipIntro ? "" : " startup__hud--enter"}${failure ? " startup__hud--failed" : ""}`}>
					<div className="agent-hud__box">
						<div className="startup__loading">
							<MinimizedHudFrame
								agentActivityState={AgentActivityState.Working}
								heading={<p className="startup__label" role="status"><span className="startup__loading-art" aria-hidden="true" />{/* A failure shows its message below instead. */}<span className={failure ? "sr-only" : "startup__status"}>{status}</span></p>}>
								<svg className="startup__outline" viewBox="0 0 100 100" aria-hidden="true">
									<polygon points={octagonPoints} strokeWidth="1" vectorEffect="non-scaling-stroke" />
									<polygon points={octagonPoints} transform="translate(1.5 1.5) scale(0.97)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
								</svg>
							</MinimizedHudFrame>
						</div>
						{failure && (
							<div className="startup__failure">
								<p role="alert">{failure.message}</p>
								{failure.actions}
							</div>
						)}
					</div>
				</div>
			)}
		</main>
	)
}
