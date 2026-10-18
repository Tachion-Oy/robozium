"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import type { FileRejection } from "react-dropzone"
import { createReplyImageDraft, type ReplyImage } from "@/lib/robozium/reply-images"
export type { ReplyImage } from "@/lib/robozium/reply-images"

export const REPLY_IMAGE_LIMIT = 4
export const REPLY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const REPLY_IMAGE_ACCEPT = {
	"image/png": [".png"],
	"image/jpeg": [".jpg", ".jpeg"],
	"image/webp": [".webp"],
	"image/gif": [".gif"],
}

export type ReplyImagesModel = {
	images: readonly ReplyImage[]
	error: string | null
	isBusy: boolean
	isReady: boolean
	canAdd: boolean
	canRetry: boolean
	onRetry: () => void
	submit: (send: (hasImages: boolean) => Promise<boolean>) => Promise<boolean>
	onDrop: (files: File[], rejections: FileRejection[]) => void
	onRemove: (url: string) => void
	onClear: () => void
}

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

/** Own the queue above HUD screens; navigation never deletes server attachments. */
export function useReplyImages(runId: string | null, ended = false): ReplyImagesModel {
	const draft = useMemo(() => createReplyImageDraft(runId), [runId])
	const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
	useEffect(() => {
		if (!ended) draft.activate()
		return draft.dispose
	}, [draft, ended])
	const onDrop = (files: File[], rejections: FileRejection[]) => {
		const reasons = rejections.map(rejectionReason)
		if (draft.getSnapshot().images.length + files.length > REPLY_IMAGE_LIMIT) {
			reasons.push("You can attach up to four images. Remove an image before adding more.")
			files = []
		}
		draft.add(files, [...new Set(reasons)].join(" ") || null)
	}
	return { ...snapshot, onDrop, onRemove: draft.onRemove, onClear: draft.onClear, onRetry: draft.onRetry, submit: draft.submit }
}
