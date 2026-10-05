// @vitest-environment node
import { describe, expect, it } from "vitest"
import { PNG } from "pngjs"
import { compareScreenshotPixels } from "../e2e/screenshot-comparison"

function solidImage(value: number, width = 100, height = 100) {
	const image = new PNG({ width, height })
	for (let index = 0; index < image.data.length; index += 4) {
		image.data.set([value, value, value, 255], index)
	}
	return image
}

describe("screenshot pixel tolerance", () => {
	it("accepts the same pixels with different PNG encodings", () => {
		const image = solidImage(240)
		const uncompressed = PNG.sync.write(image, { deflateLevel: 0 })
		const compressed = PNG.sync.write(image, { deflateLevel: 9 })
		expect(uncompressed.equals(compressed)).toBe(false)
		expect(compareScreenshotPixels(uncompressed, compressed)).toBeNull()
	})

	it("accepts small colour shifts and sparse rendering noise", () => {
		const expected = solidImage(240)
		const actual = solidImage(237)
		// Sixteen conspicuous pixels out of 10,000 are below the noise budget.
		for (let y = 40; y < 44; y++) {
			for (let x = 40; x < 44; x++) {
				actual.data.set([0, 0, 0, 255], (y * actual.width + x) * 4)
			}
		}
		expect(compareScreenshotPixels(PNG.sync.write(actual), PNG.sync.write(expected))).toBeNull()
	})

	it.each(["dark", "light"])("rejects visible lettering through a %s HUD", (theme) => {
		const background = theme === "dark" ? 12 : 240
		const ink = theme === "dark" ? 220 : 24
		const expected = solidImage(background)
		const actual = solidImage(background)
		// A small L-shaped glyph must exceed the tolerance, even on a mostly unchanged HUD.
		for (let y = 25; y < 65; y++) {
			for (let x = 40; x < 60; x++) {
				if (x < 45 || y >= 60) actual.data.set([ink, ink, ink, 255], (y * actual.width + x) * 4)
			}
		}
		const difference = compareScreenshotPixels(PNG.sync.write(actual), PNG.sync.write(expected))
		expect(difference?.errorMessage).toContain("pixels differ")
		expect(difference?.diff).toBeInstanceOf(Buffer)
	})

	it("rejects changed dimensions even when all pixels have the same colour", () => {
		const difference = compareScreenshotPixels(PNG.sync.write(solidImage(240, 101)), PNG.sync.write(solidImage(240)))
		expect(difference?.errorMessage).toContain("dimensions differ")
	})
})
