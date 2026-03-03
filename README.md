# 💎 Stone Game — Real-Time Multiplayer

A production-grade, real-time multiplayer strategy game built with **vanilla web technologies** and **Firebase**. No frameworks, no backend server — pure frontend architecture deployable on any static host.

> **Remove 1–4 stones per turn. Take the last stone to win.**

---

## ✨ Features

### 🎮 Gameplay
- **17 stones** by default (configurable 5–50)
- Each turn, remove **1 to 4** stones
- The player who takes the **last stone wins**
- Real-time multiplayer — 2 players per room
- Instant sync via Firestore `onSnapshot`

### 🔐 Authentication
- Google Sign-In via Firebase Auth
- Profile picture & display name shown in-game
- Auth state persistence across page refreshes
- Unauthenticated users blocked from all game features

### 👥 100 Unique User Limit (Cost Control)
- Atomic user registration via `meta/stats` counter
- `runTransaction` prevents race conditions — no full collection scans
- Existing users pass through with only **2 document reads**
- New users atomically increment counter + create profile

### 🏠 Room System
- Create a room → get a **6-character room code**
- Share the code → friend joins instantly
- Room auto-transitions from `waiting` → `playing` when 2 players join
- Copy room code button for easy sharing
- Leave room / forfeit support

### 🛡️ Cheat Prevention
- All moves validated inside **Firestore transactions**
- Turn enforcement — only `currentTurn` player can write
- Move range validation (1–4 stones, can't exceed remaining)
- Stones cannot go negative
- Immutable fields locked in security rules
- Forfeit winner must be the *opponent*, not the forfeiter
- Console manipulation blocked by Firestore security rules

### 🎨 Ultra-Premium UI
- Animated gradient background
- Glassmorphism cards with backdrop blur
- Neon accent glow effects
- Canvas particle network background
- Confetti celebration on win
- Smooth stone removal animations
- Active turn glow on player avatars
- Web Audio API sound effects
- Fully responsive — mobile to desktop
- Google Font (Poppins)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Markup | Vanilla HTML5 |
| Styling | Modern CSS3 (custom properties, glassmorphism, keyframes) |
| Logic | Modular ES6 JavaScript |
| Auth | Firebase Authentication (Google provider) |
| Database | Cloud Firestore (real-time sync) |
| SDK | Firebase Web SDK v10 (modular, CDN) |
| Hosting | Any static host (Vercel, Netlify, GitHub Pages) |

**No frameworks. No Node.js. No backend server. Frontend-only.**

---

## 📁 Project Structure

```
├── index.html          # SPA with 4 screens (Auth, Dashboard, Waiting, Game)
├── style.css           # Full premium stylesheet (~600 lines)
├── script.js           # Game engine — 10 modular modules (~1100 lines)
├── firebase-config.js  # Firebase SDK init & exports
├── firestore.rules     # Production security rules
└── README.md
```

---

## 🧩 Architecture

```
script.js Modules:
  1. SoundManager      — Web Audio API sound effects
  2. ParticleEngine    — Canvas particle background
  3. ConfettiEngine    — Win celebration confetti
  4. ToastManager      — Notification toasts
  5. ScreenManager     — Screen switching (Auth → Dashboard → Game)
  6. AuthHandler       — Google Auth + atomic 100-user limit
  7. RoomManager       — Create / Join / Leave rooms (transactional)
  8. GameEngine        — Move validation & execution (transactional)
  9. UIController      — DOM rendering & interaction
 10. App               — Main orchestrator & event binding
```

---

## 🔥 Firestore Data Model

### `meta/stats`
| Field | Type | Description |
|-------|------|-------------|
| `userCount` | number | Atomic counter for 100-user limit |

### `users/{uid}`
| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Firebase Auth UID |
| `email` | string | User email |
| `displayName` | string | Google profile name |
| `photoURL` | string | Google profile photo |
| `wins` | number | Total victories |
| `createdAt` | timestamp | Registration time |

### `rooms/{roomId}`
| Field | Type | Description |
|-------|------|-------------|
| `roomId` | string | 6-char room code |
| `player1` | string | Creator's UID |
| `player2` | string \| null | Joiner's UID |
| `player1Name` | string | Display name |
| `player2Name` | string \| null | Display name |
| `player1Photo` | string | Photo URL |
| `player2Photo` | string \| null | Photo URL |
| `currentTurn` | string \| null | UID of active player |
| `totalStones` | number | Remaining stones |
| `initialStones` | number | Starting stone count |
| `status` | string | `waiting` / `playing` / `finished` |
| `winner` | string \| null | Winner's UID |
| `createdAt` | timestamp | Room creation time |

---

## 🚀 Getting Started

### Prerequisites
- A Firebase project with **Authentication** (Google provider) and **Firestore** enabled
- A static file server (Live Server, Vercel, etc.)

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/Sticks_game_17sticks.git
cd Sticks_game_17sticks
```

### 2. Configure Firebase
Edit `firebase-config.js` and replace the config object with your own Firebase project credentials:
```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Deploy Firestore Security Rules
Copy the contents of `firestore.rules` into your Firebase Console → Firestore → Rules, then publish.

### 4. Initialize the user counter
Create a document in Firestore manually (one-time setup):
- Collection: `meta` → Document: `stats` → Field: `userCount` (number) = `0`

> Or skip this — the app will auto-create it when the first user registers.

### 5. Run locally
Open `index.html` with a local server (required for ES modules):
```bash
# Using VS Code Live Server extension, or:
npx serve .
```

### 6. Deploy to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```
No build step needed — it's pure static files.

---

## 🔒 Security Rules Highlights

- ✅ Only authenticated users can read/write
- ✅ Users can only create their own profile (`uid == auth.uid`)
- ✅ Wins can only increment by +1 (no arbitrary values)
- ✅ Only room players can modify room data
- ✅ Only `currentTurn` player can make a move
- ✅ Stones can only decrease by 1–4 per move
- ✅ `totalStones` can never go negative or increase
- ✅ Immutable fields (`roomId`, `player1`, `initialStones`) locked on update
- ✅ Forfeit winner must be the opponent, not the forfeiter
- ✅ Room deletion only allowed by creator in `waiting` state
- ✅ `meta/stats` counter can only increment by exactly 1

---

## 🧠 Race Condition Protections

| Scenario | Protection |
|----------|-----------|
| Two users registering as user #100 simultaneously | `runTransaction` on `meta/stats` — only one succeeds |
| Two players trying to join the same room | `runTransaction` on room doc — only first joiner gets in |
| Room ID collision during creation | Transaction checks existence, retries up to 5 times |
| Both players leaving simultaneously (forfeit) | Transaction reads latest state — consistent winner |
| Move submitted after game ended | Transaction validates `status == 'playing'` |
| Two moves submitted in rapid succession | Transaction validates `currentTurn` — only correct player's move commits |

---

## 📱 Responsive Design

| Breakpoint | Layout |
|-----------|--------|
| > 768px | Full desktop layout with side-by-side cards |
| ≤ 768px | Stacked mobile layout, horizontal player bar |
| ≤ 420px | Compact stone grid and buttons |

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Built with 💎 vanilla web technologies & Firebase
</p>
