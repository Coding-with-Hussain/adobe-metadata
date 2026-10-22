# MetadataGen Gemini

A batch tool for stock contributors. Drop in photos, vectors or video clips, let
Google Gemini draft a title, description and ranked keywords for each file,
review and edit every field, then download a CSV for your marketplace.

## Scope

What it does:

- Batch upload (drag and drop or file picker) with per-file validation: extension, MIME type, file signature, size, empty files, duplicates, video duration.
- One Gemini request per asset with bounded concurrency, so a failure only affects that file. Transient errors are retried with backoff; permanent ones are not.
- Structured JSON output from Gemini, validated locally. Limits and keyword rules are then enforced in code, not just requested in the prompt.
- An editor for every result: title, description, keyword chips (add, remove, reorder, de-duplicate), optional category, regenerate, revert edits, mark reviewed.
- CSV export built in the browser: Generic CSV (stable) and Adobe Stock (beta), with a pre-export validation report.

What it does not do: upload or submit anything to a marketplace, store media or
results on the server, have accounts or history, decide whether an asset is
AI-generated, editorial or released, or guarantee acceptance or sales.

## Requirements

- Node.js 20.9 or newer (developed on Node 22) and npm 10.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). This is only needed for AI generation. Filename-only mode works without one.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4,
the official `@google/genai` SDK, Zod, Vitest and Testing Library.

## Setup

```bash
npm install
cp .env.example .env.local     # then set GEMINI_API_KEY
npm run dev                    # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

### Configuring Gemini

Set these in `.env.local` locally, or in your host's secret settings. They are
read on the server only. Never prefix them with `NEXT_PUBLIC_`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required for AI generation. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model ID. |
| `GEMINI_ALLOWED_MODELS` | `gemini-3.6-flash,gemini-3.5-flash` | Server allowlist. `GEMINI_MODEL` must be in it. |
| `GEMINI_THINKING_LEVEL` | model default | `minimal`, `low`, `medium` or `high`. Lower is faster and cheaper. |
| `GEMINI_REQUEST_TIMEOUT_MS` | `120000` | Time budget per asset. |

`.env.example` lists the media limits and spend guards as well.

About the default model: when this was built (2026-10-22), Google's model list
showed `gemini-3.6-flash` as stable. It is also described as replacing
`gemini-3.5-flash`, which Google now routes to 3.6. Model IDs change often, so:

1. Check the [Gemini models page](https://ai.google.dev/gemini-api/docs/models).
2. Set `GEMINI_MODEL` and add the ID to `GEMINI_ALLOWED_MODELS`.
3. Click **Test** in the app's top bar.

The test looks up the configured model with `models.get`, which uses no tokens.
It reports one of three states: **Connected**, **Not configured**, or
**Connection error**. A connection error comes with a plain-language reason:
invalid key, model unavailable, quota or rate limit, or Gemini temporarily down.

## How it works

```
browser                                   server (Next.js route handlers)            Google
───────                                   ───────────────────────────────           ──────
validate file (ext, MIME, magic bytes,
size, duplicates, duration)
prepare analysis copy (SVG→PNG, PNG
background, downscale >7 MB)       ──►    POST /api/metadata/generate
BatchRunner: 3 at a time, retries         validate fields + bytes, rate limit  ──►  generateContent
transient errors, pauses on config        (videos > 14 MB: Files API upload,         (JSON schema)
errors / offline                          wait ACTIVE, delete afterwards)
                                   ◄──    parse + Zod-validate + normalize
