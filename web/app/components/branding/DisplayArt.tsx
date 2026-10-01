type DisplayArtName =
	| "robozium"
	| "start"
	| "new-project"
	| "create-project"
	| "cancel"
	| "check-now"
	| "checking"

const labels: Record<DisplayArtName, string> = {
	robozium: "ROBOZIUM",
	start: "START",
	"new-project": "New Project",
	"create-project": "Create Project",
	cancel: "Cancel",
	"check-now": "Check Now",
	checking: "Checking…",
}

export function DisplayArt({
	name,
	label = labels[name],
	decorative = false,
}: {
	name: DisplayArtName
	label?: string
	decorative?: boolean
}) {
	return (
		<>
			<span className={`display-art display-art--${name}`} aria-hidden="true" />
			{!decorative && <span className="sr-only">{label}</span>}
		</>
	)
}
