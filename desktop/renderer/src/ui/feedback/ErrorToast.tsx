// Stand-in for the reference's react-hot-toast notifications, whose injected
// inline styles the renderer's CSP blocks. Same call shape; failures render as
// alerts in the notices row until a CSP-compatible toaster replaces this.
import { useSyncExternalStore } from "react"

type ShowErrorToastOptions = {
	title?: string
	message: string
	detail?: string | null
}

type ErrorNotice = ShowErrorToastOptions & { id: number }

const NOTICE_DURATION_MS = 8000
let notices: readonly ErrorNotice[] = []
let nextId = 0
const listeners = new Set<() => void>()

function publish(next: readonly ErrorNotice[]): void {
	notices = next
	for (const listener of listeners) listener()
}

export function showErrorToast(options: ShowErrorToastOptions): number {
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

export function ErrorNotices({ items }: { items: readonly ErrorNotice[] }) {
	return items.map(notice => (
		<p key={notice.id} role="alert">
			{notice.title ? `${notice.title}: ` : ""}{notice.message}{notice.detail ? ` ${notice.detail}` : ""}
		</p>
	))
}
