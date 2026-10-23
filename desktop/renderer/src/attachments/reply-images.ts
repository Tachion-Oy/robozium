// Copied from web/lib/robozium/reply-images.ts at 2a0c183.
// Adapted: requests go through the desktop client under a deadline and end when
// the draft is disposed; restored previews load from the backend origin. Without
// a run (standalone preview) there is nothing to retry.
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { deleteRunAttachments, hubFileUrl, listRunAttachments, uploadRunAttachment, type RunAttachment } from "./attachments-api"

export type ReplyImage = {
	url: string
	name: string
	serverId?: string
	status: "queued" | "uploading" | "ready" | "removing" | "failed"
}

type DraftImage = ReplyImage & {
	file?: File
	discard?: boolean
	uploadId?: string
}

export type ReplyImagesState = {
	images: readonly ReplyImage[]
	error: string | null
	isBusy: boolean
	/** Every image is uploaded and nothing is pending: a reply may be sent. */
	isReady: boolean
	canAdd: boolean
	canRetry: boolean
}

/**
 * The pending images of one run's reply, kept in step with the backend.
 * React observes it through subscribe/getSnapshot; it owns no React state.
 */
export interface ReplyImageDraft {
	subscribe(listener: () => void): () => void
	getSnapshot(): ReplyImagesState
	/** Restore the run's pending images from the backend and accept edits. */
	activate(): void
	/** Abort requests and drop local state; server attachments stay. */
	dispose(): void
	/** Queue uploads; `rejection` explains files refused before upload. */
	add(files: File[], rejection: string | null): void
	onRemove(url: string): void
	onClear(): void
	/** Reload from the backend, then finish failed uploads and removals. */
	onRetry(): void
	/** Send once ready; true only if the backend accepted the reply. */
	submit(send: (hasImages: boolean) => Promise<boolean>): Promise<boolean>
}

// Shared by all drafts: a reopened composer waits for the previous instance's
// in-flight work before GET.
const pendingOperations = new Map<string, Promise<void>>()

