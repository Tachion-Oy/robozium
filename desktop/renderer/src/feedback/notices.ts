// Notifications any owner can raise; the viewport owns presentation and hover.
// Problems and statuses never take space in the layout: they are toasts. A timed toast
// leaves after its lifetime. An owned toast stays while its owner keeps it, carries the
// owner's actions, and once dismissed stays hidden until its content changes.
import { useSyncExternalStore } from "react"

export type NotificationTone = "info" | "error" | "warning" | "success"

export interface NoticeAction {
	label: string
	onClick: () => unknown
	disabled?: boolean
}

export interface ShowErrorToastOptions {
	title?: string
	message: string
	detail?: string | null
}

export interface ShowNotificationToastOptions extends ShowErrorToastOptions { tone: NotificationTone }

export interface PersistentToastOptions extends ShowNotificationToastOptions {
	/** Buttons beside the message, such as Retry; Dismiss stays, so a toast never traps the HUD. */
	actions?: readonly NoticeAction[]
}

export interface Notice extends PersistentToastOptions {
	id: number
	visible: boolean
}

const LIFETIME_MS = 5000
const EXIT_MS = 250

interface Toast {
	key: string
	id: number
	options: PersistentToastOptions
	owned: boolean
	/** Dismissed toasts are kept, hidden, so their owner cannot raise them again unchanged. */
	state: "shown" | "dismissed" | "removed"
	/** Still playing its exit animation. */
	exiting: boolean
	timer?: ReturnType<typeof setTimeout>
	/** A timed toast's lifetime left when its timer last started, and when that was. */
	remaining: number
	startedAt: number
}

/** Toasts in stacking order, keyed by title when timed and by owner when owned. */
const toasts = new Map<string, Toast>()
const listeners = new Set<() => void>()
let notices: readonly Notice[] = []
let nextId = 0
let paused = false

const timedKey = (title: string | undefined) => `timed:${title ?? ""}`
const ownedKey = (owner: string) => `owned:${owner}`

function toNotice(toast: Toast): Notice {
	const { actions, ...content } = toast.options
	return {
		...content,
		id: toast.id,
		visible: toast.state === "shown",
		// Actions call the owner's latest handlers, which change without a visible update.
		actions: actions?.map(({ label, disabled }, index) => ({
			label,
			disabled,
			onClick: () => toast.options.actions?.[index]?.onClick(),
		})),
	}
}

function publish(): void {
	notices = [...toasts.values()].filter(toast => toast.state === "shown" || toast.exiting).map(toNotice)
	if (notices.length === 0) paused = false
	for (const listener of listeners) listener()
}

function startLifetime(toast: Toast): void {
	toast.startedAt = Date.now()
	toast.timer = setTimeout(() => leave(toast, "removed"), toast.remaining)
}

function leave(toast: Toast, state: "dismissed" | "removed"): void {
	clearTimeout(toast.timer)
	toast.state = state
	toast.exiting = true
	toast.timer = setTimeout(() => {
		toast.exiting = false
		if (state === "removed" && toasts.get(toast.key) === toast) toasts.delete(toast.key)
		publish()
	}, EXIT_MS)
	publish()
}

function discard(toast: Toast | undefined): void {
	if (!toast) return
	clearTimeout(toast.timer)
	toasts.delete(toast.key)
}

function sameContent(a: PersistentToastOptions, b: PersistentToastOptions): boolean {
	const actions = a.actions ?? []
	const others = b.actions ?? []
	return a.tone === b.tone && a.title === b.title && a.message === b.message && (a.detail ?? null) === (b.detail ?? null)
		&& actions.length === others.length
		&& actions.every((action, index) => action.label === others[index].label && Boolean(action.disabled) === Boolean(others[index].disabled))
}

export function showErrorToast(options: ShowErrorToastOptions): void {
	showNotificationToast({ ...options, tone: "error" })
}

/** Show a timed toast; one with the same title takes the earlier one's place with a fresh lifetime. */
export function showNotificationToast(options: ShowNotificationToastOptions): void {
	const key = timedKey(options.title)
	discard(toasts.get(key))
	const toast: Toast = { key, id: ++nextId, options, owned: false, state: "shown", exiting: false, remaining: LIFETIME_MS, startedAt: 0 }
	toasts.set(key, toast)
	if (!paused) startLifetime(toast)
	publish()
}

/** Show or update the toast `owner` holds; unchanged content stays dismissed if the user dismissed it. */
export function holdToast(owner: string, options: PersistentToastOptions): void {
	const toast = toasts.get(ownedKey(owner))
	if (toast && toast.state !== "removed" && sameContent(toast.options, options)) {
		toast.options = options
		return
	}
	// A timed toast with the same title gives way.
	discard(toasts.get(timedKey(options.title)))
	if (toast) {
		clearTimeout(toast.timer)
		Object.assign(toast, { options, state: "shown", exiting: false })
	} else {
		toasts.set(ownedKey(owner), {
			key: ownedKey(owner), id: ++nextId, options, owned: true, state: "shown", exiting: false, remaining: 0, startedAt: 0,
		})
	}
	publish()
}

/** The owner no longer needs its toast; a later hold shows it again even if it was dismissed. */
export function releaseToast(owner: string): void {
	const toast = toasts.get(ownedKey(owner))
	if (!toast || toast.state === "removed") return
	if (toast.state === "shown") leave(toast, "removed")
	else {
		discard(toast)
		publish()
	}
}

export function dismiss(id: number): void {
	const toast = [...toasts.values()].find(toast => toast.id === id && toast.state === "shown")
	if (toast) leave(toast, toast.owned ? "dismissed" : "removed")
}

const timedShown = () => [...toasts.values()].filter(toast => !toast.owned && toast.state === "shown")

/** Hovering the toasts holds every timed toast's remaining lifetime. */
export function pause(): void {
	if (paused) return
	paused = true
	for (const toast of timedShown()) {
		clearTimeout(toast.timer)
		toast.remaining = Math.max(0, toast.remaining - (Date.now() - toast.startedAt))
	}
}

export function resume(): void {
	if (!paused) return
	paused = false
	for (const toast of timedShown()) startLifetime(toast)
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => { listeners.delete(listener) }
}

export function useNotices(): readonly Notice[] {
	return useSyncExternalStore(subscribe, () => notices)
}
