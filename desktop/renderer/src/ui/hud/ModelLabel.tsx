import { Fragment } from "react"
import type { AvailableModel } from "../../models/models-api"

// A model label with its speed tier and image support drawn as icons beside the name, then
// its prices and provider: "GLM-5.3 · Fast · OpenRouter" shows a lightning bolt for Fast
// (a brain for Deep reasoning), a picture when the model accepts images, then
// "· ($0.07 / $1.40) · OpenRouter". The last part of a label with several parts is the
// provider. Each icon's name stays its accessible name and tooltip. Icon paths adapted
// from Lucide (ISC).
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
const acceptsImages = "Accepts images"
const picture = [
	"M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
	"M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
	"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
]

const separator = " · "

function ModelIcon({ name, paths }: { name: string; paths: string[] }) {
	return (
		<svg className="agent-hud__model-tier" viewBox="0 0 24 24" role="img" aria-label={name}>
			<title>{name}</title>
			{paths.map(path => <path key={path} d={path} />)}
		</svg>
	)
}

/** USD per 1M tokens with at least two decimals: 0.075 is $0.075 and 1.2 is $1.20. */
function formatPrice(price: number) {
	const amount = price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
	return `$${amount}`
}

export function ModelLabel({ model }: { model: AvailableModel }) {
	const parts = model.label.split(separator)
	let leading: string[] = parts
	let provider: string | null = null
	if (parts.length > 1) {
		leading = parts.slice(0, -1)
		provider = parts[parts.length - 1]
	}
	const inputPrice = formatPrice(model.input_price_per_million_tokens)
	const outputPrice = formatPrice(model.output_price_per_million_tokens)
	return (
		<>
			{leading.map((part, index) => {
				const paths = tiers[part]
				return (
					<Fragment key={index}>
						{index ? (paths ? " " : separator) : null}
						{paths ? <ModelIcon name={part} paths={paths} /> : part}
					</Fragment>
				)
			})}
			{model.accepts_images ? <>{" "}<ModelIcon name={acceptsImages} paths={picture} /></> : null}
			{`${separator}(${inputPrice} / ${outputPrice})`}
			{provider ? `${separator}${provider}` : null}
		</>
	)
}
