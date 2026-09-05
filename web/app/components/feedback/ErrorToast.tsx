"use client"

import toast from "react-hot-toast"

export type NotificationTone = "error" | "warning"

type ErrorToastContentProps = {
	title?: string
	message: string
	detail?: string | null
	tone?: NotificationTone
	isVisible: boolean
	onDismiss?: () => void
}

type ShowNotificationToastOptions = {
	title?: string
	message: string
	detail?: string | null
	tone: NotificationTone
}

type ShowErrorToastOptions = Omit<ShowNotificationToastOptions, "tone">

export function ErrorToastContent({
	title = "Action Required",
	message,
	detail,
	tone = "error",
	isVisible,
	onDismiss,
}: ErrorToastContentProps) {
	return (
		<section
			className={`agent-error-toast agent-error-toast--${tone} pointer-events-auto flex w-[min(50rem,calc(100vw-2rem))] items-start gap-3 px-4 py-4 ${
				isVisible
					? " agent-error-toast--visible"
					: " agent-error-toast--hidden"
			}`}>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="agent-error-toast__title">{title}</p>
				<p className="agent-error-toast__message">{message}</p>
				{detail ? <p className="agent-error-toast__detail">{detail}</p> : null}
			</div>
			{onDismiss ? (
				<button
					type="button"
					className="agent-error-toast__dismiss shrink-0"
					data-hud-ignore-dismiss
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation()
						onDismiss()
					}}
					aria-label={`Dismiss ${tone} notification`}>
					Dismiss
				</button>
			) : null}
		</section>
	)
}

export function showNotificationToast({
	title,
	message,
	detail,
	tone,
}: ShowNotificationToastOptions) {
	return toast.custom(
		(toastState) => (
			<ErrorToastContent
				title={title}
				message={message}
				detail={detail}
				tone={tone}
				isVisible={toastState.visible}
				onDismiss={() => toast.dismiss(toastState.id)}
			/>
		),
		{
			duration: 5000,
			ariaProps: {
				role: "status",
				"aria-live": "polite",
			},
		},
	)
}

export function showErrorToast(options: ShowErrorToastOptions) {
	return showNotificationToast({ ...options, tone: "error" })
}
