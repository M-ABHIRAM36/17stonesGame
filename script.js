/* ============================================================
   STONE GAME — REAL-TIME MULTIPLAYER ENGINE
   ============================================================
   Modules:
     1. SoundManager     — Web Audio API sound effects
     2. ParticleEngine   — Canvas particle background
     3. ConfettiEngine   — Win celebration confetti
     4. ToastManager     — Notification toasts
     5. ScreenManager    — Screen switching
     6. AuthHandler      — Firebase Google Auth + 100-user limit
     7. RoomManager      — Create / Join / Leave rooms
     8. GameEngine       — Moves, turns, real-time sync
     9. UIController     — DOM rendering & interaction
    10. App              — Main orchestrator
   ============================================================ */

'use strict';

// ── Firebase imports from config ────────────────────────────
import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, runTransaction,
  serverTimestamp, increment
} from './firebase-config.js';

// ── Constants ───────────────────────────────────────────────
const AI_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#7c3aed"/><text x="24" y="30" font-size="18" fill="white" text-anchor="middle" font-family="sans-serif" font-weight="bold">AI</text></svg>');
const GUEST_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#06b6d4"/><text x="24" y="30" font-size="16" fill="white" text-anchor="middle" font-family="sans-serif" font-weight="bold">G</text></svg>');
const LS_GUEST_AI_WINS = 'stoneGame_guestAIWins';


/* ═══════════════════════════════════════════════════════════
   1. SOUND MANAGER
   ═══════════════════════════════════════════════════════════ */
const SoundManager = (() => {
  let audioCtx = null;
  let enabled = true;

  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.15) {
    if (!enabled) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (_) { /* silent */ }
  }

  return {
    click()       { playTone(800, 'sine', 0.08, 0.1); },
    stoneRemove() { playTone(520, 'triangle', 0.15, 0.12); setTimeout(() => playTone(380, 'triangle', 0.12, 0.08), 60); },
    win()         { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.3, 0.12), i * 120)); },
    opponentMove(){ playTone(440, 'sawtooth', 0.1, 0.06); setTimeout(() => playTone(660, 'sine', 0.15, 0.1), 80); },
    error()       { playTone(200, 'square', 0.2, 0.08); }
  };
})();


/* ═══════════════════════════════════════════════════════════
   2. PARTICLE ENGINE
   ═══════════════════════════════════════════════════════════ */
const ParticleEngine = (() => {
  let canvas, ctx, particles = [], animId = null;
  const COUNT = 50;

  function create() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 3 + 1,
      alpha: Math.random() * 0.5 + 0.1
    };
  }

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const color = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#7c3aed';

    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });

    ctx.globalAlpha = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = color;
          ctx.globalAlpha = (1 - dist / 140) * 0.08;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    animId = requestAnimationFrame(draw);
  }

  return {
    init(el) { canvas = el; ctx = canvas.getContext('2d'); resize(); window.addEventListener('resize', resize); particles = Array.from({ length: COUNT }, create); draw(); },
    destroy() { if (animId) cancelAnimationFrame(animId); }
  };
})();


/* ═══════════════════════════════════════════════════════════
   3. CONFETTI ENGINE
   ═══════════════════════════════════════════════════════════ */
const ConfettiEngine = (() => {
  let canvas, ctx, pieces = [], animId = null, running = false;
  const COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

  function createPiece() {
    return {
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * canvas.height * 0.5,
      w: Math.random() * 10 + 5,
      h: Math.random() * 6 + 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8,
      vy: Math.random() * 3 + 2,
      vx: (Math.random() - 0.5) * 2,
      alpha: 1
    };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rotation += p.rotSpeed;
      if (p.y > canvas.height) { p.alpha -= 0.02; }
      if (p.alpha <= 0) return;
      alive++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive > 0 && running) { animId = requestAnimationFrame(draw); }
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  return {
    init(el) { canvas = el; ctx = canvas.getContext('2d'); resize(); window.addEventListener('resize', resize); },
    fire() {
      pieces = Array.from({ length: 200 }, createPiece);
      running = true;
      draw();
    },
    stop() { running = false; if (animId) { cancelAnimationFrame(animId); animId = null; } pieces = []; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  };
})();


/* ═══════════════════════════════════════════════════════════
   4. TOAST MANAGER
   ═══════════════════════════════════════════════════════════ */
const Toast = (() => {
  const container = () => document.getElementById('toastContainer');

  function show(message, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container().appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  return {
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    info:    (msg) => show(msg, 'info')
  };
})();


/* ═══════════════════════════════════════════════════════════
   5. SCREEN MANAGER
   ═══════════════════════════════════════════════════════════ */
const ScreenManager = (() => {
  const screens = ['authScreen', 'dashboardScreen', 'waitingScreen', 'gameScreen'];

  function show(id) {
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (s === id) { el.classList.add('active'); }
      else { el.classList.remove('active'); }
    });
  }

  return { show };
})();


/* ═══════════════════════════════════════════════════════════
   6. AUTH HANDLER
   ═══════════════════════════════════════════════════════════ */
