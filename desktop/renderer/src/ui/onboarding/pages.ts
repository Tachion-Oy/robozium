// The guide is one markdown file, shipped beside the app so the user can open it; a line
// holding only `---` separates its pages. Illustrations are CSS art, named by page heading.
import type { AgentMessage } from "../run/AgentMessagePanel"
import guide from "./onboarding.md?raw"

type OnboardingPage = Pick<AgentMessage, "id" | "content" | "illustration">

const ILLUSTRATIONS: Record<string, NonNullable<AgentMessage["illustration"]>> = {
	"Welcome to Robozium": { name: "keys", alt: "A key next to the Robozium window" },
	"3. Encrypt and save": { name: "secrets", alt: "A padlock protecting saved API keys" },
}

function guidePages(markdown: string): OnboardingPage[] {
	const pages = markdown.split(/^---$/m).map(page => page.trim())
	const headings = pages.map(page => /^## (.+)$/m.exec(page)?.[1])
	for (const heading of Object.keys(ILLUSTRATIONS)) {
		if (!headings.includes(heading)) throw new Error(`The onboarding guide has no page headed "${heading}".`)
	}
	return pages.map((content, index) => {
		const heading = headings[index]
		return { id: `onboarding-${index}`, content, illustration: heading ? ILLUSTRATIONS[heading] : undefined }
	})
}

/** Static guide for a live start without saved settings or `.env`. */
export const ONBOARDING_PAGES: readonly OnboardingPage[] = guidePages(guide)
