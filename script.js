/* ============================================================
   STONE GAME — ULTRA-PREMIUM GAME ENGINE
   ============================================================
   Modular architecture:
     1. SoundManager   — Web Audio API sound effects
     2. ParticleEngine  — Canvas particle background
     3. ConfettiEngine  — Win celebration confetti
     4. GameState       — Pure game logic (no DOM)
     5. UIController    — DOM rendering & interaction
     6. CommentaryEngine— Dynamic game commentary
     7. ScoreManager    — localStorage persistence
     8. ThemeManager    — Theme switching
     9. App             — Main orchestrator
   ============================================================ */

'use strict';

/* -------------------------------------------------------
   1. SOUND MANAGER
   ------------------------------------------------------- */

const SoundManager = (() => {
  let audioCtx = null;
  let enabled = true;

  /** Lazily create AudioContext (requires user gesture) */
  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  /** Play a synthesized tone */
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
    } catch (_) { /* Silently fail if audio not supported */ }
  }

  return {
    /** Toggle sound on/off */
    setEnabled(val) { enabled = val; },

    /** UI click sound */
    click() {
      playTone(800, 'sine', 0.08, 0.1);
    },

    /** Stone removal sound */
    stoneRemove() {
      playTone(520, 'triangle', 0.15, 0.12);
      setTimeout(() => playTone(380, 'triangle', 0.12, 0.08), 60);
    },

    /** Win celebration sound */
    win() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        setTimeout(() => playTone(freq, 'sine', 0.3, 0.12), i * 120);
      });
    },

    /** AI move sound */
    aiMove() {
      playTone(440, 'sawtooth', 0.1, 0.06);
      setTimeout(() => playTone(660, 'sine', 0.15, 0.1), 80);
    }
  };
})();


/* -------------------------------------------------------
   2. PARTICLE ENGINE (Background)
   ------------------------------------------------------- */

const ParticleEngine = (() => {
  let canvas, ctx;
  let particles = [];
  let animId = null;
  const PARTICLE_COUNT = 50;

  /** Particle object */
  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 3 + 1,
      alpha: Math.random() * 0.5 + 0.1
    };
  }

  /** Resize canvas to fill window */
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  /** Draw a single frame */
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* Read CSS variable for particle color */
    const style = getComputedStyle(document.body);
    const color = style.getPropertyValue('--accent').trim() || '#7c3aed';

    particles.forEach(p => {
      /* Move */
      p.x += p.vx;
      p.y += p.vy;

      /* Wrap around edges */
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      /* Draw circle */
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });

    /* Draw connections */
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
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      particles = Array.from({ length: PARTICLE_COUNT }, createParticle);
      draw();
    },
    destroy() {
      if (animId) cancelAnimationFrame(animId);
    }
  };
})();


/* -------------------------------------------------------
   3. CONFETTI ENGINE (Win celebration)
   ------------------------------------------------------- */

const ConfettiEngine = (() => {
  let canvas, ctx;
  let pieces = [];
  let animId = null;
  let running = false;
  const COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function createPiece() {
    return {
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * canvas.height * 0.5,
      w: Math.random() * 10 + 5,
      h: Math.random() * 6 + 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 3 + 2,
      alpha: 1
    };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04; /* gravity */
      p.rotation += p.rotSpeed;

      /* Fade out near bottom */
      if (p.y > canvas.height * 0.8) {
        p.alpha -= 0.02;
        if (p.alpha < 0) p.alpha = 0;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    /* Remove dead pieces */
    pieces = pieces.filter(p => p.alpha > 0 && p.y < canvas.height + 20);

    if (pieces.length > 0) {
      animId = requestAnimationFrame(draw);
    } else {
      running = false;
    }
  }

  return {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
    },

    /** Launch confetti burst */
    fire() {
      resize();
      pieces = Array.from({ length: 200 }, createPiece);
      if (!running) {
        running = true;
        draw();
      }
    }
  };
})();


/* -------------------------------------------------------
   4. GAME STATE (Pure logic, no DOM)
   ------------------------------------------------------- */

