# Marketplace CSV profiles: verification notes

Profiles live in `lib/export/profiles.ts`. Each one is a self-contained adapter
that declares its column order, field mapping, keyword serialization, limits,
per-row user inputs, validation rules and a schema/source note. Exact-output
tests are in `tests/unit/export.test.ts`.

Checked on **2026-10-22**. The build environment could not reach Adobe's or
Google's sites directly (egress proxy), so verification relied on search-engine
excerpts of the official pages. Re-check before relying on any profile.

| Profile | Status | Export | Source |
| --- | --- | --- | --- |
| Generic CSV | Stable | Enabled | This app's own format (`metadatagen-generic/1`) |
| Adobe Stock | Beta | Enabled | Adobe Stock contributor help (see below) |
| Vecteezy | Unverified | Disabled | — |
| 123RF | Unverified | Disabled | — |
| Freepik | Unverified | Disabled | — |
| Pond5 | Unverified | Disabled | — |
| Depositphotos | Unverified | Disabled | — |
| Canva | Unverified | Disabled | — |
| iStock | Unverified | Disabled | — |

## Generic CSV (`metadatagen-generic/1`)

- Columns: `filename,title,description,keywords,category`.
- Keywords in one cell. Format is selectable: semicolon (`fox; snow`, default),
  comma, pipe or JSON array.
- RFC 4180 quoting, CRLF line endings, UTF-8 (optional BOM).
- Formula guard (on by default): cells starting with `=`, `+`, `-`, `@`, or a
  tab/CR (after optional leading whitespace/control characters) get a leading
  apostrophe.

## Adobe Stock (beta)

Sources (official Adobe help, read via search excerpts):

- “Create CSV files for Adobe Stock”:
  `helpx.adobe.com/stock/contributor/manage-your-portfolio/create-csv-file.html`
- “CSV requirements”:
  `helpx.adobe.com/stock/contributor/manage-your-portfolio/csv-requirements-content.html`
- Sample file: `contributor.stock.adobe.com/static/csv/Sample_Adobe_Stock_CSV_upload.csv`
  (header row reported as `Filename, Title, Keywords, Category, Releases`; the
  file itself could not be downloaded here).

What the adapter does:

- Header: `Filename,Title,Keywords,Category,Releases` (exact, untranslated).
- Filename: the original filename, unchanged.
- Title: the reviewed title. Warning above 70 characters (Adobe's recommendation).
- Keywords: comma-separated in one quoted cell, in relevance order. More than 50
  is an error.
- Category: **only** what the user types in the per-row “Adobe category #” field.
  Must be a whole number. The model's free-text category is never mapped to an
  Adobe number because the numbered list could not be verified.
- Releases: **only** what the user types. Never inferred.
- No description column (Adobe's CSV does not have one).
- File-level warnings above 5,000 rows or 1 MB.
- Filenames longer than 30 characters get a warning (mentioned in Adobe's guide).

Open questions to confirm against the live portal: the exact title limit, whether
a BOM breaks header matching (BOM is off by default), and the category number list.

## Unverified destinations

Vecteezy, 123RF, Freepik, Pond5, Depositphotos, Canva and iStock appear in the
selector so users can see they are known, but export is disabled. Their current
contributor CSV templates could not be confirmed from official documentation
during this build, and guessing a schema could get uploads rejected or mapped
wrongly. Use Generic CSV in the meantime.

### Adding a verified profile

1. Get the official template or documentation and record its URL and the date.
2. Add an `ExportProfile` in `lib/export/profiles.ts` with `status: "beta"` or
   `"stable"`, `enabled: true`, the exact `header`, `toCells`, `validateRow`,
   any `fields` that need explicit user input, and `maxRows` / `maxBytes` if
   documented.
3. Add exact-output tests (commas, quotes, Unicode, blank optional fields) to
   `tests/unit/export.test.ts`.