const AuthHandler = (() => {
  let currentUser = null;
  let userDoc = null;

  /**
   * Atomic 100-user limit check using meta/stats counter.
   * - Reads only 2 documents max (meta/stats + users/{uid})
   * - Uses runTransaction to prevent race conditions
   * - Prevents duplicate increments for existing users
   */
  async function userLimitCheck(user) {
    const userRef = doc(db, 'users', user.uid);
    const statsRef = doc(db, 'meta', 'stats');

    try {
      const result = await runTransaction(db, async (transaction) => {
        // Read both docs inside the transaction for consistency
        const userSnap = await transaction.get(userRef);
        const statsSnap = await transaction.get(statsRef);

        if (userSnap.exists()) {
          // Existing user — no count change needed
          return { allowed: true, userData: userSnap.data(), isNew: false };
        }

        // New user — check counter atomically
        const currentCount = statsSnap.exists() ? (statsSnap.data().userCount || 0) : 0;

        if (currentCount >= 100) {
          return { allowed: false };
        }

        // Read guest AI wins from localStorage for merge on creation
        const guestAIWins = parseInt(localStorage.getItem(LS_GUEST_AI_WINS) || '0', 10);

        // Register new user + increment counter in same transaction
        const newUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          winsOnline: 0,
          winsAI: Math.max(0, guestAIWins),
          createdAt: serverTimestamp()
        };

        transaction.set(userRef, newUser);

        if (statsSnap.exists()) {
          transaction.update(statsRef, { userCount: increment(1) });
        } else {
          // First user ever — create the meta/stats doc
          transaction.set(statsRef, { userCount: 1 });
        }

        return { allowed: true, userData: newUser, isNew: true };
      });

      if (result.allowed) {
        userDoc = result.userData;
        // Clear guest wins localStorage if merged during creation
        if (result.isNew) localStorage.removeItem(LS_GUEST_AI_WINS);
        return true;
      }
      return false;
    } catch (err) {
      console.error('User limit check failed:', err);
      return false;
    }
  }

  /** Google Sign-In */
  async function signIn() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const allowed = await userLimitCheck(result.user);
      if (!allowed) {
        await signOut(auth);
        showAuthError('User limit reached. Maximum 100 users allowed.');
        return;
      }
      hideAuthError();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showAuthError(err.message);
      }
    }
  }

  /** Logout */
  async function logout() {
    // Leave any active room before logout
    await RoomManager.leaveRoom();
    await signOut(auth);
  }

  /** Fetch fresh user doc from Firestore */
  async function refreshUserDoc() {
    if (!currentUser) return;
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) userDoc = snap.data();
  }

  function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideAuthError() {
    document.getElementById('authError').classList.add('hidden');
  }

  function getUser() { return currentUser; }
  function getUserDoc() { return userDoc; }
  function setUser(u) { currentUser = u; }
  function setUserDoc(d) { userDoc = d; }

  /** Guest mode for AI play without login */
  let isGuest = false;

  function enterGuestMode() {
    isGuest = true;
    currentUser = null;
    const guestWins = parseInt(localStorage.getItem(LS_GUEST_AI_WINS) || '0', 10);
    userDoc = {
      uid: 'guest',
      displayName: 'Guest',
      photoURL: '',
      email: '',
      winsOnline: 0,
      winsAI: guestWins
    };
  }

  function exitGuestMode() {
    isGuest = false;
    currentUser = null;
    userDoc = null;
  }

  function getIsGuest() { return isGuest; }

  /** Merge guest localStorage AI wins into existing user's Firestore doc */
  async function mergeGuestWins() {
    if (!currentUser) return;
    const guestWins = parseInt(localStorage.getItem(LS_GUEST_AI_WINS) || '0', 10);
    if (guestWins <= 0) return;
    const userRef = doc(db, 'users', currentUser.uid);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) return;
        const data = snap.data();
        transaction.update(userRef, { winsAI: (data.winsAI || 0) + guestWins });
      });
      localStorage.removeItem(LS_GUEST_AI_WINS);
    } catch (err) {
      console.error('Failed to merge guest wins:', err);
    }
  }

  return { signIn, logout, getUser, getUserDoc, setUser, setUserDoc, userLimitCheck, refreshUserDoc, enterGuestMode, exitGuestMode, getIsGuest, mergeGuestWins };
})();


/* ═══════════════════════════════════════════════════════════
   7. ROOM MANAGER
   ═══════════════════════════════════════════════════════════ */
