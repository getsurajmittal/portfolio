# CLAUDE.md

"The Gazette": Suraj Mittal's portfolio, presented as a newspaper. It's a plain static site with **no build step, no package.json, no tests and no dependencies to install**. It's hosted on GitHub Pages at surajmittal.in (see `CNAME`). The README is the user-facing setup guide (GitHub Pages, token, press pass), so read it only if you need setup details.

Run locally: `python -m http.server` in the repo root, then open http://localhost:8000. Opening `index.html` from disk (`file://`) won't work, because the browser blocks it from fetching `content.json`.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | Public newspaper. `app.js` renders everything from `content.json`. |
| `content.json` | **The single source of all paper content** (public). |
| `resume.js` | Builds an ATS résumé from content.json. `window.Resume.{model,html,print,docx,docxFile}`. Loads `docx@8.5.0` from jsDelivr only when needed. |
| `office/` | Private "Back Office" (`noindex`, disallowed in `robots.txt`). |
| `office/session.js` | Shared auth plus GitHub client: `window.Office.{Vault,Session,GH,b64enc,b64dec}`. |
| `office/index.html`, `office.js`, `office.css` | Login/setup, hub and **Notebook** tool (hash-routed SPA). |
| `office/desk/` | **Editor's Desk**: a form UI that edits content.json and commits it to GitHub. It also reuses `../../styles.css`. |
| `images/` | Photos uploaded from the Desk (`images/.gitkeep`). |
| `.nojekyll` | Required for GitHub Pages. Don't remove it. |

## Code conventions

- Vanilla ES5-style JS: each file is an IIFE with `'use strict'`, uses `var` and `function`, and has no modules or frameworks. Keep new code in that style.
- `$ = id => document.getElementById(id)`. Rendering is string-built `innerHTML`, so **always pass user content through the local `esc()`** (each file has its own copy). `app.js` also has `safeUrl()` for links.
- Text with paragraphs is split on blank lines (`paras()`).
- Dates are ISO strings (`YYYY-MM-DD`), and lists are sorted newest first with `String(b.date).localeCompare(a.date)`.
- localStorage keys all use the `gz-` prefix: `gz-theme`, `gz-last` (for the "Extra! Extra!" card), `gz-preview` (Desk preview → `index.html?preview`), `gz-next`, `gz-office-vault`, `gz-office-session`. Wrap storage access in try/catch.
- Fonts come from Google Fonts: Playfair Display, Old Standard TT, Libre Caslon Text, Libre Franklin and Courier Prime (office only).
- User-facing copy keeps a newspaper voice ("Publish edition", "press pass", "The Morgue") and uses British spelling (honour, organisation).

## content.json schema

Top-level keys are `site`, `entries`, `skills`, `letters` and `corrections`.

- `site`: `name, surname, city, role, field, pronoun, profile, summary, onDesk{studying,reading}, contact{email,phone,linkedin,github,website}, accent`.
- `entries[]`: one per "story". `type` is one of `certification | course | project | role | education | column | honour`.
  - Common fields: `id` (slug + random suffix), `title, org, date, endDate, location, deck, body, link, linkLabel, image, imageCaption, headline, onResume`.
  - Fields for specific types: `credentialId` (certification, course), `bullets[]` (role, project), `excerpt, minutes` (column), `featured` plus `case{problem,approach,result,quote,stats[{value,label}]}` (project).
  - The field definitions for each type live in the `F` array in `office/desk/desk.js`, which also controls which fields show for which type. Update it when adding a field.
- `skills[]`: `{name, group, years, trend, history[]}`. `history` holds numbers, oldest first, used for the sparkline.
- `letters[]`: `{quote, name, title, company}`.
- `corrections[]`: plain strings.

## Posts (The Column / blog)

- Two sections: `section: "tech"` → **From The Column** (red) and `section: "life"` → **Life & Times** (green, `--life`). A missing section counts as tech.
- Public files in the website repo: `posts/index.json` = `{"posts":[{slug, section, title, date, updated, excerpt, tags[], minutes}]}` and `posts/<slug>.json` = the same fields plus `body` (Markdown). `slug` must match `^[a-z0-9][a-z0-9-]{0,80}$`. `life` and `tech` are reserved (they are A3 anchors). A missing index means there are no posts.
- Only **published** posts belong in these files. Posts marked `"sample": true` are placeholders added to fill the strips; they have no notebook page behind them, so remove them by deleting their file and their index entry. Design doc: https://claude.ai/artifact/JFXQ6znkAPFRzzU3WXbf8p
- `app.js`: `loadPosts` runs after boot. `renderStrip` draws two strips below the fold on A1 (`#strip-tech`, `#strip-life`; the life strip drifts the other way). A strip only drifts when its cards overflow it, and pauses on hover, focus or its `.strip-pause` button. A3 lists tech posts (plus legacy `column` entries), then Life & Times. `#A3/life` and `#A3/tech` scroll to a section, and `#A3/<slug>` renders one post (`renderPost`).
- `md()` / `inlineMd()` render a small Markdown subset after escaping everything: paragraphs, `##`/`###`, lists, `>` quotes, fenced and inline code, bold, italic, links and images (URLs go through `safeUrl`). Never let raw HTML through.
- Posts are **not** editions: they don't lead A1, don't appear in the ticker and don't appear in the Morgue.
- **Publishing happens from the Notebook** (`office/office.js`, "publishing a page as a post"):
  - Publish writes `posts/<slug>.json` first, then the index (`updateIndex` retries once on 409).
  - Unpublish removes the post from the index first, then deletes the file.
  - The notebook page keeps `post: {slug, section, title, excerpt, tags, include[], date, updated, live}`. The slug is fixed after the first publish, and a live page can't be deleted.
  - The post body is the ticked entries' text joined by blank lines.