const GameState = (() => {
  let totalStones = 17;
  let stonesRemaining = 17;
  let currentPlayer = 1; // 1 = Player/P1, 2 = AI/P2
  let mode = 'pvai'; // 'pvai' | 'pvp'
  let gameOver = false;
  let winner = null;

  return {
    /** Reset the game with given stone count */
    reset(stoneCount) {
      totalStones = stoneCount;
      stonesRemaining = stoneCount;
      currentPlayer = 1;
      gameOver = false;
      winner = null;
    },

    /** Attempt to remove stones. Returns { success, removed } */
    removeStones(count) {
      if (gameOver) return { success: false, removed: 0 };
      if (count < 1 || count > 4) return { success: false, removed: 0 };
      if (count > stonesRemaining) return { success: false, removed: 0 };

      stonesRemaining -= count;

      /* Check win: last stone taken wins */
      if (stonesRemaining <= 0) {
        gameOver = true;
        winner = currentPlayer;
        return { success: true, removed: count, gameOver: true, winner: currentPlayer };
      }

      /* Switch turn */
      currentPlayer = currentPlayer === 1 ? 2 : 1;
      return { success: true, removed: count, gameOver: false };
    },

    /** AI calculates optimal move */
    getAIMove() {
      let move = stonesRemaining % 5;
      if (move === 0) move = 1; // fallback — can't guarantee win
      if (move > 4) move = 4;
      return move;
    },

    /* Getters */
    getStones() { return stonesRemaining; },
    getTotalStones() { return totalStones; },
    getCurrentPlayer() { return currentPlayer; },
    getMode() { return mode; },
    setMode(m) { mode = m; },
    isGameOver() { return gameOver; },
    getWinner() { return winner; }
  };
})();


/* -------------------------------------------------------
   5. COMMENTARY ENGINE
   ------------------------------------------------------- */

const CommentaryEngine = (() => {
  const feed = [];

  /** Generate AI commentary based on context */
  function analyzeAIMove(move, remaining) {
    if (remaining % 5 === 0) {
      return { icon: '🧠', text: `AI takes ${move} — forces a multiple of 5! Optimal play.` };
    }
    if (remaining === 1) {
      return { icon: '😰', text: `Only 1 stone left. This is the endgame!` };
    }
    if (move === 1 && remaining % 5 !== 0) {
      return { icon: '🎲', text: `AI takes 1 — playing safe, hoping you slip up.` };
    }
    return { icon: '🤖', text: `AI removes ${move} stone${move > 1 ? 's' : ''}. ${remaining} remaining.` };
  }

  /** Generate player commentary */
  function analyzePlayerMove(move, remaining, player) {
    const name = player === 1 ? 'Player' : 'Player 2';
    if (remaining % 5 === 0) {
      return { icon: '⚠️', text: `${name} takes ${move} — left a multiple of 5. You gave control!` };
    }
    if (remaining % 5 !== 0 && remaining > 0) {
      return { icon: '✨', text: `Brilliant move! ${name} takes ${move}, leaving ${remaining}. Solid strategy!` };
    }
    return { icon: '💎', text: `${name} removes ${move}. ${remaining} stones remaining.` };
  }

  return {
    analyzeAIMove,
    analyzePlayerMove,

    /** Win commentary */
    getWinComment(winner, mode) {
      if (mode === 'pvai') {
        if (winner === 1) {
          return { icon: '🎉', text: 'Incredible! You outsmarted the AI! A masterful victory!' };
        }
        return { icon: '🤖', text: 'AI wins with perfect strategy. Can you find the counter?' };
      }
      const name = winner === 1 ? 'Player 1' : 'Player 2';
      return { icon: '🏆', text: `${name} claims victory! What a game!` };
    },

    /** Game start commentary */
    getStartComment(stoneCount) {
      return { icon: '🎮', text: `New game! ${stoneCount} stones on the board. Remove 1–4 per turn. Take the last stone to win!` };
    }
  };
})();


/* -------------------------------------------------------
   6. SCORE MANAGER (localStorage)
   ------------------------------------------------------- */

