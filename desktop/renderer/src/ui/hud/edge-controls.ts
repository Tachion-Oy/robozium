// The right edge's copy controls slot. AgentHud owns the column and its element; the
// reply form renders its live copy controls into it with a portal, because the form
// holds the displayed message and the draft. Without a reply form AgentHud shows the
// same controls disabled, so the column never changes shape.
import { createContext } from "react"

export const CopyControlsSlot = createContext<HTMLElement | null>(null)
