/**
 * UNDERCOVER PARTY GAME — GAME LOGIC
 * Handles all game state, UI transitions, voting, elimination,
 * win conditions, scoreboard, and sound effects.
 * ─────────────────────────────────────────────────────────────
 * State Machine:
 *   home → setup → reveal (per-player) → discussion → voting → elimination → win/next-round
 */

/* ═══════════════════════════════════
   SOUND ENGINE
═══════════════════════════════════ */
const SFX = (() => {
  let muted = false;
  const ctx = window.AudioContext ? new AudioContext() : null;

  function tone(freq, type, dur, vol = 0.15, delay = 0) {
    if (muted || !ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.05);
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  return {
    toggle() { muted = !muted; return muted; },
    isMuted() { return muted; },
    click()   { resume(); tone(880, 'sine', 0.1); },
    reveal()  { resume(); tone(660,'sine',0.12); tone(880,'sine',0.12,0.15,0.1); tone(1100,'sine',0.12,0.15,0.2); },
    vote()    { resume(); tone(440,'square',0.1,0.1); },
    elim()    { resume(); tone(220,'sawtooth',0.3,0.15); tone(180,'sawtooth',0.3,0.15,0.2); },
    win()     { resume(); [0,0.12,0.24,0.36,0.48].forEach((d,i)=>tone(440+i*120,'sine',0.25,0.18,d)); },
    lose()    { resume(); tone(300,'sawtooth',0.5,0.15); tone(250,'sawtooth',0.5,0.15,0.3); },
    tick()    { resume(); tone(1200,'sine',0.05,0.05); },
  };
})();

/* Sound toggle button */
const soundToggleBtn = document.getElementById('sound-toggle');
soundToggleBtn.addEventListener('click', () => {
  const m = SFX.toggle();
  soundToggleBtn.textContent = m ? '🔇' : '🔊';
  showToast(m ? 'Sound off' : 'Sound on');
});

/* ═══════════════════════════════════
   GAME STATE
═══════════════════════════════════ */
let state = {
  // Config
  playerCount: 4,
  playerNames: [],
  undercoverCount: 1,
  hasMrWhite: false,
  hasTimer: false,
  timerDuration: 60,

  // Runtime
  players: [],      // { name, role: 'civilian'|'undercover'|'mrwhite', eliminated: false }
  civWord: '',
  underWord: '',
  round: 1,
  currentRevealIndex: 0,
  voteMap: {},      // playerName -> votedFor (playerName)
  timerInterval: null,
  timerRemaining: 60,
  revealOrder: [],  // shuffled player indices for discussion

  // Scoreboard persists across rounds
  scores: {},       // { playerName: { points: N, wins: N } }
};

/* ═══════════════════════════════════
   SCREEN MANAGEMENT
═══════════════════════════════════ */
const screens = {};
document.querySelectorAll('.screen').forEach(el => {
  screens[el.id] = el;
});

function goTo(screenId) {
  SFX.click();
  const current = document.querySelector('.screen.active');
  if (current) {
    current.classList.add('exit');
    current.classList.remove('active');
    setTimeout(() => current.classList.remove('exit'), 450);
  }
  const next = screens[screenId];
  if (next) {
    next.classList.add('active');
    next.scrollTop = 0;
  }
}

/* ═══════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════ */
let toastTimer;
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ═══════════════════════════════════
   HOME SCREEN
═══════════════════════════════════ */
document.getElementById('btn-start-game').addEventListener('click', () => {
  initSetupScreen();
  goTo('screen-setup');
});
document.getElementById('btn-how-to-play').addEventListener('click', () => goTo('screen-howto'));
document.getElementById('btn-scoreboard-home').addEventListener('click', () => {
  renderScoreboard();
  goTo('screen-scoreboard');
});

/* ═══════════════════════════════════
   HOW TO PLAY
═══════════════════════════════════ */
document.getElementById('btn-back-howto').addEventListener('click', () => goTo('screen-home'));
document.getElementById('btn-howto-play').addEventListener('click', () => {
  initSetupScreen();
  goTo('screen-setup');
});

/* ═══════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════ */

// Player count picker
const playerCountDisplay = document.getElementById('player-count-display');
document.getElementById('player-inc').addEventListener('click', () => {
  if (state.playerCount < 12) {
    state.playerCount++;
    playerCountDisplay.textContent = state.playerCount;
    renderPlayerNameInputs();
    clampUndercover();
  }
});
document.getElementById('player-dec').addEventListener('click', () => {
  if (state.playerCount > 3) {
    state.playerCount--;
    playerCountDisplay.textContent = state.playerCount;
    renderPlayerNameInputs();
    clampUndercover();
  }
});

// Undercover count picker
const underDisplay = document.getElementById('under-count-display');
document.getElementById('under-inc').addEventListener('click', () => {
  const max = Math.floor((state.playerCount - 1) / 2);
  if (state.undercoverCount < max) {
    state.undercoverCount++;
    underDisplay.textContent = state.undercoverCount;
  } else {
    showToast('Too many undercovers! Max is ' + max);
  }
});
document.getElementById('under-dec').addEventListener('click', () => {
  if (state.undercoverCount > 1) {
    state.undercoverCount--;
    underDisplay.textContent = state.undercoverCount;
  }
});

// Mr. White toggle
document.getElementById('toggle-mrwhite').addEventListener('change', e => {
  state.hasMrWhite = e.target.checked;
});

// Timer toggle
document.getElementById('toggle-timer').addEventListener('change', e => {
  state.hasTimer = e.target.checked;
  document.getElementById('timer-duration-section').style.display = state.hasTimer ? '' : 'none';
});

// Timer duration picker
const timerDisplay = document.getElementById('timer-display');
document.getElementById('timer-inc').addEventListener('click', () => {
  if (state.timerDuration < 300) {
    state.timerDuration += 15;
    timerDisplay.textContent = state.timerDuration;
  }
});
document.getElementById('timer-dec').addEventListener('click', () => {
  if (state.timerDuration > 15) {
    state.timerDuration -= 15;
    timerDisplay.textContent = state.timerDuration;
  }
});

function clampUndercover() {
  const max = Math.floor((state.playerCount - 1) / 2);
  if (state.undercoverCount > max) {
    state.undercoverCount = max;
    underDisplay.textContent = state.undercoverCount;
  }
}

function renderPlayerNameInputs() {
  const container = document.getElementById('player-names-container');
  const existing = container.querySelectorAll('input');
  // preserve names already typed
  const existingNames = Array.from(existing).map(i => i.value.trim());
  container.innerHTML = '';
  for (let i = 0; i < state.playerCount; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = `Player ${i + 1}`;
    input.maxLength = 16;
    input.value = existingNames[i] || '';
    input.id = `pname-${i}`;
    container.appendChild(input);
  }
}

// Category buttons removed — single flat word pool used

function initSetupScreen() {
  playerCountDisplay.textContent = state.playerCount;
  underDisplay.textContent = state.undercoverCount;
  timerDisplay.textContent = state.timerDuration;
  renderPlayerNameInputs();
}

// Begin Game button
document.getElementById('btn-begin-game').addEventListener('click', () => {
  // Collect and validate names
  const inputs = document.querySelectorAll('.player-name-input');
  state.playerNames = [];
  let valid = true;
  inputs.forEach((inp, i) => {
    const name = inp.value.trim() || `Player ${i + 1}`;
    // Check duplicates
    if (state.playerNames.includes(name)) {
      inp.style.borderColor = 'var(--danger)';
      valid = false;
    } else {
      inp.style.borderColor = '';
      state.playerNames.push(name);
    }
  });
  if (!valid) {
    showToast('⚠️ Duplicate player names detected!', 3000);
    return;
  }
  // Validate undercover ceiling
  const totalSpecial = state.undercoverCount + (state.hasMrWhite ? 1 : 0);
  if (totalSpecial >= state.playerCount) {
    showToast('⚠️ Too many special roles for this player count!', 3000);
    return;
  }
  startGame();
});

/* ═══════════════════════════════════
   GAME INITIALIZATION
═══════════════════════════════════ */
function startGame() {
  // Pick word pair from the flat pool
  const pair = getRandomPair();
  state.civWord   = pair.civ;
  state.underWord = pair.under;

  // Randomly swap (50% chance) so "undercover word" isn't always word B
  if (Math.random() < 0.5) {
    [state.civWord, state.underWord] = [state.underWord, state.civWord];
  }

  // Assign roles
  const roles = [];
  const civCount = state.playerCount - state.undercoverCount - (state.hasMrWhite ? 1 : 0);
  for (let i = 0; i < civCount; i++) roles.push('civilian');
  for (let i = 0; i < state.undercoverCount; i++) roles.push('undercover');
  if (state.hasMrWhite) roles.push('mrwhite');

  // Shuffle roles (Fisher-Yates returns a new array — must capture it)
  const shuffledRoles = shuffle(roles);

  state.players = state.playerNames.map((name, i) => ({
    name,
    role: shuffledRoles[i],
    eliminated: false,
  }));

  // Init scores for new players
  state.players.forEach(p => {
    if (!state.scores[p.name]) state.scores[p.name] = { points: 0, wins: 0 };
  });

  state.round = 1;
  state.currentRevealIndex = 0;
  state.voteMap = {};

  // Shuffle reveal order
  state.revealOrder = shuffle([...Array(state.players.length).keys()]);

  startRevealPhase();
}

/* ═══════════════════════════════════
   REVEAL PHASE (Pass the Phone)
═══════════════════════════════════ */
function startRevealPhase() {
  state.currentRevealIndex = 0;
  showNextReveal();
  goTo('screen-reveal');
}

function showNextReveal() {
  if (state.currentRevealIndex >= state.players.length) {
    // All revealed → go to discussion
    startDiscussion();
    return;
  }

  const playerIdx = state.revealOrder[state.currentRevealIndex];
  const player = state.players[playerIdx];

  // Reset UI
  document.getElementById('reveal-pass-wrap').style.display = 'flex';
  document.getElementById('reveal-word-wrap').style.display = 'none';
  document.getElementById('pass-player-name').textContent = player.name;
}

document.getElementById('btn-ready-reveal').addEventListener('click', () => {
  SFX.reveal();
  const playerIdx = state.revealOrder[state.currentRevealIndex];
  const player = state.players[playerIdx];

  document.getElementById('reveal-pass-wrap').style.display = 'none';
  const wordWrap = document.getElementById('reveal-word-wrap');
  wordWrap.style.display = 'flex';

  // Set role information
  const roleConfig = {
    civilian:   { label: 'You are a',  badge: '👁️',  name: 'Civilian',   word: state.civWord,  instruction: 'Remember your word. Describe it cleverly!' },
    undercover: { label: 'You are the', badge: '🕵️', name: 'Undercover',  word: state.underWord, instruction: 'Your word is different — blend in with civilians!' },
    mrwhite:    { label: 'You are',     badge: '👻',  name: 'Mr. White',  word: '???',          instruction: 'You have no word. Listen carefully and fake it!' },
  };
  const cfg = roleConfig[player.role];

  document.getElementById('your-role-label').textContent = cfg.label;
  document.getElementById('role-badge-big').textContent  = cfg.badge;
  document.getElementById('role-name-big').textContent   = cfg.name;
  document.getElementById('word-display').textContent    = cfg.word;
  document.getElementById('role-instruction').textContent = cfg.instruction;

  // Color the role name
  const rn = document.getElementById('role-name-big');
  rn.style.color = player.role === 'civilian' ? 'var(--civ)' : player.role === 'undercover' ? 'var(--under)' : 'var(--mrw)';

  // Reset animation
  const inner = document.getElementById('word-card-inner');
  inner.style.animation = 'none';
  requestAnimationFrame(() => { inner.style.animation = ''; });
});

document.getElementById('btn-done-reveal').addEventListener('click', () => {
  state.currentRevealIndex++;
  if (state.currentRevealIndex >= state.players.length) {
    startDiscussion();
  } else {
    // Show pass screen for next player
    document.getElementById('reveal-pass-wrap').style.display = 'flex';
    document.getElementById('reveal-word-wrap').style.display = 'none';
    const nextPlayerIdx = state.revealOrder[state.currentRevealIndex];
    document.getElementById('pass-player-name').textContent = state.players[nextPlayerIdx].name;
  }
});

/* ═══════════════════════════════════
   DISCUSSION PHASE
═══════════════════════════════════ */
/* ─── Picker: weighted random "who goes first" ─── */
function showPickerScreen(onContinue) {
  const alive = state.players.filter(p => !p.eliminated);

  // Build weighted pool — civilians 3×, Undercover/Mr.White 1×
  const pool = [];
  alive.forEach(p => {
    const w = p.role === 'civilian' ? 3 : 1;
    for (let i = 0; i < w; i++) pool.push(p);
  });
  const winner = pool[Math.floor(Math.random() * pool.length)];

  // Reset UI
  const slotEl      = document.getElementById('picker-slot');
  const slotName    = document.getElementById('picker-slot-name');
  const winnerWrap  = document.getElementById('picker-winner-wrap');
  const winnerName  = document.getElementById('picker-winner-name');
  const goBtn       = document.getElementById('btn-picker-go');
  const subtitle    = document.getElementById('picker-subtitle');

  slotEl.style.display     = '';
  slotName.textContent     = '—';
  winnerWrap.style.display = 'none';
  goBtn.style.display      = 'none';
  subtitle.textContent     = 'Picking a lucky player…';

  goTo('screen-picker');

  // Slot machine: starts fast then decelerates to the winner
  // Each number = ms to wait before next tick
  const delays = [70, 70, 75, 80, 85, 95, 110, 135, 170, 220, 290, 390, 510, 660, 840, 1050];
  let step = 0;

  function tick() {
    if (step < delays.length - 1) {
      // Show a random alive player during cycling
      const rnd = alive[Math.floor(Math.random() * alive.length)];
      slotName.textContent = rnd.name;
      // Trigger flash animation
      slotName.classList.remove('slot-flash');
      void slotName.offsetWidth; // force reflow
      slotName.classList.add('slot-flash');
      step++;
      setTimeout(tick, delays[step]);
    } else {
      // Reveal winner
      slotEl.style.display     = 'none';
      winnerName.textContent   = winner.name;
      winnerWrap.style.display = 'flex';
      subtitle.textContent     = '';
      SFX.win();
      // Show continue button after winner animation lands
      setTimeout(() => {
        goBtn.style.display = 'block';
        goBtn.disabled = false;
        // Disable immediately on click to prevent double-firing
        goBtn.onclick = () => { goBtn.disabled = true; onContinue(); };
      }, 700);
    }
  }

  // Start cycling after the screen transition settles
  setTimeout(() => { step = 0; tick(); }, 480);
}

function startDiscussion() {
  showPickerScreen(() => {
    document.getElementById('round-pill').textContent = `Round ${state.round}`;
    renderDiscussionOrder();
    setupTimer();
    goTo('screen-discussion');
  });
}

function renderDiscussionOrder() {
  const list = document.getElementById('player-order-list');
  list.innerHTML = '';
  const alive = state.players.filter(p => !p.eliminated);
  // Shuffle discussion order each round
  const shuffledAlive = shuffle([...alive]);

  shuffledAlive.forEach((player, idx) => {
    const item = document.createElement('div');
    item.className = 'player-order-item';
    item.style.animationDelay = `${idx * 0.06}s`;
    item.innerHTML = `
      <div class="player-order-num">${idx + 1}</div>
      <div class="player-order-name">${player.name}</div>
    `;
    list.appendChild(item);
  });
}

function setupTimer() {
  clearInterval(state.timerInterval);
  const wrap = document.getElementById('timer-ring-wrap');
  if (!state.hasTimer) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  state.timerRemaining = state.timerDuration;
  updateTimerRing(state.timerDuration, state.timerDuration);

  state.timerInterval = setInterval(() => {
    state.timerRemaining--;
    updateTimerRing(state.timerRemaining, state.timerDuration);
    if (state.timerRemaining <= 10) SFX.tick();
    if (state.timerRemaining <= 0) {
      clearInterval(state.timerInterval);
      showToast("⏰ Time's up! Vote now.", 3000);
    }
  }, 1000);
}

function updateTimerRing(remaining, total) {
  const circ = 326.5; // 2 * π * 52
  const offset = circ * (1 - remaining / total);
  const fg = document.getElementById('ring-fg');
  if (fg) {
    fg.style.strokeDashoffset = offset;
    // Change color as time runs out
    if (remaining <= 10) {
      fg.style.stroke = 'var(--danger)';
    } else if (remaining <= 20) {
      fg.style.stroke = 'var(--warn)';
    } else {
      fg.style.stroke = 'url(#timerGrad)';
    }
  }
  const tt = document.getElementById('timer-text');
  if (tt) {
    tt.textContent = remaining;
    tt.style.color = remaining <= 10 ? 'var(--danger)' : remaining <= 20 ? 'var(--warn)' : 'var(--primary)';
  }
}

// Inject SVG gradient for timer
document.querySelector('#screen-discussion .discussion-header').insertAdjacentHTML('beforebegin', `
<svg width="0" height="0" style="position:absolute">
  <defs>
    <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
</svg>
`);

document.getElementById('btn-go-vote').addEventListener('click', () => {
  clearInterval(state.timerInterval);
  startVoting();
});

/* ═══════════════════════════════════
   VOTING PHASE
═══════════════════════════════════ */
function startVoting() {
  state.voteMap = {};
  renderVoteList();
  goTo('screen-voting');
}

function renderVoteList() {
  const list = document.getElementById('vote-list');
  const tally = document.getElementById('vote-tally');
  const elimBtn = document.getElementById('btn-eliminate');
  list.innerHTML = '';
  tally.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">No votes yet</span>';
  elimBtn.disabled = true;

  const alive = state.players.filter(p => !p.eliminated);
  alive.forEach((player, idx) => {
    const item = document.createElement('div');
    item.className = 'vote-item';
    item.style.animationDelay = `${idx * 0.06}s`;
    item.dataset.name = player.name;

    const initial = player.name.charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="vote-avatar">${initial}</div>
      <div class="vote-name">${player.name}</div>
      <div class="vote-count" id="vc-${player.name}">0</div>
    `;
    item.addEventListener('click', () => handleVote(player.name, item));
    list.appendChild(item);
  });
}

// Simple single-round voting: each player clicks once
// Track who voted for whom with a running tally
let currentVoterIndex = 0;
let voteOrder = [];

function handleVote(targetName, itemEl) {
  SFX.vote();
  // Toggle selection: just record last clicked as THE vote target
  document.querySelectorAll('.vote-item').forEach(el => el.classList.remove('voted'));
  itemEl.classList.add('voted');
  state.pendingVote = targetName;

  document.getElementById('btn-eliminate').disabled = false;
}

document.getElementById('btn-eliminate').addEventListener('click', () => {
  if (!state.pendingVote) {
    showToast('Please select a player to eliminate!');
    return;
  }
  eliminatePlayer(state.pendingVote);
});

/* ═══════════════════════════════════
   ELIMINATION PHASE
═══════════════════════════════════ */
function eliminatePlayer(name) {
  const player = state.players.find(p => p.name === name);
  if (!player) return;
  player.eliminated = true;
  SFX.elim();

  document.getElementById('elim-player-name').textContent = player.name;

  const roleConfig = {
    civilian:   { badge: '👁️',  name: 'Civilian',   color: 'var(--civ)',   cls: 'civilian' },
    undercover: { badge: '🕵️',  name: 'Undercover', color: 'var(--under)', cls: 'undercover' },
    mrwhite:    { badge: '👻',  name: 'Mr. White',  color: 'var(--mrw)',   cls: 'mrwhite' },
  };
  const cfg = roleConfig[player.role];
  const badgeEl = document.getElementById('elim-role-badge');
  const nameEl  = document.getElementById('elim-role-name');

  // Animate reveal
  badgeEl.textContent = '?';
  nameEl.textContent  = '???';
  nameEl.className    = 'elim-role-name';
  document.getElementById('elim-outcome').textContent = '';
  document.getElementById('btn-after-elim').style.display = 'none';
  document.getElementById('mrwhite-guess-wrap').style.display = 'none';

  goTo('screen-elimination');

  setTimeout(() => {
    badgeEl.textContent = cfg.badge;
    nameEl.textContent  = cfg.name;
    nameEl.classList.add(cfg.cls);

    if (player.role === 'mrwhite') {
      // Permanently disable Mr. White for any future rounds/games this session
      state.hasMrWhite = false;
      const mrwToggle = document.getElementById('toggle-mrwhite');
      if (mrwToggle) mrwToggle.checked = false;
      // Mr. White gets a chance to guess
      document.getElementById('mrwhite-guess-wrap').style.display = 'flex';
      document.getElementById('mrwhite-guess-input').value = '';
    } else {
      checkWinCondition(player);
    }
  }, 1400);
}

// Mr. White guess handler
document.getElementById('btn-mrwhite-guess').addEventListener('click', () => {
  const guess = document.getElementById('mrwhite-guess-input').value.trim().toLowerCase();
  const civWord = state.civWord.toLowerCase();

  document.getElementById('mrwhite-guess-wrap').style.display = 'none';

  const aliveUnder = state.players.filter(p => !p.eliminated && p.role === 'undercover');
  const eliminatedMrW = state.players.find(p => p.role === 'mrwhite' && p.eliminated);

  if (guess === civWord || guess === state.underWord.toLowerCase()) {
    if (aliveUnder.length === 0) {
      // ✅ Mr. White wins — last special player and correct guess!
      SFX.win();
      document.getElementById('elim-outcome').textContent = `✅ "${guess.toUpperCase()}" — That's correct! Mr. White wins! 🎉`;
      const mrw = state.players.find(p => p.role === 'mrwhite');
      if (mrw && state.scores[mrw.name]) {
        state.scores[mrw.name].points += 3;
        state.scores[mrw.name].wins   += 1;
      }
      setTimeout(() => showWinScreen('mrwhite'), 1800);
    } else {
      // Correct guess but Undercovers are still alive — game continues
      SFX.lose();
      document.getElementById('elim-outcome').textContent =
        `✅ Correct word! But Undercovers are still in the game...`;
      setTimeout(() => checkWinCondition(eliminatedMrW), 2000);
    }
  } else {
    SFX.lose();
    document.getElementById('elim-outcome').textContent = `❌ "${guess.toUpperCase()}" — Wrong! The word was "${state.civWord}".`;
    setTimeout(() => checkWinCondition(eliminatedMrW), 2000);
  }
  // NOTE: btn-after-elim is intentionally NOT shown here.
  // checkWinCondition() will reveal it with the correct onclick after evaluating game state.
  // Showing it immediately would expose a stale onclick from a previous checkWinCondition call.
});

