import { AgentApiError, deleteRunAttachments, listRunAttachments, uploadRunAttachment } from "./client"
import type { RunAttachment } from "./wire"

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

type Snapshot = {
	images: readonly ReplyImage[]
	error: string | null
	isBusy: boolean
	isReady: boolean
	canAdd: boolean
	canRetry: boolean
}

// A reopened composer waits for the previous instance's in-flight work before GET.
const pendingOperations = new Map<string, Promise<void>>()

/** One queue owns all pending-collection mutations, including reply acceptance. */
export function createReplyImageDraft(runId: string | null) {
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
	let snapshot: Snapshot = { images: [], error, isBusy: false, isReady: false, canAdd: false, canRetry: false }
	const current = (version: number) => active && version === generation
	const publish = () => {
		const isBusy = running || queue.length > 0
		snapshot = {
			images: entries.filter((entry) => !entry.discard || entry.status === "failed").map(({ url, name, serverId, status }) => ({ url, name, serverId, status })),
			error, isBusy,
			isReady: active && loaded && !needsSync && !clearing && !isBusy && entries.every((entry) => entry.status === "ready" && !entry.discard),
			canAdd: active && Boolean(runId) && !clearing,
			canRetry: active && !isBusy && (!loaded || needsSync || clearing || entries.some((entry) => entry.status === "failed")),
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
		url: `/api/files/${attachment.path.split("/").map(encodeURIComponent).join("/")}`,
	})
	const restore = async (version: number) => {
		const pending = await listRunAttachments(runId!)
		if (!current(version)) return
		const ids = new Set(pending.map(({ id }) => id))
		for (const entry of [...entries]) {
			if (entry.serverId && !ids.has(entry.serverId)) forget(entry)
			if (!entry.serverId && entry.uploadId) entry.serverId = pending.find((item) => item.upload_id === entry.uploadId)?.id
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
			const attachment = await uploadRunAttachment(runId!, entry.file!, entry.uploadId!)
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
			if (entry.serverId) await deleteRunAttachments(runId!, entry.serverId)
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
			await deleteRunAttachments(runId!)
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
			if (runId) enqueue(restore)
			else publish()
		},
		dispose: () => {
			active = false
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
			if (!active || !runId || clearing) return
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
		submit: (send: (hasImages: boolean) => Promise<boolean>): Promise<boolean> => {
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
						if (submitted.length && current(version) && (!(cause instanceof AgentApiError) || cause.status >= 500)) {
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
