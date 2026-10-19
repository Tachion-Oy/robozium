import "./view-placeholder.css"

export function ViewPlaceholder({ title }: { title: string }) {
	return (
		<section className="view-placeholder" aria-labelledby="view-heading">
			<h2 id="view-heading">{title}</h2>
			<p>This view is coming soon.</p>
		</section>
	)
}
