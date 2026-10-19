// Run view types the reference imports from the web session store.

export const AgentActivityState = {
	Working: "working",
	AwaitingInput: "awaiting-input",
} as const
export type AgentActivityState = typeof AgentActivityState[keyof typeof AgentActivityState]

export type HudMessageNavigationDirection = "first" | "previous" | "next" | "latest"
