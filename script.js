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
    stop() { running = false; if (animId) cancelAnimationFrame(animId); }
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
          return { allowed: true, userData: userSnap.data() };
        }

        // New user — check counter atomically
        const currentCount = statsSnap.exists() ? (statsSnap.data().userCount || 0) : 0;

        if (currentCount >= 100) {
          return { allowed: false };
        }

        // Register new user + increment counter in same transaction
        const newUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          wins: 0,
          createdAt: serverTimestamp()
        };

        transaction.set(userRef, newUser);

        if (statsSnap.exists()) {
          transaction.update(statsRef, { userCount: increment(1) });
        } else {
          // First user ever — create the meta/stats doc
          transaction.set(statsRef, { userCount: 1 });
        }

        return { allowed: true, userData: newUser };
      });

      if (result.allowed) {
        userDoc = result.userData;
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

  return { signIn, logout, getUser, getUserDoc, setUser, setUserDoc, userLimitCheck, refreshUserDoc };
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

          // Increment winner's win count atomically
          if (winner) {
            const winnerRef = doc(db, 'users', winner);
            transaction.update(winnerRef, { wins: increment(1) });
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

          // Increment winner's win count
          const winnerRef = doc(db, 'users', user.uid);
          transaction.update(winnerRef, { wins: increment(1) });
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
   9. UI CONTROLLER
   ═══════════════════════════════════════════════════════════ */
const UIController = (() => {

  // ── DOM References ────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  let stoneCount = 17;
  let previousStoneCount = null;  // track previous stone count for animation

  // ── Dashboard ─────────────────────────────────────────────
  function renderDashboard(user, userDoc) {
    $('userAvatar').src = user.photoURL || '';
    $('userName').textContent = user.displayName || 'Player';
    $('userWins').textContent = userDoc?.wins || 0;
    $('profilePhoto').src = user.photoURL || '';
    $('profileName').textContent = user.displayName || 'Player';
    $('profileEmail').textContent = user.email || '';
    $('profileWins').textContent = userDoc?.wins || 0;
    $('stoneCountDisplay').textContent = stoneCount;
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

  return { renderDashboard, renderWaiting, renderGameBoard, resetGameUI, initStepper, getStoneCount };
})();


/* ═══════════════════════════════════════════════════════════
   10. APP — Main Orchestrator
   ═══════════════════════════════════════════════════════════ */
const App = (() => {
  const $ = (id) => document.getElementById(id);
  let lastRoomStatus = null;

  /** Initialize the entire application */
  function init() {
    // Start visual engines
    ParticleEngine.init($('particleCanvas'));
    ConfettiEngine.init($('confettiCanvas'));

    // Init UI
    UIController.initStepper();

    // Bind events
    bindAuthEvents();
    bindDashboardEvents();
    bindWaitingEvents();
    bindGameEvents();
    bindWinEvents();

    // Auth state listener — handles login, refresh, and logout
    onAuthStateChanged(auth, async (user) => {
      if (user) {
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

        // Refresh user doc to get latest wins count
        await AuthHandler.refreshUserDoc();
        UIController.renderDashboard(user, AuthHandler.getUserDoc());

        // Check if user was in an active room (page refresh scenario)
        const savedRoom = RoomManager.getCurrentRoomId();
        if (savedRoom) {
          // Attempt to reconnect to the room
          try {
            const roomSnap = await getDoc(doc(db, 'rooms', savedRoom));
            if (roomSnap.exists()) {
              const roomData = roomSnap.data();
              const isPlayer = roomData.player1 === user.uid || roomData.player2 === user.uid;
              if (isPlayer && roomData.status !== 'finished') {
                // Reconnect to active room
                if (roomData.status === 'waiting') {
                  UIController.renderWaiting(savedRoom);
                  ScreenManager.show('waitingScreen');
                } else {
                  UIController.resetGameUI();
                  ScreenManager.show('gameScreen');
                }
                startRoomListener(savedRoom);
                Toast.info('Reconnected to your game!');
                return;
              }
            }
            // Room gone or finished — clear it
            RoomManager.setCurrentRoomId(null);
          } catch (_) {
            RoomManager.setCurrentRoomId(null);
          }
        }

        ScreenManager.show('dashboardScreen');
      } else {
        // Logged out — clean up everything
        AuthHandler.setUser(null);
        AuthHandler.setUserDoc(null);
        RoomManager.stopListening();
        RoomManager.setCurrentRoomId(null);
        ScreenManager.show('authScreen');
      }
    });
  }

  // ── Auth Events ─────────────────────────────────────────
  function bindAuthEvents() {
    $('googleSignInBtn').addEventListener('click', () => {
      SoundManager.click();
      AuthHandler.signIn();
    });
  }

  // ── Dashboard Events ────────────────────────────────────
  function bindDashboardEvents() {
    $('logoutBtn').addEventListener('click', async () => {
      SoundManager.click();
      await AuthHandler.logout();
    });

    $('createRoomBtn').addEventListener('click', async () => {
      SoundManager.click();
      $('createRoomBtn').disabled = true;
      $('createRoomBtn').textContent = 'Creating…';

      try {
        const roomId = await RoomManager.createRoom(UIController.getStoneCount());
        if (roomId) {
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
    // Pick buttons
    document.querySelectorAll('.btn-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        const count = parseInt(btn.dataset.pick);
        const roomId = RoomManager.getCurrentRoomId();
        if (!roomId) return;

        // Disable all buttons while processing
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

      // Leave current room and create a new one with same settings
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
      await RoomManager.leaveRoom();
      lastRoomStatus = null;
      UIController.resetGameUI();
      await AuthHandler.refreshUserDoc();
      UIController.renderDashboard(AuthHandler.getUser(), AuthHandler.getUserDoc());
      ScreenManager.show('dashboardScreen');
    });
  }

  // ── Room Listener ───────────────────────────────────────
  function startRoomListener(roomId) {
    const myUid = AuthHandler.getUser()?.uid;
    lastRoomStatus = null;

    RoomManager.listenToRoom(roomId, (data) => {
      if (!data) {
        // Room deleted
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

        // Refresh win count
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