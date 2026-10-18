// Standalone preview data. Connected operation gets models and messages from feature state.
export const modelOptions = [
	{ value: "mock", label: "Mock model" },
	{ value: "mock-fast", label: "Mock fast model" },
	{ value: "mock-extended", label: "Mock extended context model" },
] as const

export const mockMessages = [
	`Mock run created.

This local preview has three messages to explore.
Use the history arrows to move through them.`,
	`Planning the next steps.

Start with the outcome, then list the constraints.
Your reply stays available while you browse earlier messages.`,
	`Mock run ready.

I can help you plan a task and review the next steps.

Describe what you want to accomplish in the reply below.
Include any constraints or details that matter to you.

You can move the panel divider to give the message or your draft more room.
Your draft stays here while you explore the other views.

This preview keeps replies on this device; they are not sent.`
]