/** One queue owns all pending-collection mutations, including reply acceptance. */
export function createReplyImageDraft(client: DesktopApiClient | null, runId: string | null): ReplyImageDraft {
	let requests = new AbortController()
	const call = <T>(operation: (signal: AbortSignal) => Promise<T>) => withDeadline(requests.signal, operation)
	let entries: DraftImage[] = []
	let active = false
	let generation = 0
	let loaded = false
	let needsSync = false
	let clearing = false
	let running = false
	let error: string | null = null
	const queue: Array<() => Promise<void>> = []
	const listeners = new Set<() => void>()
	let snapshot: ReplyImagesState = { images: [], error, isBusy: false, isReady: false, canAdd: false, canRetry: false }
	const current = (version: number) => active && version === generation
	const publish = () => {
		const isBusy = running || queue.length > 0
		snapshot = {
			images: entries.filter((entry) => !entry.discard || entry.status === "failed").map(({ url, name, serverId, status }) => ({ url, name, serverId, status })),
			error, isBusy,
			isReady: active && loaded && !needsSync && !clearing && !isBusy && entries.every((entry) => entry.status === "ready" && !entry.discard),
			canAdd: active && Boolean(client && runId) && !clearing,
			canRetry: active && Boolean(client && runId) && !isBusy && (!loaded || needsSync || clearing || entries.some((entry) => entry.status === "failed")),
		}
		listeners.forEach((listener) => listener())
	}
	const forget = (entry: DraftImage) => {
		if (entry.file) URL.revokeObjectURL(entry.url)
		entries = entries.filter((item) => item !== entry)
	}
	const fail = (cause: unknown) => {
		error = cause instanceof Error ? cause.message : "Could not update images. Retry when connected."
	}
	const drain = async () => {
		if (running) return
		running = true
		const previous = runId ? pendingOperations.get(runId) : undefined
		let finish!: () => void
		const settled = new Promise<void>((resolve) => { finish = resolve })
		if (runId) pendingOperations.set(runId, settled)
		publish()
		try {
			if (previous) await previous
			while (active && queue.length) await queue.shift()!()
		} finally {
			running = false
			if (runId && pendingOperations.get(runId) === settled) pendingOperations.delete(runId)
			finish()
			publish()
		}
	}
	const enqueue = (operation: (version: number) => Promise<void>) => {
		const version = generation
		queue.push(async () => {
			if (!current(version)) return
			try { await operation(version) } catch (cause) {
				if (current(version)) fail(cause)
			}
		})
		void drain()
	}
	const adopt = (attachment: RunAttachment): DraftImage => ({
		name: attachment.name, serverId: attachment.id, status: "ready", discard: clearing,
		url: hubFileUrl(client!, attachment.path),
	})
	const restore = async (version: number) => {
		const pending = await call((signal) => listRunAttachments(client!, runId!, signal))
		if (!current(version)) return
		const ids = new Set(pending.map(({ id }) => id))
		for (const entry of [...entries]) {
			if (entry.serverId && !ids.has(entry.serverId)) forget(entry)
			if (!entry.serverId && entry.uploadId) entry.serverId = pending.find((item) => item.uploadId === entry.uploadId)?.id
			if (entry.serverId && !entry.discard) entry.status = "ready"
		}
		// Server entries precede files added while the restoration request was pending.
		const restored = pending.map((attachment) => entries.find((entry) => entry.serverId === attachment.id) ?? adopt(attachment))
		entries = [...restored, ...entries.filter((entry) => !entry.serverId)]
		loaded = true
		needsSync = false
		publish()
	}
	const upload = async (entry: DraftImage, version: number) => {
		if (entry.discard || !entries.includes(entry) || entry.serverId) return
		if (!loaded || needsSync) { entry.status = "failed"; return }
		entry.status = "uploading"
		publish()
		try {
			const attachment = await call((signal) => uploadRunAttachment(client!, runId!, entry.file!, entry.uploadId!, signal))
			if (!current(version)) return
			entry.serverId = attachment.id
			entry.status = "ready"
		} catch (cause) {
			if (!current(version)) return
			entry.status = entry.discard ? "removing" : "failed"
			// Pause the rest of the batch so a retried image keeps its position.
			needsSync = true
			fail(cause)
		}
		publish()
	}
	const remove = async (entry: DraftImage, version: number) => {
		if (!entries.includes(entry)) return
		try {
			if (needsSync) await restore(version)
			if (!current(version)) return
			if (entry.serverId) await call((signal) => deleteRunAttachments(client!, runId!, entry.serverId, signal))
			if (current(version)) forget(entry)
		} catch (cause) {
			if (!current(version)) return
			entry.status = "failed"
			needsSync = true
			fail(cause)
		}
	}
	const clear = async (version: number) => {
		try {
			await call((signal) => deleteRunAttachments(client!, runId!, undefined, signal))
			if (!current(version)) return
			entries.forEach((entry) => { if (entry.file) URL.revokeObjectURL(entry.url) })
			entries = []
			clearing = false
			needsSync = false
			loaded = true
			error = null
		} catch (cause) {
			if (!current(version)) return
			entries.forEach((entry) => { entry.status = "failed" })
			fail(cause)
		}
	}
	return {
		subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
		getSnapshot: () => snapshot,
		activate: () => {
			active = true
			requests = new AbortController()
			if (client && runId) enqueue(restore)
			else publish()
		},
		dispose: () => {
			active = false
			requests.abort()
			generation += 1
			queue.length = 0
			entries.forEach((entry) => { if (entry.file) URL.revokeObjectURL(entry.url) })
			entries = []
			loaded = false
			needsSync = false
			clearing = false
			error = null
			publish()
		},
		add: (files: File[], rejection: string | null) => {
			if (!snapshot.canAdd) return
			error = rejection
			for (const file of files) {
				const entry: DraftImage = { file, name: file.name, url: URL.createObjectURL(file), status: "queued", uploadId: crypto.randomUUID() }
				entries.push(entry)
				enqueue((version) => upload(entry, version))
			}
			publish()
		},
		onRemove: (url: string) => {
			if (!active || clearing) return
			const entry = entries.find((item) => item.url === url)
			if (!entry) return
			entry.discard = true
			entry.status = "removing"
			error = null
			enqueue((version) => remove(entry, version))
			publish()
		},
		onClear: () => {
			if (!active || !client || !runId || clearing) return
			clearing = true
			entries.forEach((entry) => { entry.discard = true; entry.status = "removing" })
			error = null
			enqueue(clear)
			publish()
		},
		onRetry: () => {
			if (!snapshot.canRetry) return
			error = null
			enqueue(async (version) => {
				if (clearing) { await clear(version); return }
				await restore(version)
				if (!current(version)) return
				for (const entry of [...entries]) {
					if (!current(version)) return
					if (entry.discard) await remove(entry, version)
					else if (!entry.serverId) await upload(entry, version)
				}
			})
		},
		submit: (send) => {
			if (!snapshot.isReady) return Promise.resolve(false)
			const submitted = [...entries]
			return new Promise((resolve, reject) => {
				enqueue(async (version) => {
					try {
						const accepted = await send(submitted.length > 0)
						if (current(version) && accepted) submitted.forEach(forget)
						// A response for a disposed run must not clear the next run's text draft.
						resolve(current(version) && accepted)
					} catch (cause) {
						if (submitted.length && current(version) && (!(cause instanceof ApiError) || cause.kind !== "http" || (cause.status ?? 500) >= 500)) {
							needsSync = true
							fail(new Error("Reply acknowledgement was lost. Refresh images before retrying."))
						}
						reject(cause)
					}
				})
			})
		},
	}
}
