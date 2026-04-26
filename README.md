# 🕵️ Undercover Online

Real-time multiplayer Undercover party game with voice notes — play with friends anywhere, each on their own phone.

---

## ✨ Features

- **Create / Join** rooms with a 4-letter code — no Wi-Fi sharing needed
- **Private role reveal** — each player sees only their own word
- **Type or record** a voice note clue (MediaRecorder → base64 relay)
- **Discussion phase** — play back everyone's clues on your own device
- **Live voting** with real-time tally
- **Mr. White** gets a last-chance guess on elimination
- **Score tracking** across rounds in the same room
- Confetti win screen 🎉

---

## 🖥️ Installing Node.js (first time only)

Node.js is required to run the server. **Follow these steps on Windows:**

1. Go to **https://nodejs.org** and download the **LTS** installer (e.g. `node-v20.x.x-x64.msi`).
2. Run the installer — accept all defaults, including the checkbox *"Automatically install necessary tools"*.
3. After install, open a **new** PowerShell/Command Prompt window and verify:
   ```
   node -v   # should print v20.x.x
   npm -v    # should print 10.x.x
   ```

---

## 🚀 Running Locally

```bash
# 1. Enter the project folder
cd C:\Users\ss995\.gemini\antigravity\scratch\undercover-online

# 2. Install dependencies (first time only)
npm install

# 3. Start the server
npm start

# 4. Open in browser
#    http://localhost:3000
#    Share your local IP (e.g. http://192.168.1.x:3000) with friends on the same Wi-Fi
```

---

## ☁️ Deploying to Render.com (free)

### 1 — Push to GitHub

```bash
cd C:\Users\ss995\.gemini\antigravity\scratch\undercover-online
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/undercover-online.git
git push -u origin main
```

### 2 — Create a Render Web Service

1. Sign in at **https://render.com** (free account).
2. Click **New → Web Service**.
3. Connect your GitHub repo (`undercover-online`).
4. Render auto-detects `render.yaml` — confirm these settings:
   | Setting | Value |
   |---------|-------|
   | Environment | Node |
   | Build Command | `npm install` |
   | Start Command | `node server.js` |
   | Plan | Free |
5. Click **Create Web Service**.
6. Wait ~2 min for the first deploy. Your URL will be `https://undercover-online-xxxx.onrender.com`.

### 3 — Share the link

Send the Render URL to friends — everyone opens it on their phone and plays!

> **Note:** Render free tier spins down after 15 min of inactivity. First load may take ~30 sec to wake up.

---

## 🎮 Socket Events Reference

| Client → Server | Payload |
|---|---|
| `create-room` | `{ name, undercoverCount, hasMrWhite }` |
| `join-room` | `{ code, name }` |
| `start-game` | `{ code, wordPair }` |
| `player-ready` | `{ code }` |
| `submit-description` | `{ code, type, content }` |
| `start-voting` | `{ code }` |
| `cast-vote` | `{ code, target }` |
| `mrwhite-guess` | `{ code, guess }` |
| `next-round` | `{ code }` |
| `update-settings` | `{ code, undercoverCount, hasMrWhite }` |

| Server → Client | When |
|---|---|
| `room-created` | Host creates room |
| `room-joined` | Player joins |
| `player-joined` | Broadcast to room |
| `game-started` | Private role reveal per socket |
| `phase-changed` | Any phase transition |
| `ready-progress` | Each player ready tick |
| `description-progress` | Each clue submitted |
| `vote-progress` | Each vote cast |
| `player-eliminated` | Votes tallied |
| `mrwhite-result` | After Mr. White guesses |
| `game-over` | Win condition met |
| `settings-updated` | Host changes lobby settings |
| `player-disconnected` | Someone drops |
| `join-error` / `error-msg` | Validation errors |

---

## 📁 Project Structure

```
undercover-online/
├── server.js          # Node.js + Socket.IO game server
├── package.json
├── render.yaml        # Render.com deploy config
├── .gitignore
└── public/
    ├── index.html     # All screens (SPA)
    ├── style.css      # Dark purple/pink theme
    ├── app.js         # Full Socket.IO client logic
    └── wordbank.js    # Word pairs pool
```

---

*Built with Express + Socket.IO · Dark glassmorphism UI*
