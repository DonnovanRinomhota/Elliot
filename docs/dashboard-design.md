# Dashboard design rules

The dashboard has one look. Keep to these rules when adding or changing a
screen, so it doesn't drift back into many colours and one-off styles.

## Colour: four, each with one job

| Token | Hex | Used for |
|---|---|---|
| `ink` | `#13223A` | Text, primary buttons, active navigation, chart bars, "confirmed" / "converted" |
| `gray-*` | Tailwind greys | Backgrounds (`#F5F6F8` page, white panels), borders, secondary text |
| `brass` | `#9A7328` | Waiting on you: pending approvals, warm leads, auto-enrol |
| `alert` | `#B42318` | Urgent or destructive: escalations, hot leads, cancel, reject, errors |

There's no green, blue or purple. Success uses `ink`. Each token has a
`-soft` background and a `-dark` text shade (see `tailwind.config.ts`).
Charts use shades of ink only (`#13223A`, `#7D8BA3`, `#C9D1DE`).

## Type

IBM Plex Sans (400/500/600), bundled with the app via
`@fontsource/ibm-plex-sans`, so no request to Google Fonts. Numbers in
tables and stats use the `tabular` class so digits line up.

| Use | Size |
|---|---|
| Page title | 22px semibold |
| Panel / card title | 14-15px semibold |
| Body, table cells | 13-14px |
| Help text, meta | 12-13px (never smaller than 12px) |

Sentence case everywhere: "Hot", not "HOT"; "Approve and send", not
"Approve & Send". No all-caps labels.

## Building blocks (`app/_ui/ui.tsx`)

- `PageHeader`: title, one-line description, actions on the right.
- `Panel`: white bordered section with an optional titled header.
- `StatusBadge kind="lead|appointment|escalation|draft|conversation"`: one
  mapping from status to colour, so the same word always looks the same.
- `btn.primary / secondary / danger / dangerGhost / ghost` (+ `btn.small`).
- `EmptyState`, `Notice`, `ErrorText`, `FilterDescription`.
- `humanize()`, `timeAgo()`, `formatDate()`.

Lists that people scan (leads, appointments, conversations) are tables:
one row per item, a grey header row on desktop, stacked on phones. Shared
column layouts live in a plain `grid.ts` next to the page, because a
`"use client"` file can't pass plain values to a server component.

## Don'ts

- No coloured icon bubbles or decorative icons. Navigation icons only, in
  grey.
- No inline `style={{…}}` for colour or spacing; use the tokens.
- No hover lifts or shadows on cards.
- Developer details (workflow numbers, file paths, env var names) don't
  belong in on-screen text; put them in the docs.
