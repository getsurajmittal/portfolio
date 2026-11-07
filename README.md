# The Gazette — your portfolio as a newspaper

A personal portfolio that prints a new "edition" every time you add a certification, project, role or write-up. It's a plain static site: no build step, no server, free to host.

```
index.html      the newspaper (front page, features, opinion, the record)
styles.css      the look
app.js          builds the paper from content.json
content.json    ALL your content lives here
resume.js       turns content.json into an ATS-friendly résumé
desk/           your private editor
images/         photos you upload from the editor
```

---

## 1. Put it online (GitHub Pages, about 10 minutes)

1. Sign in to github.com (create a free account if needed).
2. Click **New repository**. Name it `gazette` (or `your-username.github.io` if you want the site at the root address). Make it **Public**. Create it.
3. On the new repo page click **uploading an existing file**. Drag in **everything inside** this folder (not the folder itself), including the `desk` and `images` folders and the `.nojekyll` file. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
5. After a minute your site is live at
   `https://your-username.github.io/gazette/` (or `https://your-username.github.io/` for the special repo name).

**Prefer Vercel?** Push the same files to GitHub, then on vercel.com choose *Add New → Project*, import the repo, set *Framework preset* to **Other**, leave build settings empty, and deploy. The editor works exactly the same because it saves to GitHub and Vercel redeploys on every save.

## 2. Create your key to the desk (2 minutes)

The editor saves straight into your repository, so it needs a GitHub access token. The token is the password.

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it `Gazette desk`. Set an expiry (1 year is fine; you'll just make a new one when it expires).
3. **Repository access:** *Only select repositories* → pick your `gazette` repo.
4. **Permissions → Repository permissions → Contents:** **Read and write**. Nothing else.
5. Generate, then copy the token (starts with `github_pat_`). Keep it somewhere safe, like a password manager.

## 3. Use the desk

Open `https://your-site-address/desk/` and enter your GitHub username, the repo name, branch `main` and the token. Tick *Remember on this device* only on your own computer.

- **Profile:** your name, city, role, and the masthead name ("The ___ Gazette").
- **Stories:** delete the placeholder stories, then **File a new** certification, project, role, column, etc. Each one becomes a front-page edition, ticker headline, archive entry and résumé line automatically.
- **Preview:** shows the paper with your unsaved changes.
- **Publish edition:** saves to GitHub. The live site updates in about a minute.
- **Résumé (PDF)** opens a print view. Choose *Save as PDF*. **Résumé (.docx)** downloads a Word file. Both are single-column, plain-text and ATS-friendly.

The résumé buttons exist only on the desk. Visitors to the paper never see them.

### Writing tips that make the paper (and résumé) good
- **Sub-headline:** one line, concrete. "Cut checkout time by 40% for 2M users" beats "Worked on checkout".
- **Résumé bullets** (roles and projects): start with a verb, end with a result.
- **Case study** fields on a project fill page A2. Feature your best one or two.
- Untick **Include on my résumé** for anything you want on the site but not on the résumé.

## Privacy, and your current employer

- The paper reads as a personal learning journal. Nothing on it says you're looking for a job.
- `content.json` is public (that's how the site reads it). Don't put anything there you wouldn't publish, such as a phone number or home address. Add those to the downloaded résumé yourself.
- The `/desk` page is public, but it does nothing without your token, and it's hidden from search engines.
- If you ever think your token leaked, delete it on GitHub (Settings → Developer settings) and make a new one.

## Custom domain (optional)

Buy a domain, then in **Settings → Pages → Custom domain** enter it and follow GitHub's DNS instructions (usually a CNAME record pointing to `your-username.github.io`).

## Working offline / without the editor

You can edit `content.json` by hand in any text editor and upload it to the repo. The desk's **Work offline** mode lets you edit in the browser and download the file. To preview locally, run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block it from reading `content.json`.

## How editions work

Every story, sorted by date, is an edition. The newest is the front page and **◀ Back issue** walks backwards through them. "The Morgue" (page B1) lists every edition by year. Returning visitors get an *Extra! Extra!* card listing anything filed since their last visit. Certifications from the last 45 days get a **NEW** stamp.