## Notebook data (private repo)

`pages/YYYY-MM.json` = `{v: 2, days: {"YYYY-MM-DD": {pages: [{id, title, tags[], entries[{t, text}], post?}]}}}`. A day holds several pages. Old v1 days (`{title, tags, entries}`) are read as one page with id `p1` (`normDay`) and saved back as v2. Routes: `#page/<date>` opens the day's latest page, `#page/<date>/<id>` opens a specific page, and `#page/<date>/new` starts a new page. A new page is only added to the day on its first edit.

## How the paper renders (app.js)

- Every entry is an "edition", sorted newest first. The newest is the A1 lead story, and ◀ Back issue steps through older ones.
- The pages are hash-routed: `#A1` Front Page, `#A2` Features, `#A3` Opinion, `#B1` The Record. They're defined in the `PAGES` array, and routes can carry a sub-path such as `#A2/<id>`.
  - A1: lead story, profile, letters carousel. Below the fold: role and education ("From the Archives"), certifications and courses ("Public Notices"), skills ("Skills Market").
  - A2: projects and `featured` entries as case studies.
  - A3: columns and corrections.
  - B1: scoreboard counts, honours, and "The Morgue" (every edition, grouped by year).
- Masthead ears: the left one is an analog clock showing Bangalore time (`startClock`, sweeping second hand, ticks once a second with reduced motion). The right one shows "Last updated" (`renderLastUpdated`): the newest of `content.json` `site.updatedAt` (stamped by the Desk on publish) and `posts/index.json` `updatedAt` (stamped by the Notebook on publish/unpublish), falling back to the newest entry or post date.
- The LATEST ticker scrolls at a steady ~60 px/s (`fitTicker` repeats short news to fill the bar). It shows only career and certification news: `TICKER_TYPES` = role, certification, course, honour. It shows the 6 newest, in sentence case (`tickerLine`), and hides itself when there are none.
- Certifications from the last 45 days get a NEW stamp. There's also a night theme toggle.

## Résumé (resume.js)

It includes entries where `onResume !== false`, grouped as Experience (role), Projects, Certifications (certification and course), Education and Awards (honour). Skills are grouped by `group`. Bullets come from `bullets[]`, or fall back to the first 3 paragraphs of `body`.

## Back Office and auth (office/)

- **No server.** The browser talks directly to the GitHub Contents API with a fine-grained PAT.
- `Vault`: the config `{owner, branch, siteRepo, notebookRepo, token}` is encrypted with AES-GCM, using a key derived via PBKDF2-SHA256 (310k iterations) from the "press pass", and stored in localStorage.
- `Session`: the unlocked config, kept in sessionStorage, or also in localStorage if "keep me signed in" is ticked. The Desk redirects to `../` if there's no session.
- `GH`: `getJSON`, `list`, `put`, `putJSON`, `del` and `repoInfo`. Writes need the file `sha`, and 409/422 means a conflict.
- **Notebook** data lives in a separate **private** repo (`notebookRepo`). The format is under "Notebook data" above. It autosaves about 1.5s after you stop typing, with saves chained per month, and on a sha conflict it re-fetches and merges the days you touched.
- **Desk** publishing commits `content.json` to `siteRepo` with the message `Edition: <last 3 changes> (date)`. Image uploads go to `images/`.
- Adding a new utility: create `office/<tool>/`, load `../session.js`, store its data in a private repo, and add a card on the hub in `office/index.html`. The hub already has a "Next utility" ghost card for this.

## Gotchas

- **Bump the asset version on every JS/CSS change.** `index.html`, `office/index.html` and `office/desk/index.html` load local scripts and styles as `file.js?v=YYYYMMDDx`. GitHub Pages lets browsers cache files for 10 minutes, so without a new `?v=` a visitor can get new HTML with old JS (for example, buttons that do nothing). Use one value across all three pages and change it in the same commit.
- **The live site edits itself.** Commits starting with `Edition:` and image uploads are made by the Desk, straight to GitHub `main`. Before editing `content.json` (or anything else) locally, `git pull` so you don't clobber or conflict with Desk publishes.
- `content.json` is public, so never put a phone number, address or other private data in it. Notebook content must never end up in this repo.
- Keep `office/` out of search engines: keep `robots.txt` and the `noindex` meta tags.
- `CNAME` must contain exactly `surajmittal.in`. History shows it being deleted and re-created, so don't remove it.
- Don't add a build step or npm dependencies unless asked. Third-party scripts are loaded from a CDN at runtime, pinned to exact versions.
