"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import type { FileRejection } from "react-dropzone"

export const REPLY_IMAGE_LIMIT = 4
export const REPLY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const REPLY_IMAGE_ACCEPT = {
	"image/png": [".png"],
	"image/jpeg": [".jpg", ".jpeg"],
	"image/webp": [".webp"],
	"image/gif": [".gif"],
}

export type ReplyImage = { url: string; name: string }
export type ReplyImagesModel = {
	images: readonly ReplyImage[]
	error: string | null
	onDrop: (files: File[], rejections: FileRejection[]) => void
	onRemove: (url: string) => void
	onClear: () => void
}

function rejectionReason({ file, errors }: FileRejection): string {
	const reasons = errors.map(({ code }) => {
		switch (code) {
			case "file-too-large": return "Images must be 10 MiB or smaller."
			case "too-many-files": return "You can preview up to four images."
			default: return "Use PNG, JPEG, WebP, or GIF images."
		}
	})
	return `${file.name}: ${[...new Set(reasons)].join(" ")}`
}

/** Own URLs above the screen components; late picker/drop callbacks cannot revive a disposed draft. */
function createImageDraft(runId: string | null) {
	let snapshot: { runId: string | null; images: readonly ReplyImage[]; error: string | null } = {
		runId, images: [], error: null,
	}
	let active = false
	const listeners = new Set<() => void>()
	const publish = (images: readonly ReplyImage[], error: string | null) => {
		snapshot = { runId, images, error }
		listeners.forEach((listener) => listener())
	}
	const clear = () => {
		snapshot.images.forEach(({ url }) => URL.revokeObjectURL(url))
		publish([], null)
	}
	return {
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => { listeners.delete(listener) }
		},
		getSnapshot: () => snapshot,
		activate: () => { active = true },
		dispose: () => { active = false; clear() },
		onDrop: (files: File[], rejections: FileRejection[]) => {
			if (!active) return
			const reasons = rejections.map(rejectionReason)
			if (snapshot.images.length + files.length > REPLY_IMAGE_LIMIT) {
				reasons.push("You can preview up to four images. Remove an image before adding more.")
				files = []
			}
			const additions = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
			publish([...snapshot.images, ...additions], [...new Set(reasons)].join(" ") || null)
		},
		onRemove: (url: string) => {
			if (!active || !snapshot.images.some((image) => image.url === url)) return
			URL.revokeObjectURL(url)
			publish(snapshot.images.filter((image) => image.url !== url), null)
		},
		onClear: clear,
	}
}

export function useReplyImages(runId: string | null): ReplyImagesModel {
	const draft = useMemo(() => createImageDraft(runId), [runId])
	const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
	useEffect(() => {
		draft.activate()
		return draft.dispose
	}, [draft])
	return { ...snapshot, onDrop: draft.onDrop, onRemove: draft.onRemove, onClear: draft.onClear }
}
