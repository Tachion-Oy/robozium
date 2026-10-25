// Adapted from web/hooks/useReplyImages.ts and web/lib/robozium/reply-images.ts at 2a0c183.
// Rewritten for desktop: React state holds what the composer shows, and one queue
// per run sends the requests in order and reports through setState. Requests go
// through the desktop client under a deadline and end with the queue; restored
// previews load from the backend origin. Without a run there is nothing to upload
// or retry.
import { useEffect, useRef, useState } from "react"
import type { FileRejection } from "react-dropzone"
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { deleteRunAttachments, hubFileUrl, listRunAttachments, uploadRunAttachment, type RunAttachment } from "./attachments-api"

export const REPLY_IMAGE_LIMIT = 4
export const REPLY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const REPLY_IMAGE_ACCEPT = {
	"image/png": [".png"],
	"image/jpeg": [".jpg", ".jpeg"],
	"image/webp": [".webp"],
	"image/gif": [".gif"],
}

export type ReplyImage = {
	url: string
	name: string
	serverId?: string
	status: "queued" | "uploading" | "ready" | "removing" | "failed"
}

type ReplyImagesState = {
	images: readonly ReplyImage[]
	error: string | null
	isBusy: boolean
	/** Every image is uploaded and nothing is pending: a reply may be sent. */
	isReady: boolean
	canAdd: boolean
	canRetry: boolean
}

export type ReplyImagesModel = ReplyImagesState & {
	onDrop: (files: File[], rejections: FileRejection[]) => void
	onRemove: (url: string) => void
	onClear: () => void
	/** Reload from the backend, then finish failed uploads and removals. */
	onRetry: () => void
	/** Send once ready; true only if the backend accepted the reply. */
	submit: (send: (hasImages: boolean) => Promise<boolean>) => Promise<boolean>
}

const IDLE: ReplyImagesState = { images: [], error: null, isBusy: false, isReady: false, canAdd: false, canRetry: false }

function rejectionReason({ file, errors }: FileRejection): string {
	const reasons = errors.map(({ code }) => {
		switch (code) {
			case "file-too-large": return "Images must be 10 MiB or smaller."
			case "too-many-files": return "You can attach up to four images."
			default: return "Use PNG, JPEG, WebP, or GIF images."
		}
	})
	return `${file.name}: ${[...new Set(reasons)].join(" ")}`
}

/** Own the images above HUD screens; navigation never deletes server attachments. */
export function useReplyImages(client: DesktopApiClient, runId: string | null, ended = false): ReplyImagesModel {
	const [state, setState] = useState<ReplyImagesState>(IDLE)
	const queue = useRef<ImageQueue | null>(null)
	// A queue per run. Leaving or ending the run drops local state; server attachments stay.
	useEffect(() => {
		if (ended) return
		const started = startImageQueue(client, runId, setState)
		queue.current = started
		return () => {
			started.stop()
			queue.current = null
			setState(IDLE)
		}
	}, [client, runId, ended])
	const onDrop = (files: File[], rejections: FileRejection[]) => {
		const reasons = rejections.map(rejectionReason)
		if (state.images.length + files.length > REPLY_IMAGE_LIMIT) {
			reasons.push("You can attach up to four images. Remove an image before adding more.")
			files = []
		}
		queue.current?.add(files, [...new Set(reasons)].join(" ") || null)
	}
	return {
		...state,
		onDrop,
		onRemove: url => queue.current?.remove(url),
		onClear: () => queue.current?.clear(),
		onRetry: () => queue.current?.retry(),
		submit: send => queue.current?.submit(send) ?? Promise.resolve(false),
	}
}

type ImageQueue = ReturnType<typeof startImageQueue>

type Entry = ReplyImage & {
	file?: File
	/** Removal requested; the entry stays until the backend confirms. */
	discard?: boolean
	uploadId?: string
}

// A reopened composer waits for the previous queue's in-flight requests before
// reading the backend's pending images.
const pendingQueues = new Map<string, Promise<void>>()

/**
 * Run one run's image requests strictly in order, so uploads keep their order
 * and a reply waits for them. State lives in plain variables, not React state,
 * because each step reads the current values after its await; `refresh` hands
 * React a new copy after every change.
 */
