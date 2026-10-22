import { describe, expect, it } from "vitest"
import { resolveHudImageUrl } from "@/lib/robozium/hud-images"

describe("HUD image sources", () => {
	it.each([
		["projects/example/chart.png", "/api/files/projects/example/chart.png"],
		["projects/夏/my chart.png", "/api/files/projects/%E5%A4%8F/my%20chart.png"],
		["projects/%E5%A4%8F/my%20chart.png", "/api/files/projects/%E5%A4%8F/my%20chart.png"],
		["https://example.com/image?token=abc&size=large#preview", "https://example.com/image?token=abc&size=large#preview"],
		["http://example.com/image.png", "http://example.com/image.png"],
	])("resolves %s", (input, expected) => {
		expect(resolveHudImageUrl(input)).toBe(expected)
	})

	it.each([
		"", "/etc/image.png", "//example.com/image.png", "projects//image.png",
		"../image.png", "projects/./image.png", "projects/%2e%2e/image.png",
		"projects/%2Fetc/image.png", "projects/%5cimage.png", "projects/invalid%.png",
		"javascript:alert(1)", "data:image/png;base64,abc", "blob:https://example.com/id",
		"file:///image.png", "C:\\image.png", "https:\\example.com/image.png",
		"https://user:password@example.com/image.png", "https://", "http:example.com/image.png",
		"projects/line\nbreak.png", "projects/%00.png",
	])("rejects %s", (input) => {
		expect(resolveHudImageUrl(input)).toBeNull()
	})
})