const ScoreManager = (() => {
  const STORAGE_KEY = 'stoneGame_scores';

  const defaultScores = {
    playerWins: 0,
    aiWins: 0,
    p1Wins: 0,
    p2Wins: 0
  };

  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? { ...defaultScores, ...JSON.parse(data) } : { ...defaultScores };
    } catch {
      return { ...defaultScores };
    }
  }

  function save(scores) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    } catch { /* localStorage might be full or disabled */ }
  }

  return {
    /** Get current scores */
    getScores() {
      return load();
    },

    /** Record a win */
    recordWin(winner, mode) {
      const scores = load();
      if (mode === 'pvai') {
        if (winner === 1) scores.playerWins++;
        else scores.aiWins++;
      } else {
        if (winner === 1) scores.p1Wins++;
        else scores.p2Wins++;
      }
      save(scores);
      return scores;
    },

    /** Reset all scores */
    reset() {
      save({ ...defaultScores });
      return { ...defaultScores };
    }
  };
})();


/* -------------------------------------------------------
   7. THEME MANAGER
   ------------------------------------------------------- */

const ThemeManager = (() => {
  const STORAGE_KEY = 'stoneGame_theme';
  let current = 'dark';

  return {
    init() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && ['dark', 'neon', 'minimal'].includes(saved)) {
          current = saved;
        }
      } catch { /* ignore */ }
      document.body.setAttribute('data-theme', current);
      ThemeManager.updateButtons();
    },

    set(theme) {
      current = theme;
      document.body.setAttribute('data-theme', theme);
      try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
      ThemeManager.updateButtons();
    },

    get() { return current; },

    updateButtons() {
      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === current);
      });
    }
  };
})();


/* -------------------------------------------------------
   8. UI CONTROLLER (DOM manipulation)
   ------------------------------------------------------- */

