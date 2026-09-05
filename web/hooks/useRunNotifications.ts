"use client"

import { useEffect, useRef } from "react"
import { showNotificationToast } from "@/app/components/feedback/ErrorToast"
import {
	formatNotification,
	shouldToast,
} from "@/lib/robosprawl/session/notification-format"
import { useRunSessionSelector } from "./useRunSession"

export function useRunNotifications() {
	const notifications = useRunSessionSelector(
		(state) => state.notifications,
		[],
	)
	const shownIdsRef = useRef<Set<string>>(new Set())

	useEffect(() => {
		for (const notification of notifications) {
			if (shownIdsRef.current.has(notification.id)) continue
			shownIdsRef.current.add(notification.id)
			if (!shouldToast(notification)) continue
			const { title, message, detail, tone } = formatNotification(notification)
			showNotificationToast({ title, message, detail, tone })
		}
	}, [notifications])
}
