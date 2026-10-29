// Copied from desktop/renderer/src/ui/run/AudioLevelMeter.tsx at e1dc07f.
// Adapted: the segments show how far a startup that rebuilds the backend has come.
import type { ReactNode } from "react"
import "./startup-progress.css"

const PROGRESS_SEGMENTS = 20

export interface StartupProgressProps {
	/** 0–1 through the startup. */
	fraction: number
	/** The word the loader shows, which names the bar. */
	label: string
}

export function StartupProgress({ fraction, label }: StartupProgressProps): ReactNode {
	const normalizedFraction = Number.isFinite(fraction)
		? Math.min(1, Math.max(0, fraction))
		: 0
	const activeSegments = Math.floor(normalizedFraction * PROGRESS_SEGMENTS)

	return (
		<span
			className="startup__progress"
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(normalizedFraction * 100)}
			data-empty={activeSegments === 0 || undefined}>
			{Array.from({ length: PROGRESS_SEGMENTS }, (_, index) => (
				<span
					key={index}
					className="startup__progress-segment"
					data-active={index < activeSegments || undefined}
				/>
			))}
		</span>
	)
}