const UIController = (() => {
  /* Cached DOM elements */
  const el = {};

  function cacheElements() {
    el.stoneGrid = document.getElementById('stoneGrid');
    el.stonesRemaining = document.getElementById('stonesRemaining');
    el.turnIndicator = document.getElementById('turnIndicator');
    el.turnAvatar = document.getElementById('turnAvatar');
    el.turnName = document.getElementById('turnName');
    el.pickButtons = document.getElementById('pickButtons');
    el.commentaryFeed = document.getElementById('commentaryFeed');
    el.winOverlay = document.getElementById('winOverlay');
    el.winTitle = document.getElementById('winTitle');
    el.winSubtitle = document.getElementById('winSubtitle');
    el.winTrophy = document.getElementById('winTrophy');
    el.scorePlayer = document.getElementById('scorePlayer');
    el.scoreAI = document.getElementById('scoreAI');
    el.scoreP1 = document.getElementById('scoreP1');
    el.scoreP2 = document.getElementById('scoreP2');
    el.scoreboardPvAI = document.getElementById('scoreboardPvAI');
    el.scoreboardPvP = document.getElementById('scoreboardPvP');
    el.stoneCountDisplay = document.getElementById('stoneCountDisplay');
  }

  /** Render the stone grid */
  function renderStones(count) {
    el.stoneGrid.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const stone = document.createElement('div');
      stone.className = 'stone floating';
      stone.textContent = '💎';
      stone.style.animationDelay = `${i * 0.03}s`;
      el.stoneGrid.appendChild(stone);
    }
  }

  /** Animate removing stones from the grid */
  function animateRemoveStones(count) {
    return new Promise(resolve => {
      const stones = Array.from(el.stoneGrid.querySelectorAll('.stone:not(.removing)'));
      const toRemove = stones.slice(-count); /* Remove from the end */

      toRemove.forEach((stone, i) => {
        setTimeout(() => {
          stone.classList.remove('floating');
          stone.classList.add('removing');
        }, i * 80);
      });

      /* Wait for animation to complete, then actually remove */
      setTimeout(() => {
        toRemove.forEach(s => s.remove());
        resolve();
      }, count * 80 + 550);
    });
  }

  /** Update turn indicator */
  function updateTurnIndicator(player, mode) {
    /* Remove all glow classes */
    el.turnIndicator.classList.remove('glow-p1', 'glow-p2', 'glow-ai');

    if (mode === 'pvai') {
      if (player === 1) {
        el.turnAvatar.textContent = '🧑';
        el.turnName.textContent = 'Your Turn';
        el.turnIndicator.classList.add('glow-p1');
      } else {
        el.turnAvatar.textContent = '🤖';
        el.turnName.textContent = 'AI Thinking...';
        el.turnIndicator.classList.add('glow-ai');
      }
    } else {
      if (player === 1) {
        el.turnAvatar.textContent = '🔵';
        el.turnName.textContent = 'Player 1';
        el.turnIndicator.classList.add('glow-p1');
      } else {
        el.turnAvatar.textContent = '🔴';
        el.turnName.textContent = 'Player 2';
        el.turnIndicator.classList.add('glow-p2');
      }
    }
  }

  /** Update remaining stones counter with animation */
  function updateStonesCount(count) {
    el.stonesRemaining.textContent = count;
    el.stonesRemaining.style.transform = 'scale(1.3)';
    setTimeout(() => { el.stonesRemaining.style.transform = 'scale(1)'; }, 200);
  }

  /** Update pick button states */
  function updatePickButtons(remaining, disabled = false) {
    const buttons = el.pickButtons.querySelectorAll('.btn-pick');
    buttons.forEach(btn => {
      const pick = parseInt(btn.dataset.pick);
      btn.disabled = disabled || pick > remaining;
    });
  }

  /** Add commentary message */
  function addComment(icon, text) {
    const item = document.createElement('div');
    item.className = 'comment-item fade-in';
    item.innerHTML = `<span class="comment-icon">${icon}</span><p>${text}</p>`;
    el.commentaryFeed.prepend(item);

    /* Keep feed manageable */
    const items = el.commentaryFeed.querySelectorAll('.comment-item');
    if (items.length > 20) {
      items[items.length - 1].remove();
    }
  }

  /** Clear commentary */
  function clearCommentary() {
    el.commentaryFeed.innerHTML = '';
  }

  /** Show AI thinking indicator */
  function showAIThinking() {
    const item = document.createElement('div');
    item.className = 'comment-item fade-in';
    item.id = 'aiThinkingComment';
    item.innerHTML = `
      <span class="comment-icon">🤖</span>
      <p>AI is thinking <span class="ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></p>
    `;
    el.commentaryFeed.prepend(item);
  }

  /** Remove AI thinking indicator */
  function removeAIThinking() {
    const thinking = document.getElementById('aiThinkingComment');
    if (thinking) thinking.remove();
  }

  /** Show win overlay */
  function showWinOverlay(title, subtitle) {
    el.winTitle.textContent = title;
    el.winSubtitle.textContent = subtitle;
    el.winOverlay.classList.remove('hidden');
  }

  /** Hide win overlay */
  function hideWinOverlay() {
    el.winOverlay.classList.add('hidden');
  }

  /** Update scoreboard display */
  function updateScoreboard(scores, mode) {
    el.scorePlayer.textContent = scores.playerWins;
    el.scoreAI.textContent = scores.aiWins;
    el.scoreP1.textContent = scores.p1Wins;
    el.scoreP2.textContent = scores.p2Wins;

    /* Show correct scoreboard */
    el.scoreboardPvAI.classList.toggle('hidden', mode !== 'pvai');
    el.scoreboardPvP.classList.toggle('hidden', mode !== 'pvp');
  }

  /** Animate score increment */
  function animateScore(element) {
    element.classList.add('score-pop');
    setTimeout(() => element.classList.remove('score-pop'), 500);
  }

  /** Set active mode button */
  function setActiveMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  /** Update stone count display */
  function updateStoneCountDisplay(count) {
    el.stoneCountDisplay.textContent = count;
  }

  return {
    cacheElements,
    renderStones,
    animateRemoveStones,
    updateTurnIndicator,
    updateStonesCount,
    updatePickButtons,
    addComment,
    clearCommentary,
    showAIThinking,
    removeAIThinking,
    showWinOverlay,
    hideWinOverlay,
    updateScoreboard,
    animateScore,
    setActiveMode,
    updateStoneCountDisplay,
    el
  };
})();


/* -------------------------------------------------------
   9. APP — Main Orchestrator
   ------------------------------------------------------- */