function startImageQueue(client: DesktopApiClient, runId: string | null, setState: (state: ReplyImagesState) => void) {
	const requests = new AbortController()
	const call = <T>(operation: (signal: AbortSignal) => Promise<T>) => withDeadline(requests.signal, operation)
	const hasRun = runId !== null
	let active = true
	let entries: Entry[] = []
	/** The backend's pending images have been read. */
	let loaded = false
	/** A request failed; read the backend again before continuing. */
	let needsSync = false
	/** Clear is pending. */
	let clearing = false
	let running = false
	let error: string | null = null
	const operations: Array<() => Promise<void>> = []

	const viewState = (): ReplyImagesState => {
		const isBusy = running || operations.length > 0
		const inSync = loaded && !needsSync && !clearing
		return {
			// An image disappears once its removal starts, unless the removal failed.
			images: entries
				.filter(entry => !entry.discard || entry.status === "failed")
				.map(({ url, name, serverId, status }) => ({ url, name, serverId, status })),
			error,
			isBusy,
			isReady: inSync && !isBusy && entries.every(entry => entry.status === "ready" && !entry.discard),
			canAdd: hasRun && !clearing,
			canRetry: hasRun && !isBusy && (!inSync || entries.some(entry => entry.status === "failed")),
		}
	}
	const refresh = () => {
		if (active) setState(viewState())
	}
	const forget = (entry: Entry) => {
		if (entry.file) URL.revokeObjectURL(entry.url)
		entries = entries.filter(item => item !== entry)
	}
	const fail = (cause: unknown) => {
		error = cause instanceof Error ? cause.message : "Could not update images. Retry when connected."
	}

	const drain = async () => {
		if (running) return
		running = true
		const previous = runId ? pendingQueues.get(runId) : undefined
		let finish!: () => void
		const settled = new Promise<void>(resolve => { finish = resolve })
		if (runId) pendingQueues.set(runId, settled)
		refresh()
		try {
			if (previous) await previous
			while (active && operations.length) await operations.shift()!()
		} finally {
			running = false
			if (runId && pendingQueues.get(runId) === settled) pendingQueues.delete(runId)
			finish()
			refresh()
		}
	}
	const enqueue = (operation: () => Promise<void>) => {
		operations.push(async () => {
			if (!active) return
			try { await operation() } catch (cause) {
				if (active) fail(cause)
			}
		})
		void drain()
	}

	const adopt = (attachment: RunAttachment): Entry => ({
		name: attachment.name, serverId: attachment.id, status: "ready", discard: clearing,
		url: hubFileUrl(client, attachment.path),
	})
	const restore = async () => {
		const pending = await call(signal => listRunAttachments(client, runId!, signal))
		if (!active) return
		const ids = new Set(pending.map(({ id }) => id))
		for (const entry of [...entries]) {
			if (entry.serverId && !ids.has(entry.serverId)) forget(entry)
			if (!entry.serverId && entry.uploadId) entry.serverId = pending.find(item => item.uploadId === entry.uploadId)?.id
			if (entry.serverId && !entry.discard) entry.status = "ready"
		}
		// Server entries precede files added while the restoration request was pending.
		const restored = pending.map(attachment => entries.find(entry => entry.serverId === attachment.id) ?? adopt(attachment))
		entries = [...restored, ...entries.filter(entry => !entry.serverId)]
		loaded = true
		needsSync = false
		refresh()
	}
	const upload = async (entry: Entry) => {
		if (entry.discard || !entries.includes(entry) || entry.serverId) return
		if (!loaded || needsSync) { entry.status = "failed"; return }
		entry.status = "uploading"
		refresh()
		try {
			const attachment = await call(signal => uploadRunAttachment(client, runId!, entry.file!, entry.uploadId!, signal))
			if (!active) return
			entry.serverId = attachment.id
			entry.status = "ready"
		} catch (cause) {
			if (!active) return
			entry.status = entry.discard ? "removing" : "failed"
			// Pause the rest of the batch so a retried image keeps its position.
			needsSync = true
			fail(cause)
		}
		refresh()
	}
	const remove = async (entry: Entry) => {
		if (!entries.includes(entry)) return
		try {
			if (needsSync) await restore()
			if (!active) return
			if (entry.serverId) await call(signal => deleteRunAttachments(client, runId!, entry.serverId, signal))
			if (active) forget(entry)
		} catch (cause) {
			if (!active) return
			entry.status = "failed"
			needsSync = true
			fail(cause)
		}
	}
	const clearAll = async () => {
		try {
			await call(signal => deleteRunAttachments(client, runId!, undefined, signal))
			if (!active) return
			entries.forEach(entry => { if (entry.file) URL.revokeObjectURL(entry.url) })
			entries = []
			clearing = false
			needsSync = false
			loaded = true
			error = null
		} catch (cause) {
			if (!active) return
			entries.forEach(entry => { entry.status = "failed" })
			fail(cause)
		}
	}

	if (hasRun) enqueue(restore)
	else refresh()

	return {
		stop: () => {
			active = false
			requests.abort()
			operations.length = 0
			entries.forEach(entry => { if (entry.file) URL.revokeObjectURL(entry.url) })
			entries = []
		},
		add: (files: File[], rejection: string | null) => {
			if (!viewState().canAdd) return
			error = rejection
			for (const file of files) {
				const entry: Entry = { file, name: file.name, url: URL.createObjectURL(file), status: "queued", uploadId: crypto.randomUUID() }
				entries.push(entry)
				enqueue(() => upload(entry))
			}
			refresh()
		},
		remove: (url: string) => {
			if (clearing) return
			const entry = entries.find(item => item.url === url)
			if (!entry) return
			entry.discard = true
			entry.status = "removing"
			error = null
			enqueue(() => remove(entry))
			refresh()
		},
		clear: () => {
			if (!hasRun || clearing) return
			clearing = true
			entries.forEach(entry => { entry.discard = true; entry.status = "removing" })
			error = null
			enqueue(clearAll)
			refresh()
		},
		retry: () => {
			if (!viewState().canRetry) return
			error = null
			enqueue(async () => {
				if (clearing) { await clearAll(); return }
				await restore()
				if (!active) return
				for (const entry of [...entries]) {
					if (!active) return
					if (entry.discard) await remove(entry)
					else if (!entry.serverId) await upload(entry)
				}
			})
		},
		submit: (send: (hasImages: boolean) => Promise<boolean>): Promise<boolean> => {
			if (!viewState().isReady) return Promise.resolve(false)
			const submitted = [...entries]
			return new Promise((resolve, reject) => {
				enqueue(async () => {
					try {
						const accepted = await send(submitted.length > 0)
						if (active && accepted) submitted.forEach(forget)
						// A response for a stopped queue must not clear the next run's text draft.
						resolve(active && accepted)
					} catch (cause) {
						if (submitted.length && active && (!(cause instanceof ApiError) || cause.kind !== "http" || (cause.status ?? 500) >= 500)) {
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
