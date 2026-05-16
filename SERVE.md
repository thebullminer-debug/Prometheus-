# How to show the game on a different machine (e.g. your friend’s laptop)

Your game lives on your **PC**. To let someone on another machine (e.g. a laptop) open it, use one of these.

---

## Option A: Same Wi‑Fi / same place

If your friend’s laptop is on the **same network** as your PC (same house, same Wi‑Fi):

1. **On your PC** — open PowerShell and run:
   ```powershell
   cd C:\Users\Nikolai\Desktop\Game
   python -m http.server 8080
   ```
   (No Python? Use: `npx --yes serve -p 8080`)

2. **Find your PC’s IP** — in a new PowerShell window run:
   ```powershell
   ipconfig
   ```
   Under your Wi‑Fi adapter, find **IPv4 Address** (e.g. `192.168.1.105`).

3. **On your friend’s laptop** — open a browser and go to:
   ```
   http://YOUR-PC-IP:8080
   ```
   Example: `http://192.168.1.105:8080`

Your friend can now play the game on their laptop. Stop the server on your PC with **Ctrl+C** when done.

---

## Option B: Friend is somewhere else (remote link)

If your friend is **not on your Wi‑Fi** (different house, different city), they need a **public link** to your game.

### B1. Temporary link with ngrok (no account needed for short sessions)

1. **On your PC**, start the game server (same as above):
   ```powershell
   cd C:\Users\Nikolai\Desktop\Game
   python -m http.server 8080
   ```

2. **Download ngrok**: https://ngrok.com/download — unzip it.

3. **In another terminal** run (in the folder where `ngrok.exe` is):
   ```powershell
   ngrok http 8080
   ```

4. ngrok will show a **public URL** like `https://abc123.ngrok.io`. Send that link to your friend; they open it in their browser on their laptop.

When you close ngrok and the server, the link stops working.

### B2. Put the game online (link works anytime)

Host the project so your friend can open it anytime from any machine:

- **GitHub Pages** — push the repo to GitHub, enable Pages, share the `https://yourusername.github.io/Game` (or repo name) link.
- **Netlify** — drag the `Game` folder onto https://app.netlify.com/drop and get a link like `https://something.netlify.app`.
- **Vercel** — similar: connect the folder or repo and get a permanent URL.

Then you just send that one link; no need to run a server on your PC.

---

## Summary

| Situation                         | What to do                                      |
|----------------------------------|-------------------------------------------------|
| Friend on same Wi‑Fi as your PC  | Option A: server on PC + `http://YOUR-PC-IP:8080` |
| Friend elsewhere, quick demo     | Option B1: server + ngrok, share ngrok URL      |
| Friend elsewhere, link forever  | Option B2: GitHub Pages / Netlify / Vercel      |
