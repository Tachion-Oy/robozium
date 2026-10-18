import { viewOptions, type AppView } from "../../app/navigation"
import "./view-placeholder.css"

export function ViewPlaceholder({ view }: { view: Exclude<AppView, "run"> }) {
	return (
		<section className="view-placeholder" aria-labelledby="view-heading">
			<h2 id="view-heading">{viewOptions.find(option => option.value === view)!.label}</h2>
			<p>This view is coming soon.</p>
		</section>
	)
}
