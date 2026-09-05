/**
 * Opening banner for a new agent run.
 *
 * Layout: a double-bordered info card whose title ("NEW PROCESS") sits on the top
 * border like a fieldset legend, but uses the same inverted role-badge shell
 * as the message gutter (amber fill, cutout label) — not a solid black
 * background break in the frame.
 *
 * Why the card frame is CSS (border) and not ASCII box-drawing chars:
 * VT323 does have box-drawing glyphs, but they don't share the same advance
 * width as its ASCII space, so a row made of `═`s ends up wider than a row
 * made of spaces + `║` -- the right edge drifts and the box skews. CSS
 * `border-style: double` renders the same visual language (two parallel
 * amber strokes) with guaranteed alignment.
 *
 * Color layers (all amber -- hue discipline is what sells the CRT illusion):
 *   - card border / arrow : dim amber, soft halo (structure, not content)
 *   - card title / values : hot white-tinted amber + strong halo (neon)
 *   - field labels        : mid amber, normal phosphor
 *   - card title          : same inverted “role badge” look as the gutter
 *                           (term-msg-badge + label), not a dark cutout
 */

type BannerField = { label: string; value: string }

type TerminalBannerProps = {
	agentName: string
	details: Record<string, string>
	title?: string
	/** When set, field values are progressively revealed up to this many characters. */
	revealChars?: number
}

/** Returns the concatenated text used as a timing reference for typewriter animation. */
export function bannerRevealText(
	agentName: string,
	details: Record<string, string>,
): string {
	return [agentName, ...Object.values(details)].join("\n")
}

function applyReveal(fields: BannerField[], revealChars: number): BannerField[] {
	let remaining = revealChars
	return fields.map((f) => {
		const shown = Math.max(0, Math.min(remaining, f.value.length))
		remaining -= f.value.length + 1
		return { ...f, value: f.value.slice(0, shown) }
	})
}

export function TerminalBanner({
	agentName,
	details,
	title = "NEW PROCESS",
	revealChars,
}: TerminalBannerProps) {
	const allFields: BannerField[] = [
		{ label: "agent", value: agentName },
		...Object.entries(details).map(([label, value]) => ({
			label,
			value,
		})),
	]
	const fields =
		revealChars !== undefined ? applyReveal(allFields, revealChars) : allFields

	return (
		<div
			className="term-banner"
			aria-label={`${title} — agent ${agentName}`}>
			<div className="term-banner-card">
				<div className="term-banner-card-title">
					<span className="term-msg-badge">
						<span className="term-msg-badge-label">{title}</span>
					</span>
				</div>
				<dl className="term-banner-card-body">
					{fields.map((f) => (
						<div
							key={f.label}
							className="term-banner-row">
							<dt className="term-banner-label">{f.label}</dt>
							<span
								className="term-banner-arrow"
								aria-hidden="true">
								▸
							</span>
							<dd className="term-banner-val">{f.value}</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	)
}
