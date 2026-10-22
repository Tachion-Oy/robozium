const test = require("node:test")
const assert = require("node:assert/strict")
const { MessageLogWindow, logWindowSize } = require("../electron/message-log-window.cjs")

function fixture(area = { x: 0, y: 0, width: 1920, height: 1080 }) {
  let size = { width: 900, height: 650 }
  let position = { x: 900, y: 100 }
  let zoom = 1
  const window = {
    getBounds: () => ({ ...position, width: size.width, height: size.height + 30 }),
    getContentBounds: () => ({ ...position, ...size }),
    getContentSize: () => [size.width, size.height],
    setContentSize: (width, height) => { size = { width, height }; dock.resized() },
    setPosition: (x, y) => { position = { x, y } },
    webContents: { getZoomFactor: () => zoom },
  }
  const dock = new MessageLogWindow(window, () => ({ workArea: area }))
  return { window, dock, zoom: value => { zoom = value } }
}
test("opening grows only enough for readable panes and closing restores the original size", () => {
  const { dock, window } = fixture()
  dock.setOpen(true)
  assert.deepEqual(window.getContentSize(), [1120, 650])
  assert.deepEqual(dock.savedSize(), { width: 900, height: 650 }, "Temporary expansion is not persisted")
  assert.ok(window.getBounds().x + window.getBounds().width <= 1920)
  dock.setOpen(false)
  assert.deepEqual(window.getContentSize(), [900, 650])
})
test("an already sufficient window remains unchanged", () => {
  const { dock, window } = fixture()
  window.setContentSize(1260, 780)
  dock.setOpen(true)
  assert.deepEqual(window.getContentSize(), [1260, 780])
})
test("manual resizing while open retains and persists the user's size", () => {
  const { dock, window } = fixture()
  dock.setOpen(true)
  window.setContentSize(1300, 720)
  assert.deepEqual(dock.savedSize(), { width: 1300, height: 720 })
  dock.setOpen(false)
  assert.deepEqual(window.getContentSize(), [1300, 720])
})
test("zoom increases physical requirements without changing text size", () => {
  const { dock, window, zoom } = fixture()
  zoom(1.25)
  dock.setOpen(true)
  assert.deepEqual(window.getContentSize(), [1400, 650])
  zoom(1.5)
  dock.expand()
  assert.deepEqual(window.getContentSize(), [1680, 650])
  dock.setOpen(false)
  assert.deepEqual(window.getContentSize(), [900, 650])
})
test("small monitors gain only the height required for the stacked layout", () => {
  const { dock, window } = fixture({ x: 0, y: 0, width: 1024, height: 768 })
  window.setContentSize(640, 420)
  dock.setOpen(true)
  assert.deepEqual(window.getContentSize(), [640, 560])
  dock.setOpen(false)
  assert.deepEqual(window.getContentSize(), [640, 420])
})
test("a very small work area caps automatic growth and leaves scrolling to the renderer", () => {
  assert.deepEqual(logWindowSize({ width: 540, height: 350 }, { width: 540, height: 360 }, 1.25), { width: 540, height: 360 })
})
test("repeated toggles are idempotent and invalid IPC payloads cannot resize the window", () => {
  const { dock, window } = fixture()
  for (const input of [null, {}, 1, "true"]) assert.throws(() => dock.setOpen(input), /Invalid message log state/)
  dock.setOpen(true)
  dock.setOpen(true)
  dock.setOpen(false)
  dock.setOpen(false)
  assert.deepEqual(window.getContentSize(), [900, 650])
})