review/edit, export CSV in browser
```

API routes:

- `GET /api/health`: app status, whether a key is configured, the model ID and the effective media limits. It never returns secrets.
- `POST /api/gemini/test`: a token-free connection test. It returns only safe status fields.
- `POST /api/metadata/generate`: takes one asset as multipart form data. Fields: `assetId`, `filename`, `settings` (JSON), `file`, and `derived`. Returns `{ ok: true, result }` or `{ ok: false, error: { code, message, retryable } }`. Raw provider messages are never returned.

The provider code lives in one place, `lib/gemini/`: the SDK adapter, prompt
builder and error mapper. It uses `ai.models.generateContent` with
`responseMimeType: "application/json"` and `responseJsonSchema`. Google's docs
now also describe a newer Interactions API. `generateContent` is still part of
the SDK, but it is the place to change if Google retires it.

## Media support and limits

| Type | Selected file limit | Sent to Gemini as |
| --- | --- | --- |
| JPEG, PNG, WEBP | 50 MB | The original, or a 2048 px JPEG/PNG copy if over 7 MB. PNG transparency can be flattened onto white or black (analysis copy only). |
| SVG | 5 MB | A PNG rendered in the browser via `<img>` (no scripts run), in colour or as a lossy silhouette. |
| MP4, MOV | 100 MB, 5 min | Inline up to 14 MB, otherwise uploaded through the Files API and deleted after analysis. |

Other caps: 100 files per batch and 3 concurrent requests per tab. All of these
can be changed with the environment variables in `.env.example`. The UI shows
whatever the server reports from `/api/health`.

AI, EPS and PDF files are not supported.

If you deploy behind a platform with a small request-body limit, large videos
will fail there. Vercel functions, for example, accept about 4.5 MB. Lower
`MAX_VIDEO_MB` or self-host.

## Generation rules (enforced in code)

- **Length:** counted in Unicode code points. Text is trimmed at a word boundary where possible and never splits an emoji or accented letter. A strict final check follows. Prefixes and suffixes are kept verbatim, and only the generated text is shortened to fit.
- **Keywords:**
  - Cleaned, then de-duplicated case-insensitively. The first spelling is kept.
  - Generic filler such as "image" and "stock photo" is removed.
  - An exclude term removes every keyword that contains it as a whole word: "dog" removes "dog park" but not "hotdog".
  - Style: `single` (one word each), `double` (exactly two words), or `auto` (one to three words).
  - The list is cut to the requested count. The app never invents keywords to reach the count; a shortfall shows as a warning.
- **Include terms:** added only if Gemini does not report them as inapplicable to the asset. A term Gemini rejects is not added, and the row is flagged for review instead.
- **Filename as title:** the title is the cleaned filename, with camera prefixes, counters and separators removed. Gemini still writes the description and keywords.
- **Filename only:** nothing is sent to Gemini. All fields are derived from filename words, and every row is flagged for review. This mode wins if both options are on.
- **Malformed model output:** gets one corrective retry. If that also fails, the file shows as Failed with a clear reason.
- **Statuses:** a row is **Ready** when it has no errors and no unreviewed flags. Otherwise it is **Needs review**. Rows with errors are left out of exports and listed in the pre-export report.

## Export profiles

See [docs/marketplace-profiles.md](docs/marketplace-profiles.md) for sources and details.

- **Generic CSV** (stable, `metadatagen-generic/1`): columns `filename,title,description,keywords,category`. The keyword format is selectable; semicolon is the default.
- **Adobe Stock** (beta): columns `Filename,Title,Keywords,Category,Releases`. Built from Adobe's contributor help pages as of 2026-10-22, which were read through search excerpts because Adobe's site was unreachable from the build environment. Category and Releases come only from what you type into each row.
- **Vecteezy, 123RF, Freepik, Pond5, Depositphotos, Canva, iStock:** listed as "schema needs verification", with export disabled. Use Generic CSV for these.

All CSVs follow RFC 4180, use UTF-8 and CRLF line endings, and are built in the
browser. Cells that start with `=`, `+`, `-` or `@` get a leading apostrophe by
default to block spreadsheet formula injection. You can turn this off.

## Privacy

- Nothing leaves the browser until you click **Generate**. Before that, the page tells you what will be sent.
- After you click Generate, each file goes to Google Gemini through this app's server, along with its filename (as a hint) and your settings. Some files are replaced by an analysis-only copy first, as described in the media table.
- Large videos uploaded through the Files API are deleted right after analysis, whether it succeeds or fails. Google also deletes Files API uploads after 48 hours. How Google retains API data is governed by the Gemini API terms of the key owner's account; this app cannot change that.
- The server keeps no media, prompts or results. Its logs contain only error codes and redacted, truncated provider messages: no media, no prompts, no filenames, no keys.
- Results exist only in the browser tab. Settings are kept in `sessionStorage` for the session.
- The API key stays on the server. A production build was checked to confirm the client bundle contains no SDK code and no key value.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Vitest unit, API and component tests. Gemini is mocked, so no key or network is needed. |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

### Checking against the real Gemini API

The automated tests never call Google. To try the real API:

1. Set `GEMINI_API_KEY` in `.env.local` and run `npm run dev`.
2. Click **Test** in the top bar. It should show *Connected*.
3. Add one JPEG, one SVG and one short MP4, then click **Generate**.
4. Confirm each row has a title, description and keywords, and download a Generic CSV.

## Project layout

```
app/                      page, layout, API route handlers
components/               workspace, drop zone, queue, settings, results, keyword editor, export panel
lib/config/               shared limits (client-safe) + server-only env parsing
lib/gemini/               SDK adapter, prompt builder, error mapping (server-only)
lib/metadata/             settings + result schemas, text/keyword/filename rules, validation
lib/media/                file signatures, file validation, browser analysis copies
lib/queue/                batch runner, asset state reducer, per-asset client processing
lib/export/               CSV writer, profiles, export report
lib/server/               rate limiting, redacting logger
tests/                    unit, api (mocked Gemini) and component tests
docs/                     marketplace profile verification notes
```

## Known limitations and next steps

- **Not run against the real Gemini API.** This build only exercised the full flow through the official SDK against a local mock (via `GOOGLE_GEMINI_BASE_URL`), because no key was available. Run the manual check above before relying on it.
- **Adobe Stock profile is beta.** Confirm it against the live contributor portal, and add a verified category picker.
- **Other marketplace profiles are disabled** until their templates are verified.
- **Spend guards are per process.** Rate limits and the daily cap live in memory. Serverless or multi-instance deployments need a shared store.
- **The `x-forwarded-for` header is trusted for per-client rate limiting.** Run behind a proxy that sets it.
- **Video duration depends on the browser.** It is read in the browser. If the browser can't decode the codec (some MOV files), only the size limit is checked.
- **Upload progress is not shown.** Large uploads show the stage, not a percentage.
- **Nothing persists.** Closing the tab discards results, though the page warns first.
