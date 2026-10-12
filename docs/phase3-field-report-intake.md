# Phase 3 Part 1: local field-report intake

`frontend/src/lib/fieldReportIntake.ts` exposes `parseFieldReportFile(file, options)`.
It returns headers, resolved column indices, source row numbers, raw cells,
normalized data, row/file errors, duplicate references and summary counts.
`valid` describes parsing/validation only, never submission or approval.
There are no Supabase imports, ID allocation, network requests or writes.
The current supervisor submission hook and UI are unchanged.

## Input contract

- CSV: UTF-8 (optional BOM), PapaParse, quoted/multiline cells, inferred delimiter.
- XLSX: pinned `read-excel-file` 9.3.12 `/universal` entry point, compatible with
  browsers without Node modules or automatic worker/CSP requirements. XLSX code
  loads only when needed. This maintained, read-only reader has TypeScript types
  and supports typed dates and workbook epochs. `fflate` 0.8.3 is a direct
  dependency for streaming ZIP safety checks (also used by the reader).
- First record/worksheet row is the header. The first sheet is read by default;
  `sheet` can explicitly select a 1-based index or exact name. Sheets are never merged.
- Narrative and report date columns/values are required. Location, reporter and
  discipline remain nullable, matching the existing field-update contract.
  Nothing defaults to today's date, the signed-in user or a fabricated location.
- Header matching ignores case, spaces, hyphens and underscores. Common aliases
  are recognized; ambiguous headers require explicit mapping. `columnMapping`
  maps destination fields to header names or zero-based source indices; optional
  fields may be deliberately ignored with `null`. No index fallback guesses.
- Disciplines match the current capture screen: Piping, Pipeline, Civil,
  Electrical, Mechanical, Instrumentation (case-insensitive, canonical output).
- Date strings default to strict `YYYY-MM-DD`. `dateFormat` may explicitly select
  `DD/MM/YYYY` or `MM/DD/YYYY`. Invalid calendar dates, implicit locale parsing,
  relative dates, timestamps and unformatted Excel serial numbers are rejected.
  Typed XLSX dates use workbook 1900/1904 epochs; time fractions and fictional
  1900-02-29 are rejected. No actual-vs-planned business validation occurs here.
- Duplicate detection compares all five normalized values, without rewriting
  narrative case or meaning. Subsequent duplicates retain their row/evidence and
  receive an error referencing the first row. No database duplicate claim.

## Safety and preview handling

Caps: 2 MiB input, 1,000 data records, 64 columns, 10,000 characters per cell.
XLSX additionally caps 128 ZIP entries, 8 MiB per expanded entry and 16 MiB total
actual expansion. Small streaming chunks limit allocation overshoot; size
declarations alone are not trusted. Only stored/deflated archives are supported.
Incomplete archives, duplicate paths, macros/binary parts, formulas (even cached),
external relationships, XML entities, malformed XML and excessive/sparse worksheet
references are rejected before reading the sheet. All sheets are safety-checked,
even when only one is selected. Export values into a small clean intake workbook
when a report includes unsupported workbook features.

One terminal CSV newline is ignored. Interior/explicit empty report rows remain
visible with errors. File-level failures never return a partially accepted file.
Valid siblings can remain in a preview alongside row errors, but `valid` stays
false until all errors are resolved. Row numbers are 1-based records/worksheet
rows including the header, not physical CSV text lines inside quoted narratives.
Treat raw/narrative strings as untrusted text: render with React text nodes, never
`dangerouslySetInnerHTML`. CSV formula-like text is retained literally and never
executed; any future CSV export needs its own formula-injection protection.

Parsing is bounded but not a hard real-time CPU/memory sandbox. Main-thread ZIP
and XML safety checks can pause a browser on large inputs. A dedicated cancellable
Web Worker is a possible next intake-UI step, not part of the matching worker.

## Migration and next step

`012_field_report_intake.sql` adds nullable `public.field_updates.discipline`
and a separate, idempotent BEFORE UPDATE guard. Non-service-role sessions cannot
change discipline, including NULL-to-value and value-to-NULL transitions; the
existing JWT service-role maintenance exception remains. The original-submission
trigger is unchanged. No default, backfill, index, RPC, grant, RLS or schedule
mutation. Prepare only; do not execute it for parser tests.
Existing rows/manual submissions can omit the column. Existing table permissions
still apply. Future persistence must also enforce intake checks server-side;
client validation is not an authorization gate.

## Part 2: local import workspace

Inside **New field update**, the lower-left **+** attachment button offers
**Import Excel / CSV**, labelled **Multiple field reports**. There is no standalone
import entry on Site Log home, and the normal text submission control is separate.
The full-width workspace is Choose file → Map columns → Review & correct.
Existing account/history/compose behavior is unchanged. Back preserves the chosen
file and corrections. Changing mappings/date order or choosing another file
clears corrections, as stated in the UI. Cancel or the first-step return link
discards the import preview and returns to the composer with its unsent narrative,
date, site, discipline and reporter untouched. Header navigation also discards the
preview. No browser persistence, file upload, database call or import-success state.

Known aliases are auto-detected; ambiguous fields require explicit selection.
Required narrative/date fields cannot be skipped; optional columns may be omitted.
Date order is explicit, with no locale guessing. XLSX reads the first sheet only.
Review shows source row numbers, total/valid/invalid/duplicate counts (duplicates
are a subset of invalid), filters and 25-row pages. One responsive edit layout
becomes mobile cards or a desktop grid, without rendering duplicate controls.

`revalidateIntakePreview()` reuses the parser's row validator on every edit,
recomputes all duplicates and retains original raw cells. Values can be corrected;
structural CSV row errors require fixing the source file. File/header/archive
errors cannot be cleared by row edits. All values render as plain text. Late
parses after selection/mapping changes or unmount are ignored. Step headings get
keyboard focus; cancelling restores focus to the composer + button. The single-item
attachment menu supports keyboard opening, Escape, focus-away and outside-click
dismissal; it cannot submit the ordinary text form.

### UI verification

Run `npm run dev` in `D:\SETU-phase3\frontend`, then use the existing supervisor
sign-in and open `/supervisor/capture` → New field update → + → Import Excel / CSV.
Enter a draft first and verify Cancel/return preserves every field. No new
authentication bypass is provided.
Check widths of 390 px and 1440 px, keyboard-only controls and 200% zoom.
Use this synthetic local CSV (no submission):

```csv
Narrative,Location,Date,Reporter,Discipline
Rack B welding completed,Rack B,2026-10-11,R. Das,Piping
Rack B welding completed,Rack B,2026-10-11,R. Das,Piping
Foundation work started,Area A,2026-02-29,S. Das,Mining
```

Expect 3 total, 1 valid, 2 needing correction and 1 duplicate. Change row 3's
narrative and correct row 4's date/discipline: all 3 become valid **locally**.
Check Back, optional mapping omission, Change file, Cancel, account/home navigation,
unsupported `.xls`, oversized files and malformed/unsafe XLSX. Required fields
have labels, invalid state and linked error explanations. Verify no network write
occurs and no active Confirm Import control exists. Existing Site Log hooks may
still perform their normal reads independently of this local wizard.

Next: Part 3 needs secure, explicit submission with server-side validation,
cross-upload idempotency, authorization and honest partial-failure handling.
Neither local validity nor the parser is an authorization gate.
