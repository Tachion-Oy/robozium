import { Fragment } from "react"

// A model label with its speed tier drawn as an icon beside the name: "GLM-5.3 · Fast ·
// OpenRouter" shows a lightning bolt for Fast and a brain for Deep reasoning. The tier's
// name stays the icon's accessible name and tooltip. Icon paths adapted from Lucide (ISC).
const tiers: Record<string, string[]> = {
	Fast: [
		"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
	],
	"Deep reasoning": [
		"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
		"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
		"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
		"M17.599 6.5a3 3 0 0 0 .399-1.375",
		"M6.003 5.125A3 3 0 0 0 6.401 6.5",
		"M3.477 10.896a4 4 0 0 1 .585-.396",
		"M19.938 10.5a4 4 0 0 1 .585.396",
		"M6 18a4 4 0 0 1-1.967-.516",
		"M19.967 17.484A4 4 0 0 1 18 18",
	],
}

const separator = " · "

export function ModelLabel({ label }: { label: string }) {
	const parts = label.split(separator)
	return parts.map((part, index) => {
		const paths = tiers[part]
		return (
			<Fragment key={index}>
				{index ? (paths ? " " : separator) : null}
				{paths ? (
					<svg
						className="agent-hud__model-tier"
						viewBox="0 0 24 24"
						role="img"
						aria-label={part}>
						<title>{part}</title>
						{paths.map(path => <path key={path} d={path} />)}
					</svg>
				) : part}
			</Fragment>
		)
	})
}