const App = (() => {
  let stoneCount = 17;
  let isProcessing = false; /* Prevents double-clicks during animations */

  /** Initialize the app */
  function init() {
    UIController.cacheElements();
    ThemeManager.init();
    ParticleEngine.init(document.getElementById('particleCanvas'));
    ConfettiEngine.init(document.getElementById('confettiCanvas'));

    /* Load saved settings */
    loadSettings();

    /* Start game */
    startGame();

    /* Bind events */
    bindEvents();
  }

  /** Load settings from localStorage */
  function loadSettings() {
    try {
      const saved = localStorage.getItem('stoneGame_stoneCount');
      if (saved) {
        const count = parseInt(saved);
        if (count >= 5 && count <= 50) stoneCount = count;
      }
      const savedMode = localStorage.getItem('stoneGame_mode');
      if (savedMode && ['pvai', 'pvp'].includes(savedMode)) {
        GameState.setMode(savedMode);
      }
      const savedSound = localStorage.getItem('stoneGame_sound');
      if (savedSound !== null) {
        const soundOn = savedSound === 'true';
        document.getElementById('soundToggle').checked = soundOn;
        SoundManager.setEnabled(soundOn);
      }
    } catch { /* ignore */ }
  }

  /** Save settings */
  function saveSettings() {
    try {
      localStorage.setItem('stoneGame_stoneCount', stoneCount.toString());
      localStorage.setItem('stoneGame_mode', GameState.getMode());
      localStorage.setItem('stoneGame_sound', document.getElementById('soundToggle').checked.toString());
    } catch { /* ignore */ }
  }

  /** Start or restart the game */
  function startGame() {
    isProcessing = false;
    GameState.reset(stoneCount);
    UIController.updateStoneCountDisplay(stoneCount);
    UIController.renderStones(stoneCount);
    UIController.updateStonesCount(stoneCount);
    UIController.updateTurnIndicator(1, GameState.getMode());
    UIController.updatePickButtons(stoneCount);
    UIController.hideWinOverlay();
    UIController.setActiveMode(GameState.getMode());
    UIController.clearCommentary();

    const startComment = CommentaryEngine.getStartComment(stoneCount);
    UIController.addComment(startComment.icon, startComment.text);

    const scores = ScoreManager.getScores();
    UIController.updateScoreboard(scores, GameState.getMode());
  }

  /** Handle player picking stones */
  async function handlePick(count) {
    if (isProcessing || GameState.isGameOver()) return;

    SoundManager.click();

    const remaining = GameState.getStones();
    if (count > remaining) return;

    isProcessing = true;

    /* Disable buttons */
    UIController.updatePickButtons(0, true);

    /* Remove stones from logic */
    const result = GameState.removeStones(count);
    if (!result.success) {
      isProcessing = false;
      UIController.updatePickButtons(GameState.getStones());
      return;
    }

    /* Sound */
    SoundManager.stoneRemove();

    /* Animate removal */
    await UIController.animateRemoveStones(count);

    /* Update UI */
    UIController.updateStonesCount(GameState.getStones());

    /* Commentary */
    const comment = CommentaryEngine.analyzePlayerMove(
      count, GameState.getStones(), GameState.getCurrentPlayer() === 1 ? 1 : 2
    );
    /* Determine who just moved for commentary purposes */
    if (!result.gameOver) {
      /* The player who moved was the player BEFORE the switch */
      const mover = GameState.getCurrentPlayer() === 1 ? 2 : 1;
      const playerComment = CommentaryEngine.analyzePlayerMove(count, GameState.getStones(), mover);
      UIController.addComment(playerComment.icon, playerComment.text);
    }

    /* Check for win */
    if (result.gameOver) {
      handleWin(result.winner);
      return;
    }

    /* Update turn */
    UIController.updateTurnIndicator(GameState.getCurrentPlayer(), GameState.getMode());

    /* If PvAI and it's AI's turn */
    if (GameState.getMode() === 'pvai' && GameState.getCurrentPlayer() === 2) {
      await handleAITurn();
    } else {
      UIController.updatePickButtons(GameState.getStones());
      isProcessing = false;
    }
  }

  /** Handle AI turn with thinking delay */
  async function handleAITurn() {
    UIController.updatePickButtons(0, true);
    UIController.showAIThinking();

    /* AI thinking delay (800ms) */
    await new Promise(r => setTimeout(r, 800));

    UIController.removeAIThinking();

    const aiMove = GameState.getAIMove();
    const result = GameState.removeStones(aiMove);

    SoundManager.aiMove();

    /* Animate */
    await UIController.animateRemoveStones(aiMove);
    UIController.updateStonesCount(GameState.getStones());

    /* AI commentary */
    const aiComment = CommentaryEngine.analyzeAIMove(aiMove, GameState.getStones());
    UIController.addComment(aiComment.icon, aiComment.text);

    if (result.gameOver) {
      handleWin(result.winner);
      return;
    }

    UIController.updateTurnIndicator(GameState.getCurrentPlayer(), GameState.getMode());
    UIController.updatePickButtons(GameState.getStones());
    isProcessing = false;
  }

  /** Handle game win */
  function handleWin(winner) {
    const mode = GameState.getMode();
    SoundManager.win();
    ConfettiEngine.fire();

    /* Record score */
    const scores = ScoreManager.recordWin(winner, mode);
    UIController.updateScoreboard(scores, mode);

    /* Animate the winning score */
    if (mode === 'pvai') {
      UIController.animateScore(winner === 1 ? UIController.el.scorePlayer : UIController.el.scoreAI);
    } else {
      UIController.animateScore(winner === 1 ? UIController.el.scoreP1 : UIController.el.scoreP2);
    }

    /* Commentary */
    const winComment = CommentaryEngine.getWinComment(winner, mode);
    UIController.addComment(winComment.icon, winComment.text);

    /* Win overlay */
    let title, subtitle;
    if (mode === 'pvai') {
      title = winner === 1 ? '🎉 You Win!' : '🤖 AI Wins!';
      subtitle = winner === 1
        ? 'Incredible strategy! You beat the optimal AI!'
        : 'The AI played perfectly. Try a different opening!';
    } else {
      title = winner === 1 ? '🔵 Player 1 Wins!' : '🔴 Player 2 Wins!';
      subtitle = 'Great game! What a match!';
    }
    UIController.showWinOverlay(title, subtitle);
    isProcessing = false;
  }

  /** Bind all event listeners */
  function bindEvents() {
    /* Pick buttons */
    document.querySelectorAll('.btn-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.pick);
        handlePick(count);
      });
    });

    /* Restart */
    document.getElementById('restartBtn').addEventListener('click', () => {
      SoundManager.click();
      startGame();
    });

    /* Play again (win overlay) */
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      SoundManager.click();
      startGame();
    });

    /* Mode toggle */
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        SoundManager.click();
        GameState.setMode(btn.dataset.mode);
        saveSettings();
        startGame();
      });
    });

    /* Theme buttons */
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        SoundManager.click();
        ThemeManager.set(btn.dataset.theme);
      });
    });

    /* Stone count stepper */
    document.getElementById('stoneIncrement').addEventListener('click', () => {
      if (stoneCount < 50) {
        stoneCount++;
        UIController.updateStoneCountDisplay(stoneCount);
        SoundManager.click();
        saveSettings();
        startGame();
      }
    });

    document.getElementById('stoneDecrement').addEventListener('click', () => {
      if (stoneCount > 5) {
        stoneCount--;
        UIController.updateStoneCountDisplay(stoneCount);
        SoundManager.click();
        saveSettings();
        startGame();
      }
    });

    /* Sound toggle */
    document.getElementById('soundToggle').addEventListener('change', (e) => {
      SoundManager.setEnabled(e.target.checked);
      if (e.target.checked) SoundManager.click();
      saveSettings();
    });

    /* Reset scores */
    document.getElementById('resetScores').addEventListener('click', () => {
      SoundManager.click();
      const scores = ScoreManager.reset();
      UIController.updateScoreboard(scores, GameState.getMode());
    });

    /* Keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      if (isProcessing || GameState.isGameOver()) return;
      const key = parseInt(e.key);
      if (key >= 1 && key <= 4) {
        handlePick(key);
      }
      if (e.key === 'r' || e.key === 'R') {
        startGame();
      }
    });
  }

  return { init };
})();


/* -------------------------------------------------------
   BOOT
   ------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', App.init);