const RoomManager = (() => {
  let currentRoomId = null;
  let unsubRoom = null;

  /** Generate a random 6-char room code */
  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  /**
   * Create a new room atomically.
   * Uses runTransaction to prevent room ID collision race conditions.
   * Retries with new code if collision occurs.
   */
  async function createRoom(totalStones = 17) {
    const user = AuthHandler.getUser();
    if (!user) return null;

    // Retry up to 5 times for room ID collisions
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomId = generateCode();
      const roomRef = doc(db, 'rooms', roomId);

      try {
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(roomRef);
          if (existing.exists()) {
            throw new Error('ROOM_COLLISION');
          }

          const roomData = {
            roomId,
            player1: user.uid,
            player2: null,
            player1Name: user.displayName || 'Player 1',
            player2Name: null,
            player1Photo: user.photoURL || '',
            player2Photo: null,
            currentTurn: user.uid,
            totalStones,
            initialStones: totalStones,
            status: 'waiting',
            winner: null,
            createdAt: serverTimestamp()
          };

          transaction.set(roomRef, roomData);
        });

        // Success — no collision
        currentRoomId = roomId;
        return roomId;
      } catch (err) {
        if (err.message === 'ROOM_COLLISION') continue; // Retry
        throw err; // Real error — propagate
      }
    }

    throw new Error('Failed to create room after multiple attempts.');
  }

  /** Join an existing room */
  async function joinRoom(roomId) {
    const user = AuthHandler.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    roomId = roomId.toUpperCase().trim();
    const roomRef = doc(db, 'rooms', roomId);

    try {
      const result = await runTransaction(db, async (transaction) => {
        const roomSnap = await transaction.get(roomRef);

        if (!roomSnap.exists()) {
          throw new Error('Room not found. Check the code and try again.');
        }

        const data = roomSnap.data();

        // Can't join your own room
        if (data.player1 === user.uid) {
          throw new Error('You are already in this room.');
        }

        // Room full
        if (data.player2 && data.player2 !== user.uid) {
          throw new Error('Room is full. Only 2 players allowed.');
        }

        // Already joined
        if (data.player2 === user.uid) {
          currentRoomId = roomId;
          return { success: true };
        }

        // Room not in waiting state
        if (data.status !== 'waiting') {
          throw new Error('Game already in progress or finished.');
        }

        // Join room
        transaction.update(roomRef, {
          player2: user.uid,
          player2Name: user.displayName || 'Player 2',
          player2Photo: user.photoURL || '',
          status: 'playing'
        });

        currentRoomId = roomId;
        return { success: true };
      });

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Leave the current room safely.
   * Uses transaction for forfeit to prevent race conditions
   * (e.g., both players leaving simultaneously).
   * Always unsubscribes listener first.
   */
  async function leaveRoom() {
    // Always unsubscribe listener first to prevent stale callbacks
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
    if (!currentRoomId) return;

    const user = AuthHandler.getUser();
    const savedRoomId = currentRoomId;
    currentRoomId = null; // Clear immediately to prevent re-entry

    if (!user) return;

    const roomRef = doc(db, 'rooms', savedRoomId);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return; // Room already gone

        const data = snap.data();

        // If waiting and we're owner → delete room
        if (data.status === 'waiting' && data.player1 === user.uid) {
          transaction.delete(roomRef);
          return;
        }

        // If playing → forfeit: opponent wins
        if (data.status === 'playing') {
          // Verify we are actually a player
          if (data.player1 !== user.uid && data.player2 !== user.uid) return;

          const winner = data.player1 === user.uid ? data.player2 : data.player1;
          transaction.update(roomRef, {
            status: 'finished',
            winner,
            currentTurn: null
          });

          // Increment winner's online win count atomically
          if (winner) {
            const winnerRef = doc(db, 'users', winner);
            transaction.update(winnerRef, { winsOnline: increment(1) });
          }
        }
        // If already finished — do nothing, just leave
      });
    } catch (err) {
      console.error('Leave room error:', err);
    }
  }

  /**
   * Listen to room changes in real-time.
   * Guards against listener stacking — always unsubs previous listener.
   * Only listens to a single room document (cost-efficient).
   */
  function listenToRoom(roomId, callback) {
    // Always clean up any existing listener to prevent stacking
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }

    const roomRef = doc(db, 'rooms', roomId);
    let isActive = true; // Guard against callbacks after unsub

    unsubRoom = onSnapshot(roomRef, (snap) => {
      if (!isActive) return; // Ignore stale callbacks
      if (snap.exists()) {
        callback(snap.data());
      } else {
        callback(null);
      }
    }, (err) => {
      if (!isActive) return;
      console.error('Room listener error:', err);
      Toast.error('Connection lost. Try refreshing.');
    });

    // Wrap unsub to also set guard flag
    const originalUnsub = unsubRoom;
    unsubRoom = () => {
      isActive = false;
      originalUnsub();
    };
  }

  /** Stop listening — safe to call multiple times */
  function stopListening() {
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  }

  function getCurrentRoomId() { return currentRoomId; }
  function setCurrentRoomId(id) { currentRoomId = id; }

  return { createRoom, joinRoom, leaveRoom, listenToRoom, stopListening, getCurrentRoomId, setCurrentRoomId, generateCode };
})();


/* ═══════════════════════════════════════════════════════════
   8. GAME ENGINE (handle moves via Firestore transactions)
   ═══════════════════════════════════════════════════════════ */