function checkWinCondition(eliminatedPlayer) {
  const aliveUnder = state.players.filter(p => !p.eliminated && p.role === 'undercover');
  const aliveCiv   = state.players.filter(p => !p.eliminated && p.role === 'civilian');
  const aliveMrW   = state.players.filter(p => !p.eliminated && p.role === 'mrwhite');

  let outcome = '';

  if (aliveUnder.length === 0 && aliveMrW.length === 0) {
    // All Undercovers AND Mr. White eliminated → Civilians win
    outcome = 'civilians';
  } else if (aliveUnder.length > 0 && aliveUnder.length >= aliveCiv.length) {
    // Undercovers equal or outnumber Civilians → Undercover wins (Mr. White NOT counted)
    outcome = 'undercover';
  } else if (aliveCiv.length === 0) {
    // Edge case: all civilians somehow eliminated while a special survives
    // Award win to whoever is still alive
    outcome = aliveUnder.length > 0 ? 'undercover' : 'mrwhite';
  } else {
    // Game continues — civilians keep voting
    outcome = 'continue';
  }

  const outcomeEl = document.getElementById('elim-outcome');
  const btn       = document.getElementById('btn-after-elim');

  // Always re-enable — it may have been disabled from a previous "Next Round" click
  btn.disabled = false;

  if (outcome === 'continue') {
    outcomeEl.textContent = `${eliminatedPlayer.name} was a ${getRoleLabel(eliminatedPlayer.role)}. Game continues!`;
    btn.textContent = 'Next Round →';
    btn.style.display = 'block';
    // Skip reveal phase — players already know their roles from round 1
    btn.onclick = () => { btn.disabled = true; state.round++; startDiscussion(); };
  } else {
    // Award scores
    awardScores(outcome);
    btn.textContent = 'See Results →';
    btn.style.display = 'block';
    btn.onclick = () => showWinScreen(outcome);

    if (outcome === 'civilians') {
      outcomeEl.textContent = `${eliminatedPlayer.name} was the ${getRoleLabel(eliminatedPlayer.role)} — Civilians win! 👁️`;
      SFX.win();
    } else {
      outcomeEl.textContent = `${eliminatedPlayer.name} is gone — but the ${getRoleLabel(outcome)} wins! 🕵️`;
      SFX.lose();
    }
  }
}

