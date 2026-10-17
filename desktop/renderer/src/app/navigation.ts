// Application destinations shared by navigation and placeholder views.
export const viewOptions = [
	{ value: "projects", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
	{ value: "environment", label: "Environment" },
] as const

export const runViewOptions = [{ value: "run", label: "Current Run" }, ...viewOptions] as const

export type AppView = typeof runViewOptions[number]["value"]
