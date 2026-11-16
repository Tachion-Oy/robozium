"""Robozium orientation and HUD output for project agents."""

# MIT License
#
# Copyright (c) 2026 Tachion Oy
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from typing import Final

from roboz.skill import Skill

ROBOZIUM_SKILL_NAME: Final[str] = "robozium"

robozium = Skill(
    name=ROBOZIUM_SKILL_NAME,
    description="Robozium orientation, project permissions, Librarian memory, and HUD output.",
    instructions="""## Robozium orientation

The host selects models, capabilities, sandbox layout, and project persistence
folders. Roboz and Roboshed supply reusable agent, tool, skill, and deployment
mechanisms. Describe available capabilities from the current tools and skills;
do not assume an unavailable tool exists.

Use the runtime-supplied file tool base, project slug, writable project directory,
read-only directory, and shared directory. The role name does not determine the
project directory. Use the supplied paths instead of guessing folder names.

## Sandbox permissions

The hub is the file-tool base. The standard Robozium layout is shown below;
the host can rename these folders, so use the actual paths in your project context.

```text
<hub>/
  projects/
    <current-project>/         Your writable project directory
      conversation_logs/       Runtime conversation history
      conversation_snapshots/  Librarian summaries
      persistent_memory/       Librarian memory
    <other-project>/           Readable, but not writable by this project
  workspace/                   Shared across projects; changes require approval
  readonly/                    Shared reference files; no changes allowed
```

| Location | Read | Create, modify, rename, or delete |
| --- | --- | --- |
| Current project and its descendants | Allowed | Allowed without a prompt |
| Other projects and their descendants | Allowed | Denied |
| Shared workspace and its descendants | Allowed | Ask the user for each operation requiring approval |
| Read-only reference area | Allowed | Denied |
| Other locations inside the hub | Allowed | Denied |
| Outside the hub | Denied | Denied |

Projects have separate writable areas, not private read boundaries. A folder
named `private` inside your project is still readable under this policy. Making
an in-hub path unreadable requires a host policy change. A deny-READ rule must
take precedence over the broad READ allow rule; the standard policy gives
allow rules precedence, so adding a conflicting deny rule alone is insufficient.
For example, with base `/hub` and project `testing`,
`projects/testing/private/secret.txt` is readable; `/tmp/private/secret.txt` is
outside the hub and denied. Relative paths start at the hub, not at your project.
Normalizing `.` or `..` does not change the rules for the resulting location.

The guard checks every required permission before asking for approval. An
existing-file write may require separate CREATE and DELETE approvals. Approval
applies to that operation; it does not grant standing permission for later calls
or override a policy denial. Approval questions go directly through the host UI.
Tool results include the question, the user's exact reply, and the decision.
Use that reply when deciding what to do next, including when the user declines
and gives further instructions. Do not infer that no prompt occurred merely
because a write succeeded or an earlier result is missing from your context.

File validation may stop a command before permission evaluation: a missing
parent or unsupported link is a preparation error, not a policy denial.
Content reads and writes reject symlinks and files with multiple hard links;
all names of a hard-linked file share that restriction. A symlink selected by a
glob rejects the whole read/search command before any content is read. Directory
searches with `grep -r` or `rg` skip descendant symlinks. `rm` can remove a terminal
link at its own pathname without reading or changing the target. These guards
apply to the file tools; they are not an operating-system sandbox.

## Shell commands

This section applies only when `run_shell_command` is among your tools.

The shell is a last resort. Your other tools are guarded: the file tools
follow the permission table and cannot damage anything outside it. A shell
command has no guard. It can change or delete anything in the hub, and the
only check is the user reading the command and answering yes or no. Every
shell command therefore hands the safety check to the user and hence requires
their approval and is thus not suited for long running tasks, or rather,
they introduce unwanted pauses. Do not use this when another tool can do the work.
Sometimes, of course that is unavoidable, use your judgement. Also, if the command
you propose is too complicated for example a long chain, it will likely be
rejected even if perfectly legitimate, as this app is running on a sensitive system
and unwanted changes need to be guarded against.

### Use another tool first

| Task | Tool |
| --- | --- |
| List, find, read, search, count, or compare files | File tools |
| Create, copy, move, rename, or delete files and folders | File tools |
| Change text in a file | File tools |
| Search the web, read a web page, download a file | Web skill, when it is listed; load it first |
| Read a PDF | PDF reader |

Propose a shell command only for an operation none of your current tools
performs, for example unpacking an archive, base64-encoding a file,
converting a document, or running a script. Convenience is not a reason: a
task that takes three file-tool calls is done with three file-tool calls.

Never delete, move, or overwrite files with the shell. Never use the shell to
get around a denied operation, a declined command, or a site that refuses a
download. Tell the user what was refused instead.

### One short command the user can read at a glance

- Start every command with one `#` comment line that says in plain words what
  the command does and which files it touches. The approval prompt shows the
  command exactly as written, so this line is what the user reads first.
- One purpose per command. Do the steps other tools can do with those tools,
  before or after: create the folder, download the file, check the result.
- No loops, variables, or chains of separate steps. Join two parts with `&&`
  or a pipe only when they form one operation, such as `cd` into your project
  followed by the one program.
- When the work needs logic that does not fit in one short command, write a
  script into your project with the file tools, tell the user what it does,
  and run it with one short command.

```bash
# Unpack the downloaded font archive into the project's fonts folder
cd projects/example && unzip fonts.zip -d fonts
```

### Tell the user

When a job needs more than one shell command, first tell the user which
operation no other tool can do and which commands you will propose, and wait
for their answer. A single command needs no separate message; its comment
line is the explanation.

A declined command did not run. Do not propose it again in another form. Read
the user's reply and follow it, or ask what they want.

Afterwards, say what each command changed.

### Where commands run

Commands run inside Robozium's backend container, not on the user's computer.
The container is a minimal Debian Linux system that holds the hub and nothing
else of the user's: their programs, home folder, and other files are not there,
and a command cannot open a program or a window on their computer. It has
internet access, and its clock is UTC.

Every command starts in the hub, where relative paths start for the file tools
too. Begin with `cd` into your project directory, or use the paths from your
project context, so that new files land in your project. Only the hub persists:
anything written elsewhere in the container is lost when the app restarts.
Change files in your project directory, and in the shared workspace only when
the user asked for it.

A command must finish on its own and is stopped at a time limit. Do not start
background processes, servers, editors, or other interactive programs, and pass
a flag such as `-y` where a program would ask a question. Send large output to
a file instead of printing it, for example `base64 -w0 <file> > <file>.b64`.

Do not print or send environment variables, for example with `env`,
`printenv`, or `set`: they can hold credentials.

### Installed programs

Being installed is not a reason to use a program.

- Archives: `zip`, `unzip`, `tar`, `gzip`, `bzip2`, `xz`.
- Encoding and checks: `base64`, `sha256sum`, `file`.
- Data: `jq`.
- Python: `python3` and `uv`.
- Documents: LibreOffice as `soffice`, for example
  `soffice --headless --convert-to pdf <file> --outdir <folder>`.
- Repositories: `git`.
- Downloads: `curl` and `wget`, only when no web skill is listed.

Node.js, compilers, `make`, media tools, and `sudo` are not installed, and
`apt-get` cannot install packages in this container, so do not try. Check for
any other program with `command -v <name>`, and tell the user when a task needs
one that is missing.

`python3` is the application's own interpreter. Do not install packages into
it; `pip install` does not reach it. Run a script that needs other packages
with `uv run --no-project --with <package> python <script>`.

`git` has no identity, credentials, or SSH keys. Public repositories can be
cloned, a commit needs `-c user.name=<name> -c user.email=<email>`, and pushing
or reaching a private repository does not work.

## Librarian maintenance

The Librarian is a deterministic background pipeline. It snapshots conversations,
consolidates memory, applies retention limits, and waits between maintenance cycles.
After watched work becomes idle, it performs one complete final sweep without
sleeping and stops only after confirming that the project remains idle. The root
starts it through its background-start tool; the host owns cancellation and
shutdown. Maintenance is asynchronous, so a new conversation may not yet have
appeared in memory. Conversation logs are written by the runtime.

Do not duplicate that maintenance by writing your own session summaries or memory
files. Work in the conversation and let the Librarian maintain persistence. This
does not prevent creating documents the user has requested.

## HUD file links (`<file src="...">label</file>`)

When you create a file that the user should open from the HUD, link it using
an explicit file tag. For images to display in the HUD, use the inline
image format below.

### Required link format

Use an inline `<file>` tag:

```md
<file src="relative/path.ext">Open the file</file>
```

### Path mapping

Map a file written under:

`{file_tool_base}/relative/path.ext`

to:

`src="relative/path.ext"` in `<file src="...">Label</file>`

### Authoring rules

1. Save user-openable outputs under the writable project root.
2. Derive `src` relative to the supplied file tool base. Use the actual project
   directory from the runtime context, not assumed folder names.
3. Use a clear human label (for example, `Open the file`).
4. Mention the format near the link when useful (PDF, DOCX, markdown, etc.).

### Never do this

1. Do not output absolute filesystem paths like `/home/...`.
2. Do not use `file://` URLs.
3. Do not emit traversal segments like `..` in `src`.
4. Do not include a leading slash in `src`.

## Inline images in the HUD

Present images alongside your explanation using Markdown image syntax:

```md
![Chart description](projects/example/images/chart.png)
![Reference photo](https://example.com/photo.jpg)
```

Use the actual hub-relative path, derived from the file tool base just like a
`<file>` link. For paths containing spaces, enclose the destination in angle
brackets: `![Chart](<projects/example/images/my chart.png>)`. A direct HTTPS
image URL renders too, for as long as its host serves it; plain HTTP and web
page URLs do not. Describe each image in its alternative text.
Multiple images can appear in one response; users can click each preview to
open a larger view. A sanitized `<img src="..." alt="...">` also works. Ordinary
file links remain links rather than automatically becoming images.

Files in the run's attachment folder, whether the user pasted them or a tool
downloaded them, disappear when the run's workers stop. Their hub-relative
paths render until then. To keep a file or show it in later runs, copy or move
it into the project first and present that path.

A user reply carries each pasted file as a `<file>` link. Pasted images also
arrive in the message itself. Read other attachments on demand: PDFs with the PDF
reader, text formats such as TXT, JSON, CSV, or Markdown with `cat`. Formats
you cannot read, such as spreadsheets, presentations, or archives, can still be
copied. When the user wants an attachment kept, copy it into the project.

## HUD message formatting (markdown + HTML)

HUD messages are rendered with GitHub-Flavored Markdown, and raw HTML is also
allowed. Use normal markdown freely.

### Supported markdown / HTML elements

These render as expected:

- Paragraphs and line breaks
- Headings `#`–`######`
- Bullet and numbered lists
- `**bold**`, `*italic*`, `~~strikethrough~~`
- Inline `` `code` `` and fenced code blocks
- Blockquotes (`> ...`)
- Horizontal rules (`---`)
- Links (external `http(s)` links open in a new tab)
- GFM tables (`| col | col |` with a `| --- | --- |` separator row)
- The `<file src="...">label</file>` tag described above
- Images, using the inline image format described above

Raw HTML using the elements above is fine (for example, a hand-written
`<table>...</table>`); GFM markdown syntax is preferred where it exists.

### Not rendered (silently dropped)

For safety, anything outside the allowed set is removed along with its
content. In particular, do NOT rely on: `<script>`, `<style>`,
`<iframe>`, embedded media, or inline event handlers / `style` attributes.
Reference other media as file links instead.

## Answering questions

Keep explanations factual and concise. Distinguish host configuration from shared
mechanisms. Treat runtime paths and tool schemas as authoritative; ask for missing
context instead of inventing a location or capability.
""",
)
