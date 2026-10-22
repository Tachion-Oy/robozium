const DEFAULT_SIZE = { width: 1260, height: 780 }

function windowLimits(workArea) {
  const maxWidth = Math.floor(workArea.width * 0.9)
  const maxHeight = Math.floor(workArea.height * 0.9)
  return { minWidth: Math.min(640, maxWidth), minHeight: Math.min(420, maxHeight), maxWidth, maxHeight }
}
function boundedSize(size, limits) {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) throw new Error("Invalid window size.")
  return { width: Math.round(Math.min(limits.maxWidth, Math.max(limits.minWidth, size.width))),
    height: Math.round(Math.min(limits.maxHeight, Math.max(limits.minHeight, size.height))) }
}
function zoomShortcut(input) {
  if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt || input.isComposing) return null
  if (["+", "="].includes(input.key) || input.code === "NumpadAdd") return 1
  if (input.key === "-" || input.code === "NumpadSubtract") return -1
  if (input.key === "0" || input.code === "Numpad0") return 0
  return null
}
function nextZoom(current, direction) {
  if (direction === 0) return 1
  return Math.min(3, Math.max(0.5, Math.round((current + direction * 0.1) * 10) / 10))
}
module.exports = { DEFAULT_SIZE, windowLimits, boundedSize, zoomShortcut, nextZoom }
