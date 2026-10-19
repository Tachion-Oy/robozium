// Copied from web/app/components/hud/run/AudioLevelMeter.tsx at 86ef5c1.
const AUDIO_LEVEL_SEGMENTS = 6

type AudioLevelMeterProps = {
	level: number
}

export function AudioLevelMeter({ level }: AudioLevelMeterProps) {
	const normalizedLevel = Number.isFinite(level)
		? Math.min(1, Math.max(0, level))
		: 0
	const activeSegments = Math.ceil(normalizedLevel * AUDIO_LEVEL_SEGMENTS)

	return (
		<span
			className="agent-hud__dictate-meter"
			data-silent={activeSegments === 0 || undefined}
			aria-hidden="true">
			{Array.from({ length: AUDIO_LEVEL_SEGMENTS }, (_, index) => (
				<span
					key={index}
					className="agent-hud__dictate-meter-segment"
					data-active={index < activeSegments || undefined}
				/>
			))}
		</span>
	)
}
