import { describe, expect, it } from "vitest";
import { streamingDisplayText } from "../../../lib/robosprawl/streaming-text";

describe("streamingDisplayText", () => {
  it("drops braces and quotes from partial JSON", () => {
    expect(streamingDisplayText('{"action": "Editing config.py')).toBe(
      "action: Editing config.py",
    );
  });

  it("leaves an empty string untouched", () => {
    expect(streamingDisplayText("")).toBe("");
  });

  it("renders escaped newlines and tabs as real whitespace", () => {
    expect(streamingDisplayText('"rationale": "line one\\nline two')).toBe(
      "rationale: line one\nline two",
    );
  });

  it("unescapes quotes and backslashes before stripping", () => {
    expect(streamingDisplayText('"value": "say \\"hi\\"')).toBe("value: say hi");
  });

  it("is idempotent across accumulation (whole-string, no buffering)", () => {
    const partial = '{"action": "wri';
    const grown = '{"action": "writing file", "rationale": "because';
    expect(streamingDisplayText(partial)).toBe("action: wri");
    expect(streamingDisplayText(grown)).toBe(
      "action: writing file, rationale: because",
    );
  });
});
