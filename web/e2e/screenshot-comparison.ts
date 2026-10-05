import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"

// Captures within one page allow rasterization noise, but need a lower colour
// threshold than saved baselines: 0.2 hides visible, faint light-theme lettering.
const screenshotTolerance = { threshold: 0.1, maxDiffPixelRatio: 0.002 }

export function compareScreenshotPixels(actualBuffer: Buffer, expectedBuffer: Buffer): {
	errorMessage: string
	diff?: Buffer
} | null {
	const actual = PNG.sync.read(actualBuffer)
	const expected = PNG.sync.read(expectedBuffer)
	if (actual.width !== expected.width || actual.height !== expected.height) {
		return {
			errorMessage: `Screenshot dimensions differ: ${actual.width}×${actual.height} versus ${expected.width}×${expected.height}`,
		}
	}
	const { width, height } = expected
	const diff = new PNG({ width, height })
	const changedPixels = pixelmatch(expected.data, actual.data, diff.data, width, height, {
		threshold: screenshotTolerance.threshold,
	})
	const totalPixels = width * height
	if (changedPixels <= totalPixels * screenshotTolerance.maxDiffPixelRatio) return null
	return {
		errorMessage: `${changedPixels}/${totalPixels} pixels differ (${(changedPixels / totalPixels * 100).toFixed(3)}%); allowed ${screenshotTolerance.maxDiffPixelRatio * 100}% at colour threshold ${screenshotTolerance.threshold}`,
		diff: PNG.sync.write(diff),
	}
}
