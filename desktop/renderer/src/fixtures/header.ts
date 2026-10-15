export const modelOptions = [
	{ value: "mock", label: "Mock model" },
	{ value: "mock-fast", label: "Mock fast model" },
	{ value: "mock-extended", label: "Mock extended context model" },
] as const

export const viewOptions = [
	{ value: "projects", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
	{ value: "environment", label: "Environment" },
] as const

export const runViewOptions = [{ value: "run", label: "Current Run" }, ...viewOptions] as const

export type ModelId = typeof modelOptions[number]["value"]
export type HudView = typeof runViewOptions[number]["value"]