const GameEngine = (() => {

  /**
   * Make a move — removes `count` stones.
   * Fully validated inside a Firestore transaction:
   *   - Room exists and is 'playing'
   *   - It's this user's turn
   *   - User is a room player
   *   - count is integer 1-4
   *   - count <= totalStones
   *   - totalStones can't go negative
   *   - On win: status/winner set + winner.wins incremented atomically
   */
  async function handleMove(roomId, count) {
    const user = AuthHandler.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // Sanitize count to integer on client side
    count = Math.floor(Number(count));
    if (isNaN(count) || count < 1 || count > 4) {
      return { success: false, error: 'Invalid move: pick 1-4 stones.' };
    }

    const roomRef = doc(db, 'rooms', roomId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) throw new Error('Room no longer exists.');

        const data = snap.data();

        // Validate: room must be playing
        if (data.status !== 'playing') throw new Error('Game is not active.');

        // Validate: must be this player's turn
        if (data.currentTurn !== user.uid) throw new Error("Not your turn.");

        // Validate: must be a player in this room
        if (data.player1 !== user.uid && data.player2 !== user.uid) {
          throw new Error('You are not a player in this room.');
        }

        // Validate: count between 1-4 (double-check inside transaction)
        if (count < 1 || count > 4) throw new Error('Invalid move: pick 1-4 stones.');

        // Validate: stones must be positive
        if (data.totalStones <= 0) throw new Error('No stones remaining.');

        // Validate: can't take more than available
        if (count > data.totalStones) throw new Error('Not enough stones remaining.');

        const newTotal = data.totalStones - count;

        // Safety: totalStones must never go negative
        if (newTotal < 0) throw new Error('Invalid state: stones cannot go negative.');
        const nextTurn = data.player1 === user.uid ? data.player2 : data.player1;

        if (newTotal === 0) {
          // Current player wins (they took the last stone)
          transaction.update(roomRef, {
            totalStones: 0,
            status: 'finished',
            winner: user.uid,
            currentTurn: null
          });

          // Increment winner's online win count
          const winnerRef = doc(db, 'users', user.uid);
          transaction.update(winnerRef, { winsOnline: increment(1) });
        } else {
          transaction.update(roomRef, {
            totalStones: newTotal,
            currentTurn: nextTurn
          });
        }
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { handleMove };
})();


/* ═══════════════════════════════════════════════════════════
   8.5. AI ENGINE (local AI opponent)
   ═══════════════════════════════════════════════════════════ */
const AIEngine = (() => {
  let state = null;

  /**
   * Start a new AI game.
   * @param {number} totalStones - Starting stone count
   * @param {boolean} playerFirst - true if human goes first
   * @returns {object} Initial game state
   */
  function startGame(totalStones, playerFirst = true) {
    state = {
      totalStones,
      initialStones: totalStones,
      currentTurn: playerFirst ? 'player' : 'ai',
      status: 'playing',
      winner: null
    };
    return { ...state };
  }

  /**
   * Handle the human player's move.
   * @param {number} count - Stones to remove (1-4)
   * @returns {{ success: boolean, state?: object, error?: string }}
   */
  function handlePlayerMove(count) {
    if (!state || state.status !== 'playing' || state.currentTurn !== 'player') {
      return { success: false, error: 'Not your turn.' };
    }

    count = Math.floor(Number(count));
    if (isNaN(count) || count < 1 || count > 4) {
      return { success: false, error: 'Pick 1-4 stones.' };
    }
    if (count > state.totalStones) {
      return { success: false, error: 'Not enough stones remaining.' };
    }

    state.totalStones -= count;

    if (state.totalStones === 0) {
      state.status = 'finished';
      state.winner = 'player';
      state.currentTurn = null;
    } else {
      state.currentTurn = 'ai';
    }

    return { success: true, state: { ...state } };
  }

  /**
   * Calculate the optimal AI move.
   * Strategy: Leave opponent at a multiple of 5 stones.
   * If already at a multiple of 5, pick randomly (losing position).
   * @param {number} stonesLeft
   * @returns {number} Number of stones to take
   */
  function calculateAIMove(stonesLeft) {
    if (stonesLeft <= 4) return stonesLeft; // Win immediately
    const optimal = stonesLeft % 5;
    return optimal === 0
      ? (Math.floor(Math.random() * 4) + 1)
      : optimal;
  }

  /**
   * Execute the AI's move.
   * @returns {{ move: number, state: object } | null}
   */
  function makeAIMove() {
    if (!state || state.status !== 'playing' || state.currentTurn !== 'ai') return null;

    const move = calculateAIMove(state.totalStones);
    state.totalStones -= move;

    if (state.totalStones === 0) {
      state.status = 'finished';
      state.winner = 'ai';
      state.currentTurn = null;
    } else {
      state.currentTurn = 'player';
    }

    return { move, state: { ...state } };
  }

  function getState() { return state ? { ...state } : null; }

  function cleanup() { state = null; }

  return { startGame, handlePlayerMove, makeAIMove, calculateAIMove, getState, cleanup };
})();


/* ═══════════════════════════════════════════════════════════
   9. UI CONTROLLER
   ═══════════════════════════════════════════════════════════ */
const UIController = (() => {

  // ── DOM References ────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  let stoneCount = 17;
  let previousStoneCount = null;  // track previous stone count for animation

  // ── Dashboard ─────────────────────────────────────────────
  function renderDashboard(user, userDoc) {
    const isGuest = AuthHandler.getIsGuest();
    const defaultAvatar = isGuest ? GUEST_AVATAR : '';
    $('userAvatar').src = user.photoURL || defaultAvatar;
    $('userName').textContent = user.displayName || 'Player';
    $('userWinsOnline').textContent = userDoc?.winsOnline ?? userDoc?.wins ?? 0;
    $('userWinsAI').textContent = userDoc?.winsAI ?? 0;
    $('profilePhoto').src = user.photoURL || defaultAvatar;
    $('profileName').textContent = user.displayName || 'Player';
    $('profileEmail').textContent = user.email || '';
    $('profileWinsOnline').textContent = userDoc?.winsOnline ?? userDoc?.wins ?? 0;
    $('profileWinsAI').textContent = userDoc?.winsAI ?? 0;
    $('stoneCountDisplay').textContent = stoneCount;

    // Guest mode adjustments
    if (isGuest) {
      $('modeOnlineBtn').classList.add('hidden');
      $('logoutBtn').textContent = 'Sign In';
    } else {
      $('modeOnlineBtn').classList.remove('hidden');
      $('logoutBtn').textContent = 'Logout';
    }
  }

  // ── Stone Count Stepper ───────────────────────────────────
  function initStepper() {
    $('stoneDecrement').addEventListener('click', () => {
      if (stoneCount > 5) { stoneCount--; $('stoneCountDisplay').textContent = stoneCount; SoundManager.click(); }
    });
    $('stoneIncrement').addEventListener('click', () => {
      if (stoneCount < 50) { stoneCount++; $('stoneCountDisplay').textContent = stoneCount; SoundManager.click(); }
    });
  }

  // ── Waiting Room ──────────────────────────────────────────
  function renderWaiting(roomId) {
    $('waitingRoomCode').textContent = roomId;
  }

  // ── Game Screen ───────────────────────────────────────────
  function renderGameBoard(data, myUid) {
    $('gameRoomCode').textContent = data.roomId;

    // Player cards
    $('p1Avatar').src = data.player1Photo || '';
    $('p1Name').textContent = data.player1Name || 'Player 1';
    $('p2Avatar').src = data.player2Photo || '';
    $('p2Name').textContent = data.player2Name || 'Player 2';

    // Active turn glow
    const p1Card = $('player1Card');
    const p2Card = $('player2Card');
    p1Card.classList.toggle('active-turn', data.currentTurn === data.player1);
    p2Card.classList.toggle('active-turn', data.currentTurn === data.player2);

    // Badges
    if (data.status === 'finished') {
      $('p1Badge').textContent = data.winner === data.player1 ? '🏆 Winner' : 'Lost';
      $('p2Badge').textContent = data.winner === data.player2 ? '🏆 Winner' : 'Lost';
    } else {
      $('p1Badge').textContent = data.currentTurn === data.player1 ? '🎯 Playing' : 'Waiting…';
      $('p2Badge').textContent = data.currentTurn === data.player2 ? '🎯 Playing' : 'Waiting…';
    }

    // Stones count
    $('stonesRemaining').textContent = data.totalStones;

    // Stone grid — render with animation
    renderStoneGrid(data.totalStones, data.initialStones || 17);

    // Commentary
    renderCommentary(data, myUid);

    // Enable/disable pick buttons
    const isMyTurn = data.currentTurn === myUid && data.status === 'playing';
    document.querySelectorAll('.btn-pick').forEach(btn => {
      const pick = parseInt(btn.dataset.pick);
      btn.disabled = !isMyTurn || pick > data.totalStones;
    });
  }

  function renderStoneGrid(current, initial) {
    const grid = $('stoneGrid');
    const existingStones = grid.querySelectorAll('.stone');

    // First render or reset — build fresh
    if (existingStones.length === 0 || previousStoneCount === null || current > previousStoneCount) {
      grid.innerHTML = '';
      for (let i = 0; i < initial; i++) {
        const el = document.createElement('div');
        el.className = 'stone';
        el.style.animationDelay = `${i * 0.03}s`;
        if (i >= current) el.classList.add('removed');
        el.innerHTML = '🪨';
        grid.appendChild(el);
      }
    } else if (current < previousStoneCount) {
      // Animate removal of stones
      const stones = grid.querySelectorAll('.stone:not(.removed)');
      const toRemove = previousStoneCount - current;
      for (let i = 0; i < toRemove && i < stones.length; i++) {
        const stone = stones[stones.length - 1 - i];
        stone.classList.add('removing');
        setTimeout(() => {
          stone.classList.remove('removing');
          stone.classList.add('removed');
        }, 500);
      }
    }

    previousStoneCount = current;
  }

  function renderCommentary(data, myUid) {
    const el = $('commentaryText');
    if (data.status === 'finished') {
      if (data.winner === myUid) {
        el.textContent = '🎉 You win! Brilliant strategy!';
      } else {
        el.textContent = '😔 You lost. Better luck next time!';
      }
    } else if (data.currentTurn === myUid) {
      const messages = ["Your turn — choose wisely!", "It's your move! Think ahead.", "Your turn! Make it count.", "You're up! Show your strategy."];
      el.textContent = '🎯 ' + messages[Math.floor(Math.random() * messages.length)];
    } else {
      const messages = ["Opponent is thinking…", "Waiting for opponent's move…", "Their turn — hold tight!", "Opponent is strategizing…"];
      el.textContent = '⏳ ' + messages[Math.floor(Math.random() * messages.length)];
    }
  }

  /** Reset game screen state */
  function resetGameUI() {
    previousStoneCount = null;
    $('stoneGrid').innerHTML = '';
  }

  function getStoneCount() { return stoneCount; }

  // ── AI Stepper ───────────────────────────────────────
  let aiStoneCount = 17;

  function initAIStepper() {
    $('aiStoneDecrement').addEventListener('click', () => {
      if (aiStoneCount > 5) { aiStoneCount--; $('aiStoneCountDisplay').textContent = aiStoneCount; SoundManager.click(); }
    });
    $('aiStoneIncrement').addEventListener('click', () => {
      if (aiStoneCount < 50) { aiStoneCount++; $('aiStoneCountDisplay').textContent = aiStoneCount; SoundManager.click(); }
    });
  }

  function getAIStoneCount() { return aiStoneCount; }

  // ── Mode Toggle ──────────────────────────────────────
  function setDashboardMode(mode) {
    document.querySelectorAll('.mode-online').forEach(el => {
      el.classList.toggle('hidden', mode !== 'online');
    });
    document.querySelectorAll('.mode-ai').forEach(el => {
      el.classList.toggle('hidden', mode !== 'ai');
    });
    document.querySelectorAll('.btn-mode').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  return { renderDashboard, renderWaiting, renderGameBoard, resetGameUI, initStepper, getStoneCount, initAIStepper, getAIStoneCount, setDashboardMode };
})();


/* ═══════════════════════════════════════════════════════════
   10. APP — Main Orchestrator
   ═══════════════════════════════════════════════════════════ */
const App = (() => {
  const $ = (id) => document.getElementById(id);
  let lastRoomStatus = null;
  let currentMode = 'online';  // 'online' or 'ai'
  let playerGoesFirst = true;
  let aiTimerId = null;

  /** Initialize the entire application */
  function init() {
    // Start visual engines
    ParticleEngine.init($('particleCanvas'));
    ConfettiEngine.init($('confettiCanvas'));

    // Init UI
    UIController.initStepper();
    UIController.initAIStepper();

    // Bind events
    bindAuthEvents();
    bindModeEvents();
    bindDashboardEvents();
    bindWaitingEvents();
    bindGameEvents();
    bindWinEvents();

    // Auth state listener — handles login, refresh, and logout
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Exit guest mode if transitioning from guest → logged-in
        if (AuthHandler.getIsGuest()) AuthHandler.exitGuestMode();

        AuthHandler.setUser(user);

        // Atomic user limit check via meta/stats transaction
        const allowed = await AuthHandler.userLimitCheck(user);
        if (!allowed) {
          await signOut(auth);
          $('authError').textContent = 'User limit reached. Maximum 100 users allowed.';
          $('authError').classList.remove('hidden');
          ScreenManager.show('authScreen');
          return;
        }

        // Merge guest AI wins for existing users
        await AuthHandler.mergeGuestWins();

        // Refresh user doc to get latest win counts
        await AuthHandler.refreshUserDoc();
        UIController.renderDashboard(user, AuthHandler.getUserDoc());

        // Check if user was in an active room (page refresh scenario)
        const savedRoom = RoomManager.getCurrentRoomId();
        if (savedRoom) {
          try {
            const roomSnap = await getDoc(doc(db, 'rooms', savedRoom));
            if (roomSnap.exists()) {
              const roomData = roomSnap.data();
              const isPlayer = roomData.player1 === user.uid || roomData.player2 === user.uid;
              if (isPlayer && roomData.status !== 'finished') {
                if (roomData.status === 'waiting') {
                  UIController.renderWaiting(savedRoom);
                  ScreenManager.show('waitingScreen');
                } else {
                  currentMode = 'online';
                  $('gameRoomPrefix').textContent = 'Room:';
                  $('leaveGameBtn').textContent = 'Leave Room';
                  UIController.resetGameUI();
                  ScreenManager.show('gameScreen');
                }
                startRoomListener(savedRoom);
                Toast.info('Reconnected to your game!');
                return;
              }
            }
            RoomManager.setCurrentRoomId(null);
          } catch (_) {
            RoomManager.setCurrentRoomId(null);
          }
        }

        ScreenManager.show('dashboardScreen');
      } else {
        // Don't redirect to auth while in guest mode
        if (AuthHandler.getIsGuest()) return;

        // Logged out — clean up everything
        AuthHandler.setUser(null);
        AuthHandler.setUserDoc(null);
        RoomManager.stopListening();
        RoomManager.setCurrentRoomId(null);
        cleanupAI();
        ScreenManager.show('authScreen');
      }
    });
  }

  // ── Cleanup AI ────────────────────────────────────────────
  function cleanupAI() {
    if (aiTimerId) { clearTimeout(aiTimerId); aiTimerId = null; }
    AIEngine.cleanup();
  }

  // ── Auth Events ─────────────────────────────────────────
  function bindAuthEvents() {
    $('googleSignInBtn').addEventListener('click', () => {
      SoundManager.click();
      AuthHandler.signIn();
    });

    $('guestPlayBtn').addEventListener('click', () => {
      SoundManager.click();
      AuthHandler.enterGuestMode();
      currentMode = 'ai';
      UIController.renderDashboard(
        { displayName: 'Guest', photoURL: '', email: '' },
        AuthHandler.getUserDoc()
      );
      UIController.setDashboardMode('ai');
      ScreenManager.show('dashboardScreen');
    });
  }

  // ── Mode Events ─────────────────────────────────────────
  function bindModeEvents() {
    $('modeOnlineBtn').addEventListener('click', () => {
      SoundManager.click();
      currentMode = 'online';
      UIController.setDashboardMode('online');
    });

    $('modeAIBtn').addEventListener('click', () => {
      SoundManager.click();
      currentMode = 'ai';
      UIController.setDashboardMode('ai');
    });

    // First-player toggle
    $('playerFirstBtn').addEventListener('click', () => {
      SoundManager.click();
      playerGoesFirst = true;
      $('playerFirstBtn').classList.add('active');
      $('aiFirstBtn').classList.remove('active');
    });

    $('aiFirstBtn').addEventListener('click', () => {
      SoundManager.click();
      playerGoesFirst = false;
      $('aiFirstBtn').classList.add('active');
      $('playerFirstBtn').classList.remove('active');
    });
  }

  // ── Dashboard Events ────────────────────────────────────
  function bindDashboardEvents() {
    $('logoutBtn').addEventListener('click', async () => {
      SoundManager.click();
      if (AuthHandler.getIsGuest()) {
        AuthHandler.exitGuestMode();
        cleanupAI();
        ScreenManager.show('authScreen');
        return;
      }
      await AuthHandler.logout();
    });

    $('createRoomBtn').addEventListener('click', async () => {
      SoundManager.click();
      $('createRoomBtn').disabled = true;
      $('createRoomBtn').textContent = 'Creating…';

      try {
        const roomId = await RoomManager.createRoom(UIController.getStoneCount());
        if (roomId) {
          currentMode = 'online';
          UIController.renderWaiting(roomId);
          ScreenManager.show('waitingScreen');
          startRoomListener(roomId);
          Toast.success(`Room ${roomId} created!`);
        }
      } catch (err) {
        Toast.error('Failed to create room. Try again.');
      } finally {
        $('createRoomBtn').disabled = false;
        $('createRoomBtn').innerHTML = '<span>🏠</span> Create Room';
      }
    });

    $('joinRoomBtn').addEventListener('click', async () => {
      SoundManager.click();
      const code = $('joinRoomInput').value.trim().toUpperCase();
      const errorEl = $('joinError');

      if (!code || code.length < 4) {
        errorEl.textContent = 'Please enter a valid room code.';
        errorEl.classList.remove('hidden');
        SoundManager.error();
        return;
      }

      errorEl.classList.add('hidden');
      $('joinRoomBtn').disabled = true;
      $('joinRoomBtn').textContent = 'Joining…';

      const result = await RoomManager.joinRoom(code);
      if (result.success) {
        currentMode = 'online';
        $('gameRoomPrefix').textContent = 'Room:';
        $('leaveGameBtn').textContent = 'Leave Room';
        UIController.resetGameUI();
        ScreenManager.show('gameScreen');
        startRoomListener(code);
        Toast.success(`Joined room ${code}!`);
      } else {
        errorEl.textContent = result.error;
        errorEl.classList.remove('hidden');
        SoundManager.error();
      }

      $('joinRoomBtn').disabled = false;
      $('joinRoomBtn').innerHTML = '<span>🚀</span> Join Room';
    });

    // AI game start
    $('startAIGameBtn').addEventListener('click', () => {
      SoundManager.click();
      currentMode = 'ai';
      startAIGame();
    });
  }

  // ── Waiting Events ──────────────────────────────────────
  function bindWaitingEvents() {
    $('copyCodeBtn').addEventListener('click', () => {
      const code = $('waitingRoomCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        Toast.success('Room code copied!');
        SoundManager.click();
      });
    });

    $('leaveWaitingBtn').addEventListener('click', async () => {
      SoundManager.click();
      await RoomManager.leaveRoom();
      lastRoomStatus = null;
      await AuthHandler.refreshUserDoc();
      UIController.renderDashboard(AuthHandler.getUser(), AuthHandler.getUserDoc());
      ScreenManager.show('dashboardScreen');
    });
  }

  // ── Game Events ─────────────────────────────────────────
  function bindGameEvents() {
    // Pick buttons — handle both online and AI modes
    document.querySelectorAll('.btn-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        const count = parseInt(btn.dataset.pick);

        if (currentMode === 'ai') {
          handleAIGameMove(count);
          return;
        }

        // Online mode
        const roomId = RoomManager.getCurrentRoomId();
        if (!roomId) return;

        document.querySelectorAll('.btn-pick').forEach(b => b.disabled = true);
        SoundManager.stoneRemove();

        const result = await GameEngine.handleMove(roomId, count);
        if (!result.success) {
          Toast.error(result.error);
          SoundManager.error();
        }
        // Buttons re-enabled by room listener callback
      });
    });

    $('leaveGameBtn').addEventListener('click', async () => {
      SoundManager.click();

      if (currentMode === 'ai') {
        cleanupAI();
        UIController.resetGameUI();
        await refreshAndShowDashboard();
        return;
      }

      // Online mode
      await RoomManager.leaveRoom();
      lastRoomStatus = null;
      UIController.resetGameUI();
      await AuthHandler.refreshUserDoc();
      UIController.renderDashboard(AuthHandler.getUser(), AuthHandler.getUserDoc());
      ScreenManager.show('dashboardScreen');
    });
  }

  // ── Win Overlay Events ──────────────────────────────────
  function bindWinEvents() {
    $('winPlayAgainBtn').addEventListener('click', async () => {
      SoundManager.click();
      $('winOverlay').classList.add('hidden');
      ConfettiEngine.stop();

      if (currentMode === 'ai') {
        UIController.resetGameUI();
        startAIGame();
        return;
      }

      // Online mode — leave current room and create a new one
      const stones = UIController.getStoneCount();
      await RoomManager.leaveRoom();
      lastRoomStatus = null;
      UIController.resetGameUI();

      const roomId = await RoomManager.createRoom(stones);
      if (roomId) {
        UIController.renderWaiting(roomId);
        ScreenManager.show('waitingScreen');
        startRoomListener(roomId);
        Toast.info(`New room ${roomId} created!`);
      }
    });

    $('winLeaveBtn').addEventListener('click', async () => {
      SoundManager.click();
      $('winOverlay').classList.add('hidden');
      ConfettiEngine.stop();

      if (currentMode === 'ai') {
        cleanupAI();
        UIController.resetGameUI();
        await refreshAndShowDashboard();
        return;
      }

      // Online mode
      await RoomManager.leaveRoom();
      lastRoomStatus = null;
      UIController.resetGameUI();
      await AuthHandler.refreshUserDoc();
      UIController.renderDashboard(AuthHandler.getUser(), AuthHandler.getUserDoc());
      ScreenManager.show('dashboardScreen');
    });
  }

  // ════════════════════════════════════════════════════════
  //  AI GAME FUNCTIONS
  // ════════════════════════════════════════════════════════

  /** Start a new AI game with current settings */
  function startAIGame() {
    const stones = UIController.getAIStoneCount();
    const aiState = AIEngine.startGame(stones, playerGoesFirst);

    // Set game header for AI mode
    $('gameRoomPrefix').textContent = 'Mode:';
    $('gameRoomCode').textContent = 'vs AI';
    $('leaveGameBtn').textContent = 'Quit Game';

    UIController.resetGameUI();
    renderAIBoard(aiState);
    ScreenManager.show('gameScreen');

    if (!playerGoesFirst) {
      scheduleAIMove();
    }
  }

  /** Handle the human player's move in AI mode */
  function handleAIGameMove(count) {
    const state = AIEngine.getState();
    if (!state || state.currentTurn !== 'player') return;

    document.querySelectorAll('.btn-pick').forEach(b => b.disabled = true);
    SoundManager.stoneRemove();

    const result = AIEngine.handlePlayerMove(count);
    if (!result.success) {
      Toast.error(result.error);
      SoundManager.error();
      enableAIPickButtons(state.totalStones);
      return;
    }

    renderAIBoard(result.state);

    if (result.state.status === 'finished') {
      handleAIGameEnd(result.state);
      return;
    }

    // Schedule AI response after 800ms delay
    scheduleAIMove();
  }

  /** Schedule the AI's move with a natural delay */
  function scheduleAIMove() {
    if (aiTimerId) clearTimeout(aiTimerId);
    aiTimerId = setTimeout(() => {
      aiTimerId = null;
      const result = AIEngine.makeAIMove();
      if (!result) return;

      SoundManager.opponentMove();
      renderAIBoard(result.state);

      if (result.state.status === 'finished') {
        handleAIGameEnd(result.state);
      }
    }, 800);
  }

  /** Handle AI game end — show overlay + record win */
  function handleAIGameEnd(state) {
    const iWon = state.winner === 'player';

    $('winTitle').textContent = iWon ? 'You Win!' : 'You Lost';
    $('winSubtitle').textContent = iWon ? 'You outsmarted the AI! 🎉' : 'The AI was too clever! 💪';
    $('winOverlay').classList.remove('hidden');

    if (iWon) {
      ConfettiEngine.fire();
      SoundManager.win();
      recordAIWin();
    } else {
      SoundManager.error();
    }
  }

  /** Record an AI win — localStorage for guests, Firestore for logged-in */
  async function recordAIWin() {
    if (AuthHandler.getIsGuest()) {
      const current = parseInt(localStorage.getItem(LS_GUEST_AI_WINS) || '0', 10);
      localStorage.setItem(LS_GUEST_AI_WINS, String(current + 1));
      const ud = AuthHandler.getUserDoc();
      if (ud) ud.winsAI = current + 1;
    } else {
      const user = AuthHandler.getUser();
      if (user) {
        try {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, { winsAI: increment(1) });
          await AuthHandler.refreshUserDoc();
        } catch (err) {
          console.error('Failed to record AI win:', err);
        }
      }
    }
    refreshDashboardData();
  }

  /** Build synthetic game data from AI state and render */
  function renderAIBoard(aiState) {
    const user = AuthHandler.getUser();
    const isGuest = AuthHandler.getIsGuest();
    const playerUid = getPlayerUid();

    const aiData = {
      roomId: 'vs AI',
      player1: playerUid,
      player2: 'ai',
      player1Name: isGuest ? 'Guest' : (user?.displayName || 'Player'),
      player2Name: '🤖 AI',
      player1Photo: isGuest ? GUEST_AVATAR : (user?.photoURL || ''),
      player2Photo: AI_AVATAR,
      currentTurn: aiState.currentTurn === 'player' ? playerUid : (aiState.currentTurn === 'ai' ? 'ai' : null),
      totalStones: aiState.totalStones,
      initialStones: aiState.initialStones,
      status: aiState.status,
      winner: aiState.winner === 'player' ? playerUid : (aiState.winner === 'ai' ? 'ai' : null)
    };

    UIController.renderGameBoard(aiData, playerUid);
  }

  /** Re-enable pick buttons in AI mode based on remaining stones */
  function enableAIPickButtons(stonesLeft) {
    document.querySelectorAll('.btn-pick').forEach(btn => {
      const pick = parseInt(btn.dataset.pick);
      btn.disabled = pick > stonesLeft;
    });
  }

  /** Get the player's UID (real or 'guest') */
  function getPlayerUid() {
    return AuthHandler.getIsGuest() ? 'guest' : (AuthHandler.getUser()?.uid || 'guest');
  }

  /** Refresh dashboard data without switching screens */
  function refreshDashboardData() {
    const user = AuthHandler.getIsGuest()
      ? { displayName: 'Guest', photoURL: '', email: '' }
      : AuthHandler.getUser();
    if (user) UIController.renderDashboard(user, AuthHandler.getUserDoc());
  }

  /** Refresh user data and return to dashboard */
  async function refreshAndShowDashboard() {
    if (!AuthHandler.getIsGuest()) {
      await AuthHandler.refreshUserDoc();
    }
    refreshDashboardData();
    ScreenManager.show('dashboardScreen');
  }

  // ════════════════════════════════════════════════════════
  //  ROOM LISTENER (Online Mode)
  // ════════════════════════════════════════════════════════
  function startRoomListener(roomId) {
    const myUid = AuthHandler.getUser()?.uid;
    lastRoomStatus = null;

    RoomManager.listenToRoom(roomId, (data) => {
      if (!data) {
        Toast.info('Room was closed.');
        RoomManager.stopListening();
        RoomManager.setCurrentRoomId(null);
        lastRoomStatus = null;
        UIController.resetGameUI();
        ScreenManager.show('dashboardScreen');
        return;
      }

      // Transition: waiting → playing
      if (lastRoomStatus === 'waiting' && data.status === 'playing') {
        $('gameRoomPrefix').textContent = 'Room:';
        $('leaveGameBtn').textContent = 'Leave Room';
        UIController.resetGameUI();
        ScreenManager.show('gameScreen');
        Toast.success('Opponent joined! Game starting!');
        SoundManager.click();
      }

      // Detect opponent move sound
      if (data.status === 'playing' && data.currentTurn === myUid && lastRoomStatus === 'playing') {
        SoundManager.opponentMove();
      }

      // Render game
      if (data.status === 'playing' || data.status === 'finished') {
        UIController.renderGameBoard(data, myUid);
      }

      // Game finished
      if (data.status === 'finished' && lastRoomStatus !== 'finished') {
        const iWon = data.winner === myUid;
        $('winTitle').textContent = iWon ? 'You Win!' : 'You Lost';
        $('winSubtitle').textContent = iWon ? 'Incredible strategy! 🎉' : 'Better luck next time! 💪';
        $('winOverlay').classList.remove('hidden');

        if (iWon) {
          ConfettiEngine.fire();
          SoundManager.win();
        } else {
          SoundManager.error();
        }

        // Refresh win counts
        AuthHandler.refreshUserDoc().then(() => {
          UIController.renderDashboard(AuthHandler.getUser(), AuthHandler.getUserDoc());
        });
      }

      lastRoomStatus = data.status;
    });
  }

  return { init };
})();


/* ═══════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', App.init);