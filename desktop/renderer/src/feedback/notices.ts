// Notifications any owner can raise; the viewport owns presentation and hover.
// Problems and statuses never take space in the layout: they are toasts, and a
// toast that needs an answer carries its own actions and stays until it is resolved
// or dismissed.
import { useEffect, useRef, useSyncExternalStore } from "react"

export type NotificationTone = "info" | "error" | "warning" | "success"

export interface NoticeAction {
	label: string
	onClick: () => void
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
	/** Set on a toast owned by usePersistentToast: it never times out. */
	owner?: string
	/** The owner's options when shown; a dismissal holds until they change. */
	signature?: string
}

interface Lifetime {
	remaining: number
	startedAt: number
	timer?: ReturnType<typeof setTimeout>
}

const NOTICE_DURATION_MS = 5000
const REMOVE_DELAY_MS = 250
let notices: readonly Notice[] = []
let nextId = 0
let paused = false
/** Owned toasts the user dismissed, by owner, with the options they dismissed. */
const dismissedOwners = new Map<string, string>()
const lifetimes = new Map<number, Lifetime>()
const listeners = new Set<() => void>()

function publish(next: readonly Notice[]): void {
	notices = next
	if (notices.length === 0) paused = false
	for (const listener of listeners) listener()
}

function forget(id: number): void {
	clearTimeout(lifetimes.get(id)?.timer)
	lifetimes.delete(id)
}

function schedule(id: number, lifetime: Lifetime): void {
	lifetime.startedAt = Date.now()
	lifetime.timer = setTimeout(() => dismiss(id), lifetime.remaining)
}

export function dismiss(id: number): void {
	const notice = notices.find(notice => notice.id === id && notice.visible)
	if (!notice) return
	if (notice.owner && notice.signature) dismissedOwners.set(notice.owner, notice.signature)
	forget(id)
	publish(notices.map(notice => notice.id === id ? { ...notice, visible: false } : notice))
	const timer = setTimeout(() => {
		forget(id)
		publish(notices.filter(notice => notice.id !== id))
	}, REMOVE_DELAY_MS)
	lifetimes.set(id, { remaining: 0, startedAt: 0, timer })
}

export function pause(): void {
	if (paused) return
	paused = true
	for (const notice of notices) {
		const lifetime = lifetimes.get(notice.id)
		if (!notice.visible || !lifetime) continue
		clearTimeout(lifetime.timer)
		lifetime.remaining = Math.max(0, lifetime.remaining - (Date.now() - lifetime.startedAt))
	}
}

export function resume(): void {
	if (!paused) return
	paused = false
	for (const notice of notices) {
		const lifetime = lifetimes.get(notice.id)
		if (notice.visible && lifetime) schedule(notice.id, lifetime)
	}
}

export function showErrorToast(options: ShowErrorToastOptions): number {
	return showNotificationToast({ ...options, tone: "error" })
}

export function showNotificationToast(options: ShowNotificationToastOptions): number {
	const id = ++nextId
	// A repeated title replaces its earlier notice and gets a fresh lifetime.
	// A persistent toast stays until its owner clears it.
	const replaced = (notice: Notice) => !notice.owner && notice.title === options.title
	for (const notice of notices) if (replaced(notice)) forget(notice.id)
	const lifetime = { remaining: NOTICE_DURATION_MS, startedAt: Date.now() }
	lifetimes.set(id, lifetime)
	if (!paused) schedule(id, lifetime)
	publish([...notices.filter(notice => !replaced(notice)), { ...options, id, visible: true }])
	return id
}

/** Show or update the toast owned by `key`, in place, with no lifetime, unless dismissed as it is. */
function showPersistent(key: string, options: PersistentToastOptions, signature: string): void {
	if (dismissedOwners.get(key) === signature) return
	dismissedOwners.delete(key)
	const current = notices.find(notice => notice.owner === key && notice.visible)
	if (current) {
		publish(notices.map(notice => notice === current ? { ...options, owner: key, signature, id: current.id, visible: true } : notice))
		return
	}
	// A timed toast with the same title gives way, as between timed toasts.
	for (const notice of notices) if (notice.title === options.title && !notice.owner) forget(notice.id)
	publish([...notices.filter(notice => notice.owner || notice.title !== options.title), { ...options, owner: key, signature, id: ++nextId, visible: true }])
}

/** The problem is gone, or its owner left: a later one shows again even if this was dismissed. */
function removePersistent(key: string): void {
	const current = notices.find(notice => notice.owner === key && notice.visible)
	if (current) dismiss(current.id)
	dismissedOwners.delete(key)
}

/**
 * Keep a toast up while `options` is set, update it as they change, and remove it
 * once they clear or the owner unmounts. Actions always call the latest handlers.
 */
export function usePersistentToast(key: string, options: PersistentToastOptions | null): void {
	const latest = useRef(options)
	useEffect(() => { latest.current = options })
	const signature = options && JSON.stringify({ ...options, actions: options.actions?.map(action => [action.label, action.disabled]) })
	useEffect(() => {
		const current = latest.current
		if (!current || !signature) { removePersistent(key); return }
		showPersistent(key, {
			...current,
			actions: current.actions?.map((action, index) => ({
				label: action.label,
				disabled: action.disabled,
				onClick: () => latest.current?.actions?.[index]?.onClick(),
			})),
		}, signature)
	}, [key, signature])
	useEffect(() => () => removePersistent(key), [key])
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => { listeners.delete(listener) }
}

export function useNotices(): readonly Notice[] {
	return useSyncExternalStore(subscribe, () => notices)
}
