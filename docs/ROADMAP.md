# Inkwell – roadmap (next iteration)

Captured ideas for the next work session. Nothing here is built yet unless stated in the README.

## 0. Page format and page breaks (requested next)
- Default page size **A4** (210 x 297 mm; today's pages are 820 x 1160 units, about A4 ratio) with real **page breaks**: content flows onto separate pages, not one continuous scroll. This applies to ink pages and to the typed-text view (paginate typed text into A4 pages with margins, headers/footers and page numbers).
- Options per note (and defaults in Settings > Editor): page size (A4, A3, A5, B5, Letter, Legal, Tabloid, custom width x height with mm/in/px), orientation, margins (narrow, normal, wide, custom), page numbering, header/footer text, and **break mode**: *Paged* (default) or *Continuous* (infinite-style).
- Page breaks: automatic when text overflows the page, manual break (`Ctrl+Enter` or "Insert page break"), "keep with next" for headings, widow/orphan control, "break before" for H1; visible break guides and a page indicator.
- PDF export must match the on-screen pagination exactly (what you see is what you export); imported PDFs keep their own page size.
- Convert between formats without losing content (reflow typed text, scale ink pages to the new size).

## 1. Premium typography
- UI font: a premium variable sans (candidates: Inter Variable, Geist, Manrope or Plus Jakarta Sans) and a refined serif for titles (e.g. Source Serif 4, Fraunces or Newsreader). Self-host the files (woff2, subset, `font-display: swap`) so they work offline and need no CDN; precache in the service worker.
- Handwriting set for the editor and templates: Caveat, Kalam, Patrick Hand, Nanum Pen Script, Shadows Into Light, Homemade Apple, Reenie Beanie, plus a signature font. All SIL OFL / open licences only; record each licence in `docs/FONTS.md`.
- Mono for code and ledgers (JetBrains Mono or IBM Plex Mono); a numeric tabular font setting for accounting tables.
- Type scale tokens, optical sizes, tight tracking on headings, proper line-height rhythm; font picker with previews, favourites and user-uploaded fonts (already stored as assets).

## 2. Premium icons and emoji
- One consistent icon family replacing the hand-rolled SVGs (candidates: Phosphor, Lucide or Tabler, all MIT); tree-shaken inline SVG sprite, duotone variants for active states.
- Emoji: bundle an open emoji set (Noto Emoji or Twemoji) as lazy-loaded sprites so emoji look identical on every device; searchable emoji picker with skin tones, recents and custom stickers; emoji as notebook/page icons and callout icons.
- Sticker and washi-tape packs (own artwork or CC0).

## 3. Notion-style features
- Block-based typed notes: slash menu (`/`), drag handles, nested blocks, toggles, callouts, quotes, dividers, code blocks, equations, columns.
- Databases: table, board (kanban), list, calendar and gallery views over notes, with properties (text, number, select, multi-select, date, checkbox, URL, relation, formula) and filters/sorts/groups; templates for new rows.
- Linked pages and `@mentions`, backlinks graph, page properties, synced blocks, bookmarks, breadcrumbs, favourites sidebar, page nesting (sub-pages), full-width and small-text options.
- Web clipper style "paste a link" to rich bookmark cards; markdown shortcuts and import/export-to-PDF only (export rule stays PDF).

## 4. Touch and every-screen native feel
- Pointer-event first design: stylus (pressure, tilt, barrel button, hover, double-tap/squeeze), finger and mouse all supported; palm rejection modes; Apple Pencil double-tap mapping; Samsung S-Pen button mapping.
- Gestures: two-finger tap undo, three-finger tap redo, three-finger swipe, pinch-zoom with inertia, long-press menus, edge swipes, pull-to-refresh, haptics.
- Layout tiers: phone (bottom bars, thumb-reach toolbars, bottom sheets), foldables, tablet portrait/landscape (split view, Stage Manager-style resizable windows), desktop (three panes, menus, shortcuts, right-click, drag and drop, multi-window).
- Keyboard-only and screen-reader paths; high-contrast; large text; RTL support.
- Performance budgets: 60 fps ink, input latency target < 20 ms, cold start < 1.5 s on mid phones, lazy-loaded modules.

## 5. Rich content handling
- Images: paste, drag, camera, crop, rotate, mask, annotate, alt text, compression pipeline.
- Video and audio: local files, embeds, timestamps linked to notes, picture-in-picture.
- Documents: PDF (done), plus DOCX/PPTX/XLSX import via conversion to PDF where feasible, text/markdown/CSV import; file attachments with preview.
- Embeds: expand provider list, oEmbed-style link cards, sandboxed with click-to-load (existing), offline placeholders.
- Web links: link previews (title, favicon, image) fetched server-side through a safe proxy with SSRF protection; reader-mode clips.
- Lists: bullets, numbered, checklists, nested, reorder, progress bars, due dates and reminders.
- Drawings and shapes: keep expanding sketch mode (minimap, smart guides, true infinite canvas, layers, boolean ops, stencils).

## 6. Easy to adopt
- First-run tour, interactive tips, sample notes per persona (student, CA aspirant, professional), template gallery with previews, command palette hints, contextual empty states, undo everywhere, searchable help.
- Progressive disclosure: simple default toolbar, "More" for power tools; presets for beginners vs power users.

## 7. CA aspirants, students and professionals – gaps to fill
CA aspirants
- Full ICAI scheme structure (Foundation, Intermediate, Final; groups, papers) with editable chapter weightage and attempt planner; RTP/MTP/past paper trackers; exam-day timetable generator; reading-hours vs syllabus completion forecast.
- Quick-reference cards for sections, standards (AS/Ind AS, SA, SQC), case laws, amendments with "applicable for attempt" tags and amendment diff notes.
- Tools: journal/ledger/trial balance builders, working-note paper, depreciation and ratio calculators (exist), plus bank reconciliation, partnership/consolidation worksheets, GST and TDS calculators with rate tables, tax computation sheets, audit checklists, interest/penalty calculators, cost sheet and variance templates, time-value tables.
- Practice: MCQ and descriptive question banks the user fills, timed mock mode with OMR-style sheet, answer-writing practice with timer and self-marking rubric, mistake notebook with retry queue (exists), revision calendar (1-3-7-21) (exists), flashcard decks with import/export.
- Wellbeing: focus sessions (exist), streaks, break reminders, sleep/study balance charts.
Students
- Timetable, assignments and deadlines, grade tracker/GPA calculator, lecture mode (audio plus notes), citation helper, whiteboard for group study, shared notebooks for classes.
Professionals
- Meeting notes with agenda, action items and owners, task extraction to a to-do database, client/project notebooks, time-tracking, invoice and expense templates, signatures and stamps, review/approval workflow on shared notes, audit trail, templates for engagement letters, working papers and checklists, calendar integrations.
- Organisation features: workspaces/teams, roles per workspace, SSO (OIDC/SAML) option for commercial mode, retention policies.

## 8. Platform and quality backlog
- Finish untested areas: PDF export output, audio recording, voice, touch gestures, font import, OCR, embeds, offline-PDF, full backend test suite; add Playwright end-to-end tests and CI.
- Sync CA Study Hub data across devices; settings sync (adapter in place).
- Build the unfinished editor items: layers, minimap, smart guides, true infinite canvas, protractor/compass, function plotter, table cell editing, image crop.
- Alternative backends via the adapter (Supabase, Firebase, WebDAV); optional Docker setup; Postgres support.
- Accessibility audit, i18n scaffold (Hindi, Nepali, others), performance profiling on low-end phones.
