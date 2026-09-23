import { createStore } from "zustand/vanilla"

type HudSizeState = {
	progress: number
}

/** Shared for this client runtime; each landing/run transition sets its default. */
export const hudSizeStore = createStore<HudSizeState>(() => ({
	progress: 0,
}))

export function setHudSizeProgress(progress: number) {
	hudSizeStore.setState({ progress: Math.min(1, Math.max(0, progress)) })
}
