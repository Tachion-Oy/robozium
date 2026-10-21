import { Fragment, type ReactNode } from "react"
import type { MessageLogItem } from "@/lib/robozium/view-model"
import { TerminalEmphasis } from "../TerminalEmphasis"
import { TerminalTag } from "../TerminalTag"

/**
 * Keys whose values get the inline-tag treatment.
 * Some keys suppress their label so the value speaks for itself.
 */
const TAG_VALUE_KEYS = new Set(["tool", "status", "path"])
const SUPPRESSED_TAG_LABEL_KEYS = new Set(["tool", "status"])

/**
 * Short values (numbers, identifiers, brief strings) get TerminalEmphasis.
 * Long prose — errors, result lists, messages — stays plain.
 */
const EMPH_MAX_LEN = 55

const ERROR_FIRST_LINE = /^(.+?)\s+failed\s*[—–-]\s*(.+)$/

const PATH_INTEGRAL_TOOL = "path integral"
const MATH_EMPH_SEGMENTS = [
  "∫_γ ω = ∮_∂M dω",
  "e^{iπ}+1=0",
  "R_{μν}−½Rg_{μν}+Λg_{μν}=8πG T_{μν}",
  "|ψ⟩=α|0⟩+β|1⟩",
]

/**
 * `tool_name failed — path/location` on line 1: glow on the tool name, inverted
 * tag on the location. Remaining lines stay plain.
 */
function renderErrorPlainText(content: string): ReactNode {
  const [first = "", ...restLines] = content.split("\n")
  const rest = restLines.join("\n")
  const m = ERROR_FIRST_LINE.exec(first)
  if (m) {
    const tool = m[1]!.trim()
    const where = m[2]!.trim()
    return (
      <>
        {tool.length > 0 && tool.length <= EMPH_MAX_LEN ? (
          <TerminalEmphasis>{tool}</TerminalEmphasis>
        ) : (
          tool
        )}
        {` failed — `}
        <TerminalTag>{where}</TerminalTag>
        {rest ? (
          <>
            {"\n"}
            {rest}
          </>
        ) : null}
      </>
    )
  }
  return content
}

function renderPathLine(line: string): ReactNode {
  const keyedPath = /^(\s*path\s*[:=]\s*)(.+)$/.exec(line)
  if (!keyedPath) return line
  const [, prefix, value] = keyedPath
  const pathValue = value.trim()
  if (!pathValue) return line
  return (
    <>
      {prefix}
      <TerminalTag>{pathValue}</TerminalTag>
    </>
  )
}

function renderMathLine(line: string): ReactNode {
  const parts: ReactNode[] = []
  let cursor = 0
  let key = 0
  while (cursor < line.length) {
    let hitIndex = -1
    let hitSegment = ""
    for (const segment of MATH_EMPH_SEGMENTS) {
      const i = line.indexOf(segment, cursor)
      if (i !== -1 && (hitIndex === -1 || i < hitIndex)) {
        hitIndex = i
        hitSegment = segment
      }
    }
    if (hitIndex === -1) break
    if (hitIndex > cursor) {
      parts.push(line.slice(cursor, hitIndex))
    }
    parts.push(
      <TerminalEmphasis key={`math-emph-${key++}`}>{hitSegment}</TerminalEmphasis>,
    )
    cursor = hitIndex + hitSegment.length
  }
  if (cursor < line.length) {
    parts.push(line.slice(cursor))
  }
  return parts.length === 0 ? line : <>{parts}</>
}

function renderToolBodyLine(firstLine: string, line: string): ReactNode {
  const pathLine = renderPathLine(line)
  if (pathLine !== line) return pathLine
  if (firstLine.trim().toLowerCase() === PATH_INTEGRAL_TOOL) return renderMathLine(line)
  return line
}

function renderToolPlainText(content: string): ReactNode {
  const [firstLine = "", ...restLines] = content.split("\n")
  const rest = restLines.map((line, index) => (
    <Fragment key={`tool-rest-${index}`}>
      {"\n"}
      {renderToolBodyLine(firstLine, line)}
    </Fragment>
  ))

  const keyedTool = /^(\s*tool\s*[:=]\s*)(.+)$/.exec(firstLine)
  if (keyedTool) {
    const [, prefix, toolName] = keyedTool
    const name = toolName.trim()
    if (name.length > 0 && name.length <= EMPH_MAX_LEN) {
      return (
        <>
          {prefix}
          <TerminalEmphasis>{name}</TerminalEmphasis>
          {rest}
        </>
      )
    }
    return content
  }

  const toolName = firstLine.trim()
  if (toolName.length > 0 && toolName.length <= EMPH_MAX_LEN) {
    return (
      <>
        <TerminalEmphasis>{toolName}</TerminalEmphasis>
        {rest}
      </>
    )
  }
  return (
    <>
      {firstLine}
      {rest}
    </>
  )
}

function renderValue(key: string, value: unknown): ReactNode {
  const str = Array.isArray(value) ? value.join(", ") : String(value)
  if (TAG_VALUE_KEYS.has(key)) return <TerminalTag>{str}</TerminalTag>
  if (str.length <= EMPH_MAX_LEN) return <TerminalEmphasis>{str}</TerminalEmphasis>
  return str
}

/**
 * Placeholder-only rich content rendering for the landing demo.
 */
export function renderDemoContent(item: MessageLogItem): ReactNode {
  try {
    const parsed: unknown = JSON.parse(item.content)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>)
      let first = true
      return entries.map(([key, value]) => {
        const suppressLabel = SUPPRESSED_TAG_LABEL_KEYS.has(key)
        const sep = first ? "" : "  "
        first = false
        return (
          <Fragment key={key}>
            {sep}
            {suppressLabel ? null : `${key} `}
            {renderValue(key, value)}
          </Fragment>
        )
      })
    }
  } catch {
    // plain text — fall through
  }
  if (item.role === "tool") return renderToolPlainText(item.content)
  if (item.role === "error") return renderErrorPlainText(item.content)
  return item.content
}
