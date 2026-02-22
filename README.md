# Interstellar — 3D Solar System

A 3D solar system with the sun, all eight planets (to scale), realistic textures, bloom, and smooth travel between planets.

## Run locally

The project uses ES modules, so open it via a **local server** (not by double‑clicking `index.html`).

**Option A — Node**
```bash
npx serve .
```
Then open the URL shown (e.g. http://localhost:3000).

**Option B — VS Code / Cursor**  
Install the "Live Server" extension, right‑click `index.html` → **Open with Live Server**.

**Option C — Python**
```bash
python -m http.server 8080
```
Then open http://localhost:8080.

## Controls

- **Drag** — orbit the camera
- **Scroll** — zoom in / out
- **Travel to** (top‑left) — click a planet name to fly to it
- **Click a planet label** in the scene to focus on that planet
- **← Free view** (top‑right) — return to orbiting the sun

## Textures

For realistic planet looks, add the texture images to the `textures/` folder. See **textures/README.md** (or open **textures/download-textures.html** in a browser) for download links. Without them, planets still work with solid colors.

---

## Sharing & working on it together

### 1. Share the folder with your friend

- **Zip the project:** Right‑click the `Game` folder → *Send to* → *Compressed folder*. Send the zip (email, Discord, etc.).
- Tell them to unzip, then run `npx serve .` in the folder and open the URL.
- If you’ve downloaded the planet textures, they’re in `textures/` and will be in the zip. If not, they can use **textures/download-textures.html** to get them.

### 2. Put it on GitHub so you can both work on it

1. **Create a GitHub account** (if you don’t have one): https://github.com  
2. **Install Git**: https://git-scm.com  
3. **Create a new repo** on GitHub (e.g. `solar-system-game`). Don’t add a README (you already have one).
4. **In your project folder**, open a terminal and run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```
   (Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and repo name.)

5. **Invite your friend:** Repo → *Settings* → *Collaborators* → *Add people*. They’ll get an email and can accept.
6. **They get the project:** They go to the repo, click *Code* → *Clone*, and clone the repo. Then they run `npx serve .` in the cloned folder.
7. **Working together:** You both make changes, then:
   - `git add .`
   - `git commit -m "Describe what you did"`
   - `git push`
   The other person runs `git pull` to get the latest changes. Use different branches if you want to try features without affecting the main version.

### 3. Share a playable link (no install for your friend)

Host the project so anyone can open it in a browser.

**GitHub Pages (free)**  
1. Push the project to GitHub (see step 2 above).  
2. Repo → *Settings* → *Pages* → under *Source* choose *Deploy from a branch* → branch `main`, folder `/ (root)` → Save.  
3. After a minute, the site is at: `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

**Netlify (free)**  
1. Go to https://app.netlify.com/drop  
2. Drag your **Game** folder (with `index.html`, `js/`, `textures/` inside) onto the page.  
3. Netlify gives you a link (e.g. `https://random-name-123.netlify.app`). You can change the name in Netlify settings.

**Vercel (free)**  
1. Connect your GitHub repo at https://vercel.com  
2. Import the repo; leave defaults and deploy.  
3. You get a URL like `https://your-repo.vercel.app`.

Send the link to your friend — they can play in the browser without installing anything. For collaborating on code, use Git + GitHub (section 2) and optionally host with Pages/Netlify/Vercel so you always have a live link.
