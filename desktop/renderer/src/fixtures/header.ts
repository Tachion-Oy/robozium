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

export type ModelId = typeof modelOptions[number]["value"]
export type HudView = typeof viewOptions[number]["value"]
