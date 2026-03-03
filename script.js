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
  getDocs, query, where, onSnapshot, runTransaction,
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

  /** Check 100-user limit and register/fetch user */
  async function userLimitCheck(user) {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      // Existing user — allowed
      userDoc = snap.data();
      return true;
    }

    // New user — check count
    const usersSnap = await getDocs(collection(db, 'users'));
    if (usersSnap.size >= 100) {
      return false; // Limit reached
    }

    // Register new user
    const newUser = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      wins: 0,
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, newUser);
    userDoc = newUser;
    return true;
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

  /** Create a new room */
  async function createRoom(totalStones = 17) {
    const user = AuthHandler.getUser();
    if (!user) return null;

    const roomId = generateCode();
    const roomRef = doc(db, 'rooms', roomId);

    // Check collision (very unlikely)
    const existing = await getDoc(roomRef);
    if (existing.exists()) return createRoom(totalStones); // Retry

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

    await setDoc(roomRef, roomData);
    currentRoomId = roomId;
    return roomId;
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

  /** Leave the current room */
  async function leaveRoom() {
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
    if (!currentRoomId) return;

    const user = AuthHandler.getUser();
    if (!user) { currentRoomId = null; return; }

    const roomRef = doc(db, 'rooms', currentRoomId);
    try {
      const snap = await getDoc(roomRef);
      if (snap.exists()) {
        const data = snap.data();
        // If game is waiting / we're the only player → delete room
        if (data.status === 'waiting' && data.player1 === user.uid) {
          await deleteDoc(roomRef);
        }
        // If game is playing → set status to finished (forfeit)
        else if (data.status === 'playing') {
          const winner = data.player1 === user.uid ? data.player2 : data.player1;
          await updateDoc(roomRef, { status: 'finished', winner });
        }
      }
    } catch (_) { /* silent */ }

    currentRoomId = null;
  }

  /** Listen to room changes in real-time */
  function listenToRoom(roomId, callback) {
    if (unsubRoom) unsubRoom();
    const roomRef = doc(db, 'rooms', roomId);
    unsubRoom = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        callback(snap.data());
      } else {
        callback(null);
      }
    }, (err) => {
      console.error('Room listener error:', err);
      Toast.error('Connection lost. Try refreshing.');
    });
  }

  /** Stop listening */
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

  /** Make a move — removes `count` stones */
  async function handleMove(roomId, count) {
    const user = AuthHandler.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

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

        // Validate: count between 1-4
        if (count < 1 || count > 4) throw new Error('Invalid move: pick 1-4 stones.');

        // Validate: can't take more than available
        if (count > data.totalStones) throw new Error('Not enough stones remaining.');

        const newTotal = data.totalStones - count;
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

    // Auth state listener
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        AuthHandler.setUser(user);
        // Fetch user doc
        const allowed = await AuthHandler.userLimitCheck(user);
        if (!allowed) {
          await signOut(auth);
          $('authError').textContent = 'User limit reached. Maximum 100 users allowed.';
          $('authError').classList.remove('hidden');
          ScreenManager.show('authScreen');
          return;
        }
        await AuthHandler.refreshUserDoc();
        UIController.renderDashboard(user, AuthHandler.getUserDoc());
        ScreenManager.show('dashboardScreen');
      } else {
        AuthHandler.setUser(null);
        AuthHandler.setUserDoc(null);
        RoomManager.stopListening();
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