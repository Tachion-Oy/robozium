// Stand-in for the reference's react-hot-toast notifications, whose injected
// inline styles the renderer's CSP blocks. Same call shape; failures render as
// alerts in the notices row until a CSP-compatible toaster replaces this.
import type { ErrorNotice } from "../../feedback/notices"

export { showErrorToast, useErrorNotices } from "../../feedback/notices"

export function ErrorNotices({ items }: { items: readonly ErrorNotice[] }) {
	return items.map(notice => (
		<p key={notice.id} role="alert">
			{notice.title ? `${notice.title}: ` : ""}{notice.message}{notice.detail ? ` ${notice.detail}` : ""}
		</p>
	))
}
