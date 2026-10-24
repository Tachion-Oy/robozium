import { useCallback, useEffect, useState } from "react"
import type { BackendStatus } from "../lib/desktop"
import { AgentActivityState } from "../lib/robozium/session/reducer.types"
import { HudButton } from "../app/components/hud/HudButton"
import { MinimizedHudFrame } from "../app/components/hud/MinimizedHudFrame"
import { TerminalBackdrop } from "../app/components/terminal/TerminalBackdrop"
import { IntroStream, PlaceholderLog } from "../app/components/terminal/demo/DemoLog"

export interface LauncherBridge {
	status(): Promise<BackendStatus>
	retry(): Promise<void>
	visible(): Promise<void>
	painted(): Promise<void>
	handoff(): Promise<void>
	faded(): Promise<void>
	onReady(callback: () => void): () => void
}

// Equal sides and 135-degree interior angles; the cut is 100 / (2 + sqrt(2)).
const octagonPoints = "29.289322,0 70.710678,0 100,29.289322 100,70.710678 70.710678,100 29.289322,100 0,70.710678 0,29.289322"

declare global {
	interface Window { launcher: LauncherBridge }
}

/** Local presentation runs independently of Docker and the application document. */
export function StartupScreen() {
	const [skipIntro] = useState(() => new URL(location.href).searchParams.get("mode") === "loading")
	const [reducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
	const [introDone, setIntroDone] = useState(skipIntro)
	const [loadingStarted, setLoadingStarted] = useState(skipIntro)
	const [ready, setReady] = useState(false)
	const [failure, setFailure] = useState<string | null>(null)
	const revealing = introDone && ready
	const finishIntro = useCallback(() => {
		setIntroDone(true)
		if (!ready) setLoadingStarted(true)
	}, [ready])

	useEffect(() => window.launcher.onReady(() => setReady(true)), [])

	useEffect(() => {
		let active = true
		const update = async () => {
			try {
				const status = await window.launcher.status()
				if (active) setFailure(status.state === "unavailable" ? status.message : null)
			} catch { /* Closing the view cancels its outstanding IPC. */ }
		}
		void update()
		const timer = window.setInterval(() => { void update() }, 500)
		return () => { active = false; window.clearInterval(timer) }
	}, [])

	useEffect(() => {
		let active = true
		void document.fonts.ready.then(async () => {
			if (!active) return
			await window.launcher.visible()
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
			if (!active) return
			await window.launcher.painted()
			if (reducedMotion) {
				setIntroDone(true)
				setLoadingStarted(true)
			}
		})
		return () => { active = false }
	}, [reducedMotion])

	useEffect(() => {
		if (!revealing) return
		void window.launcher.handoff().then(() => {
			if (reducedMotion) void window.launcher.faded()
		})
	}, [revealing, reducedMotion])

	return (
		<main
			className={`startup${revealing ? " startup--revealing" : ""}`}
			data-stage={revealing ? "handoff" : introDone ? "loading" : "intro"}
			onTransitionEnd={event => {
				if (revealing && event.target === event.currentTarget && event.propertyName === "opacity") void window.launcher.faded()
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
								heading={<p className="startup__label" role="status"><span className="startup__loading-art" aria-hidden="true" /><span className="sr-only">Loading</span></p>}>
								<svg className="startup__outline" viewBox="0 0 100 100" aria-hidden="true">
									<polygon points={octagonPoints} strokeWidth="1" vectorEffect="non-scaling-stroke" />
									<polygon points={octagonPoints} transform="translate(1.5 1.5) scale(0.97)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
								</svg>
							</MinimizedHudFrame>
						</div>
						{failure && (
							<div className="startup__failure">
								<p role="alert">{failure}</p>
								<HudButton onClick={() => { setFailure(null); void window.launcher.retry() }}>Retry</HudButton>
							</div>
						)}
					</div>
				</div>
			)}
		</main>
	)
}
