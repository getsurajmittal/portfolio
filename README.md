# The Gazette — your portfolio as a newspaper

A personal portfolio that prints a new "edition" every time you add a certification, project, role or write-up, plus a private **Back Office** with your own tools (starting with a Notebook for dated thoughts). It's a plain static site: no build step, no server, free to host.

```
index.html, styles.css, app.js   the public newspaper
content.json                     everything the paper shows
resume.js                        builds the ATS résumé from content.json
images/                          photos you upload from the desk
office/                          the private Back Office (login, hub, Notebook)
office/desk/                     the Editor's Desk (edits the paper, prints the résumé)
robots.txt                       keeps the Back Office out of search engines
```

Your notebook pages are **not** in this folder. They live in a second, **private** GitHub repository, so nobody else can ever read them.

---

## 1. Put the paper online (GitHub Pages, about 10 minutes)

1. Sign in to github.com.
2. **New repository** → name it `gazette` → **Public** → Create.
3. Click **uploading an existing file**. Drag in **everything inside** this folder (not the folder itself), including the `office` and `images` folders and the `.nojekyll` file. **Commit changes**.
4. **Settings → Pages** → *Deploy from a branch* → branch **main**, folder **/ (root)** → Save.
5. After a minute it's live at `https://your-username.github.io/gazette/`. For your own domain (surajmittal.in), see *Custom domain* below.

## 2. Create the private notebook repository (1 minute)

1. **New repository** → name it `notebook` → **Private**.
2. Tick **Add a README file**. The Back Office needs the repository to have at least one file.
3. Create. That's it, leave it empty otherwise.

## 3. Create your access token (2 minutes)

1. GitHub → avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name `Gazette back office`, expiry 1 year.
3. **Repository access:** *Only select repositories* → pick **both** `gazette` and `notebook`.
4. **Repository permissions → Contents: Read and write.** Nothing else.
5. Generate and copy it (starts with `github_pat_`). Save it in your password manager.

## 4. Issue your press pass (once per device)

1. Open your site and click **Staff entrance** in the footer (or go to `/office/` directly).
2. The first time on a device you'll see **Issue your press pass**. Enter your GitHub username, `main`, the two repository names, the token, and choose a **press pass**. A memorable phrase of 8+ characters is best.
3. The Back Office checks that the notebook repository really is private, then locks your token inside this browser, encrypted with the press pass.

From then on you only type the press pass. Tick **Keep me signed in on this device** only on your own computer or phone.

**Forgot the press pass?** Click *Lost your pass?* and set up again with your token. Nothing in your notebook or paper is lost.

## 5. Using the Back Office

**The hub** shows a *Quick note* box (adds a time-stamped line to today's page), your tools, and the latest notebook pages.

**The Notebook**
- One page per day. Each visit starts a new time-stamped entry, so the day reads like a log.
- It saves automatically about a second after you stop typing. The top bar shows *✓ Saved*.
- Optional title and tags per page. Browse by month or the calendar, filter by tag, and search every page.
- *Download page* gives you a Markdown copy. *Delete page* removes that day.
- Stored as one file per month (`pages/2026-11.json`) in your private repository, so you always have a plain copy of everything.

**The Editor's Desk** (formerly `/desk`) edits the paper:
- **Stories:** file certifications, projects, roles, columns, honours.
- **Preview** your unsaved changes, then **Publish edition**. The paper updates in about a minute.
- **Résumé (PDF)** prints to *Save as PDF*. **Résumé (.docx)** downloads a Word file. Both are ATS-friendly.

**Sign out** in the top bar ends the session on that device.

### Adding more utilities later
Each new tool gets its own folder inside `office/` (e.g. `office/reading/`), loads `../session.js` for the login, and stores its data in the private `notebook` repository (or another private repo). Add a card for it on the hub in `office/index.html`.

## Privacy, and your current employer

- The paper reads as a personal learning journal. Nothing on it says you're job hunting.
- The footer's *Staff entrance* link is visible to anyone, but it leads only to a login. Without your press pass and token there's nothing to see, and it's hidden from search engines.
- `content.json` (the paper) is public. Don't put a phone number or address there; add them to the downloaded résumé yourself.
- Notebook pages live only in your private repository and travel directly between your browser and GitHub.
- If you think your token leaked, delete it on GitHub (Settings → Developer settings) and make a new one, then use *Lost your pass?* on each device.

## Custom domain (surajmittal.in)

In the `gazette` repo: **Settings → Pages → Custom domain** → enter `surajmittal.in` → Save. At your registrar, set four **A** records for `@` (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153) and edit the existing **CNAME** `www` to point to `your-username.github.io`. Then tick **Enforce HTTPS**. The Back Office will be at `surajmittal.in/office/`.

## Working locally

Run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` straight from disk won't work, because browsers block it from reading `content.json`.

## How editions work

Every story, sorted by date, is an edition. The newest is the front page and **◀ Back issue** walks backwards. "The Morgue" (page B1) lists every edition by year. Returning visitors get an *Extra! Extra!* card for anything filed since their last visit. Certifications from the last 45 days get a **NEW** stamp.