function getRoleLabel(role) {
  return { civilian: 'Civilian', undercover: 'Undercover', mrwhite: 'Mr. White' }[role] || role;
}

function awardScores(outcome) {
  state.players.forEach(p => {
    if (!state.scores[p.name]) state.scores[p.name] = { points: 0, wins: 0 };
    let pts = 0;
    if (outcome === 'civilians' && p.role === 'civilian' && !p.eliminated) pts = 2;
    if (outcome === 'undercover' && p.role === 'undercover' && !p.eliminated) pts = 3;
    if (outcome === 'mrwhite' && p.role === 'mrwhite') { /* handled in guess */ }
    if (pts > 0) {
      state.scores[p.name].points += pts;
      state.scores[p.name].wins   += 1;
    }
  });
}

/* ═══════════════════════════════════
   WIN SCREEN
═══════════════════════════════════ */
function showWinScreen(outcome) {
  const configs = {
    civilians:  { badge: '👁️', title: 'Civilians Win!',   sub: 'The Undercover has been caught.' },
    undercover: { badge: '🕵️', title: 'Undercover Wins!', sub: 'The civilians were outsmarted.' },
    mrwhite:    { badge: '👻', title: 'Mr. White Wins!',  sub: 'An impossible guess, perfectly executed.' },
  };
  const cfg = configs[outcome] || configs.civilians;

  document.getElementById('win-badge').textContent = cfg.badge;
  document.getElementById('win-title').textContent = cfg.title;
  document.getElementById('win-sub').textContent   = cfg.sub;

  document.getElementById('revealed-civ-word').textContent   = state.civWord;
  document.getElementById('revealed-under-word').textContent = state.underWord;

  // Roles summary
  const summary = document.getElementById('roles-summary');
  summary.innerHTML = '';
  state.players.forEach(p => {
    const chip = document.createElement('div');
    chip.className = `role-chip ${p.role}`;
    const roleEmoji = { civilian: '👁️', undercover: '🕵️', mrwhite: '👻' }[p.role];
    chip.innerHTML = `${roleEmoji} <span>${p.name}</span>`;
    summary.appendChild(chip);
  });

  spawnConfetti();
  goTo('screen-win');
}

