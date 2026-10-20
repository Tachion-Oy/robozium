// Error notices any owner can raise, with the reference toast call shape. A
// CSP-compatible toaster replaces the presentation later; ui/feedback renders them.
import { useSyncExternalStore } from "react"

export interface ShowErrorToastOptions {
	title?: string
	message: string
	detail?: string | null
}

export interface ShowNotificationToastOptions extends ShowErrorToastOptions { tone: "success" | "error" }

export interface ErrorNotice extends ShowNotificationToastOptions { id: number }

const NOTICE_DURATION_MS = 8000
let notices: readonly ErrorNotice[] = []
let nextId = 0
const listeners = new Set<() => void>()

function publish(next: readonly ErrorNotice[]): void {
	notices = next
	for (const listener of listeners) listener()
}

export function showErrorToast(options: ShowErrorToastOptions): number {
	return showNotificationToast({ ...options, tone: "error" })
}

/** Successes are announced politely; errors are alerts. */
export function showNotificationToast(options: ShowNotificationToastOptions): number {
	const id = ++nextId
	// A repeated failure replaces its earlier notice instead of stacking.
	publish([...notices.filter(notice => notice.title !== options.title), { ...options, id }])
	setTimeout(() => publish(notices.filter(notice => notice.id !== id)), NOTICE_DURATION_MS)
	return id
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => { listeners.delete(listener) }
}

export function useErrorNotices(): readonly ErrorNotice[] {
	return useSyncExternalStore(subscribe, () => notices)
}
