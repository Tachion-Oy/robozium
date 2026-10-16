# Image reply API

Robozium accepts images in replies to an active run prompt. This backend contract
uses the published RoboZ package pinned in `pyproject.toml` and Shed's existing
filesystem skill.
Paste/drop controls and browser previews are separate frontend work.

## Capabilities

`GET /models` (including `?run_id=...`) returns `accepts_images` on each model.
`GET /run/{run_id}` returns `current_prompt_accepts_images`, which is false when
there is no active prompt. It describes the receiving agent's current endpoint,
including specialists, and may change when a model changes. Conversational prompts
(including initial, interruption, and retry prompts) explicitly allow images through
RoboZ's user-I/O contract; filesystem and other permission prompts remain
text-only. Once images enter a run through replies or file tools, it can switch
between image-capable orchestrator models, but cannot switch to a text-only model.

## Submitting a reply

`POST /run/{run_id}/reply` preserves JSON replies:

```json
{"prompt_id": "active-prompt-id", "content": "Continue"}
```

For JSON, `prompt_id` remains optional and `content` remains required.
For images, send `multipart/form-data` with:

| Field | Type | Requirement |
| --- | --- | --- |
| `prompt_id` | Text | Exactly one active prompt ID; required |
| `content` | Text | Optional; may be empty for an image-only reply |
| `images` | File | Repeated in input order; up to four images |

For example, against the loopback API of a running Docker application:

```sh
curl http://127.0.0.1:8000/run/RUN_ID/reply \
  -F 'prompt_id=PROMPT_ID' \
  -F 'content=Compare these images' \
  -F 'images=@first.png' \
  -F 'images=@second.jpg'
```

The web server forwards the same contract at `/api/runs/{run_id}/reply`.
Successful replies return `{"ok": true}`. Text and all images commit together;
validation failures leave an otherwise-active prompt pending. A stale prompt,
duplicate reply, expired wait, cancelled run, or failed storage reservation is
rejected. Unsupported image submissions and attempts to select a text-only model
after images were accepted return HTTP 400:

```json
{"code": "images_not_supported", "message": "The current prompt or receiving model does not accept images"}
```

Unsupported submissions make no provider request. Other invalid images or fields
return HTTP 400 with a readable `detail`; oversized request bodies return HTTP 413.
Incomplete multipart bodies are rejected, including an incomplete final part.

## Validation and retention

Only nonanimated PNG, JPEG, WebP, and GIF files are accepted. Pillow verifies the
format and decodes the pixels; the uploaded MIME type and filename do not select
the decoder. Limits are four images per reply, 10 MiB per image, 25 megapixels
per image, and 100 MiB retained in temporary storage per run. Multipart bodies
are streamed through a 41 MiB limit before reaching the parser, including chunked bodies; multipart text
fields are bounded to 1 MiB each.

The host writes generated filenames under
`projects/<project>/.robozium-attachments/<run-id>/` (using the configured project
area). Original filenames are escaped display text only. The typed reply carries
ordered image inputs separately from its text and existing `<file src="...">`
links. Those links use `/files/{path}` and the existing hub file-access policy;
there is no attachment lookup or separate preview endpoint.

Live messages retain pixels for provider requests. Public history, SSE, and
persisted conversations contain text and file references, with image lists
cleared or omitted. Librarian snapshots and compaction summaries receive no
embedded image data. The agent can use Shed's `read_images` to inspect temporary
or saved files again after compaction.

Use existing file-copy commands to save images into ordinary project files;
moves also remain available and release their temporary storage. Saved files
survive cleanup. The host removes its reserved run directory after foreground
and background workers stop, including failure and cancellation. Startup recovery
removes abandoned directories bearing the host ownership marker without following
symlinks. Historical temporary links remain provenance and return 404 after the
corresponding files are gone.