// Confetti system
function spawnConfetti() {
  const container = document.getElementById('win-confetti');
  container.innerHTML = '';
  const colors = ['#a78bfa','#ec4899','#f59e0b','#38bdf8','#10b981','#f472b6'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = Math.random() * 10 + 6;
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation-delay: ${Math.random() * 2}s;
      animation-duration: ${Math.random() * 2 + 2}s;
    `;
    container.appendChild(piece);
  }
}

// Win screen actions
document.getElementById('btn-new-round').addEventListener('click', () => {
  // Reset players - keep same players, new roles & words
  state.playerNames = state.players.map(p => p.name);
  state.round = 1;
  state.players.forEach(p => p.eliminated = false);
  startGame();
});

document.getElementById('btn-view-score').addEventListener('click', () => {
  renderScoreboard();
  goTo('screen-scoreboard');
});

document.getElementById('btn-back-home').addEventListener('click', () => {
  // Full reset except scoreboard
  state.players = [];
  state.round = 1;
  goTo('screen-home');
});

/* ═══════════════════════════════════
   SCOREBOARD
═══════════════════════════════════ */
function renderScoreboard() {
  const content = document.getElementById('scoreboard-content');
  content.innerHTML = '';

  const entries = Object.entries(state.scores)
    .sort(([,a],[,b]) => b.points - a.points || b.wins - a.wins);

  if (entries.length === 0) {
    content.innerHTML = '<div class="score-empty">🎮 No games played yet.<br>Start a game to build the scoreboard!</div>';
    return;
  }

  entries.forEach(([name, data], idx) => {
    const rankClasses = ['gold', 'silver', 'bronze'];
    const rankSymbols = ['🥇', '🥈', '🥉'];
    const row = document.createElement('div');
    row.className = 'score-row';
    row.style.animationDelay = `${idx * 0.05}s`;
    row.innerHTML = `
      <div class="score-rank ${rankClasses[idx] || ''}">${idx < 3 ? rankSymbols[idx] : `#${idx+1}`}</div>
      <div>
        <div class="score-name">${name}</div>
        <div class="score-wins">${data.wins} win${data.wins !== 1 ? 's' : ''}</div>
      </div>
      <div class="score-pts">${data.points} pts</div>
    `;
    content.appendChild(row);
  });
}

document.getElementById('btn-back-score').addEventListener('click', () => {
  const prev = document.querySelector('.screen.exit');
  goTo(state.players.length > 0 ? 'screen-win' : 'screen-home');
});

document.getElementById('btn-clear-score').addEventListener('click', () => {
  if (confirm('Clear all scores? This cannot be undone.')) {
    state.scores = {};
    renderScoreboard();
    showToast('Scoreboard cleared!');
  }
});

/* ═══════════════════════════════════
   SETUP SCREEN BACK
═══════════════════════════════════ */
document.getElementById('btn-back-setup').addEventListener('click', () => goTo('screen-home'));

/* ═══════════════════════════════════
   UTILITY
═══════════════════════════════════ */
/** Fisher-Yates shuffle — returns a new shuffled array */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ═══════════════════════════════════
   INIT
═══════════════════════════════════ */
// Ensure home screen is active on load
window.addEventListener('DOMContentLoaded', () => {
  goTo('screen-home');
});
