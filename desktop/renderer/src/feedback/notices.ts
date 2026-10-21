// Notifications any owner can raise; the viewport owns presentation and hover.
import { useSyncExternalStore } from "react"

export type NotificationTone = "error" | "warning" | "success"

export interface ShowErrorToastOptions {
	title?: string
	message: string
	detail?: string | null
}

export interface ShowNotificationToastOptions extends ShowErrorToastOptions { tone: NotificationTone }
export interface Notice extends ShowNotificationToastOptions { id: number; visible: boolean }

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
	if (!notices.some(notice => notice.id === id && notice.visible)) return
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
	for (const notice of notices) if (notice.title === options.title) forget(notice.id)
	const lifetime = { remaining: NOTICE_DURATION_MS, startedAt: Date.now() }
	lifetimes.set(id, lifetime)
	if (!paused) schedule(id, lifetime)
	publish([...notices.filter(notice => notice.title !== options.title), { ...options, id, visible: true }])
	return id
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	return () => { listeners.delete(listener) }
}

export function useNotices(): readonly Notice[] {
	return useSyncExternalStore(subscribe, () => notices)
}
