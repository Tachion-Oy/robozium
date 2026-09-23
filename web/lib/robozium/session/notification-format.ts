import type { RuntimeErrorNotification } from "./reducer.types"

export type FormattedNotification = {
	title: string
	message: string
	detail: string | null
	tone: "warning" | "error"
}

const MESSAGE_MAX_LENGTH = 200

/* User-initiated control flow; retained in diagnostics but not shown as an error. */
const NON_TOASTABLE_CONTROL_KINDS = new Set(["cancelled", "interrupted"])

function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

export function formatNotification(
	notification: RuntimeErrorNotification,
): FormattedNotification {
	const endpoint = notification.data?.endpoint
	const model = notification.data?.model
	const detail =
		typeof endpoint === "string" && typeof model === "string"
			? `${endpoint}/${model}`
			: null

	const title =
		notification.category === "llm"
			? "LLM call failed"
			: notification.category === "stream"
				? "Connection problem"
				: `${notification.category} error`

	return {
		title,
		message: truncate(notification.message, MESSAGE_MAX_LENGTH),
		detail,
		tone: notification.level,
	}
}

export function shouldToast(notification: RuntimeErrorNotification): boolean {
	if (NON_TOASTABLE_CONTROL_KINDS.has(notification.kind)) return false
	if (notification.category !== "llm") return true
	const errorKind = notification.data?.error_kind
	if (typeof errorKind !== "string") return true
	return !NON_TOASTABLE_CONTROL_KINDS.has(errorKind)
}
