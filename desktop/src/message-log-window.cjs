const { windowLimits } = require("./window.cjs")

// CSS pixel minima match the pane layout; zoom changes physical requirements.
const SIDE_WIDTH = 640 + 480
const STACK_HEIGHT = 336 + 224
function logWindowSize(size, maximum, zoom) {
  if (maximum.width >= Math.ceil(SIDE_WIDTH * zoom)) {
    return { width: Math.max(size.width, Math.ceil(SIDE_WIDTH * zoom)), height: size.height }
  }
  return { width: size.width, height: Math.min(maximum.height, Math.max(size.height, Math.ceil(STACK_HEIGHT * zoom))) }
}

/** Own temporary native expansion independently of document reloads. */
class MessageLogWindow {
  constructor(window, display) {
    this.window = window
    this.display = display
    this.open = false
    this.baseline = null
    this.manuallyResized = false
    this.applying = false
    this.expected = null
  }
  maximum() {
    const bounds = this.window.getBounds()
    const content = this.window.getContentBounds()
    const limits = windowLimits(this.display(bounds).workArea)
    return { width: limits.maxWidth - (bounds.width - content.width), height: limits.maxHeight - (bounds.height - content.height) }
  }
  apply(size) {
    const maximum = this.maximum()
    this.expected = { width: Math.min(size.width, maximum.width), height: Math.min(size.height, maximum.height) }
    this.applying = true
    try {
      this.window.setContentSize(this.expected.width, this.expected.height)
      const bounds = this.window.getBounds()
      const area = this.display(bounds).workArea
      const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))
      const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
      if (x !== bounds.x || y !== bounds.y) this.window.setPosition(x, y)
    } finally { this.applying = false }
  }
  expand() {
    const [width, height] = this.window.getContentSize()
    const size = logWindowSize({ width, height }, this.maximum(), this.window.webContents.getZoomFactor())
    if (width !== size.width || height !== size.height) this.apply(size)
  }
  setOpen(open) {
    if (typeof open !== "boolean") throw new Error("Invalid message log state.")
    if (open === this.open) return { open }
    if (open) {
      const [width, height] = this.window.getContentSize()
      this.baseline = { width, height }
      this.expected = this.baseline
      this.manuallyResized = false
      this.open = true
      this.expand()
    } else {
      this.open = false
      if (!this.manuallyResized) this.apply(this.baseline)
      this.baseline = null
    }
    return { open: this.open }
  }
  resized() {
    if (!this.open || this.applying) return
    const [width, height] = this.window.getContentSize()
    if (width !== this.expected?.width || height !== this.expected?.height) this.manuallyResized = true
  }
  savedSize() {
    if (this.open && !this.manuallyResized) return this.baseline
    const [width, height] = this.window.getContentSize()
    return { width, height }
  }
}
module.exports = { MessageLogWindow, logWindowSize }
