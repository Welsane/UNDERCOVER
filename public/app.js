const socket = io();

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  socket,
  roomCode: '',
  isHost: false,
  myName: '',
  myRole: '',
  myWord: '',
  round: 1,
  players: [],
  descriptions: [],
  selectedVote: null,
  voiceData: null,
  mediaRecorder: null,
  audioChunks: [],
  recordingTimer: null,
  recordingSeconds: 0,
};

// ─── Sound ───────────────────────────────────────────────────────────────────
let soundOn = true;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, dur) {
  if (!soundOn) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}

document.getElementById('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  const btn = document.getElementById('sound-toggle');
  btn.textContent = soundOn ? '🔊' : '🔇';
  btn.classList.toggle('muted', !soundOn);
});

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ─── Screen Manager ──────────────────────────────────────────────────────────
let currentScreen = null;

function showScreen(id) {
  const next = document.getElementById(id);
  if (!next) return;
  if (currentScreen && currentScreen !== next) {
    const prev = currentScreen;
    prev.classList.add('exit');
    prev.classList.remove('active');
    setTimeout(() => {
      prev.classList.remove('exit');
    }, 400);
  }
  next.classList.add('active');
  currentScreen = next;
}

// ─── Home Screen ─────────────────────────────────────────────────────────────
document.getElementById('btn-create-room').addEventListener('click', () => {
  showScreen('screen-create');
  playTone(440, 0.1);
});
document.getElementById('btn-join-room-home').addEventListener('click', () => {
  showScreen('screen-join');
  playTone(440, 0.1);
});
document.getElementById('btn-how-to-play').addEventListener('click', () => {
  showScreen('screen-howto');
  playTone(440, 0.1);
});
document.getElementById('btn-back-howto').addEventListener('click', () => {
  showScreen('screen-home');
});
document.getElementById('btn-howto-play').addEventListener('click', () => {
  showScreen('screen-home');
});

// ─── Create Room ─────────────────────────────────────────────────────────────
let createUndercoverCount = 1;

document.getElementById('btn-back-create').addEventListener('click', () => {
  showScreen('screen-home');
});

document.getElementById('create-under-dec').addEventListener('click', () => {
  if (createUndercoverCount > 1) {
    createUndercoverCount--;
    document.getElementById('create-under-display').textContent = createUndercoverCount;
    playTone(330, 0.08);
  }
});

document.getElementById('create-under-inc').addEventListener('click', () => {
  createUndercoverCount++;
  document.getElementById('create-under-display').textContent = createUndercoverCount;
  playTone(440, 0.08);
});

document.getElementById('btn-create-go').addEventListener('click', () => {
  const nameInput = document.getElementById('create-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    showToast('Please enter your name', 'error');
    playTone(200, 0.2);
    return;
  }
  state.myName = name;
  const hasMrWhite = document.getElementById('create-mrwhite').checked;
  socket.emit('create-room', {
    name,
    undercoverCount: createUndercoverCount,
    hasMrWhite,
  });
  playTone(550, 0.15);
});

// ─── Join Room ───────────────────────────────────────────────────────────────
document.getElementById('btn-back-join').addEventListener('click', () => {
  showScreen('screen-home');
});

document.getElementById('join-code').addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

document.getElementById('btn-join-go').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const nameInput = document.getElementById('join-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (code.length !== 4) {
    showToast('Room code must be 4 characters', 'error');
    return;
  }
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  state.myName = name;
  socket.emit('join-room', { code, name });
  playTone(550, 0.15);
});

// ─── Lobby ───────────────────────────────────────────────────────────────────
let lobbyUndercoverCount = 1;

function renderPlayers(players) {
  state.players = players;
  const list = document.getElementById('lobby-players-list');
  const countEl = document.getElementById('lobby-player-count');
  if (!list) return;
  list.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'lobby-player-item';
    const isHostPlayer = i === 0; // server always puts host first
    div.innerHTML = `<span class="player-avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</span><span class="player-name">${escapeHtml(p.name)}</span>${isHostPlayer ? '<span class="host-crown">👑</span>' : ''}`;
    list.appendChild(div);
  });
  if (countEl) countEl.textContent = `${players.length} / 12`;
}

document.getElementById('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    showToast('Code copied!', 'info');
    playTone(660, 0.1);
  }).catch(() => {
    showToast(state.roomCode, 'info');
  });
});

document.getElementById('lobby-under-dec').addEventListener('click', () => {
  if (lobbyUndercoverCount > 1) {
    lobbyUndercoverCount--;
    document.getElementById('lobby-under-display').textContent = lobbyUndercoverCount;
    emitUpdateSettings();
    playTone(330, 0.08);
  }
});

document.getElementById('lobby-under-inc').addEventListener('click', () => {
  lobbyUndercoverCount++;
  document.getElementById('lobby-under-display').textContent = lobbyUndercoverCount;
  emitUpdateSettings();
  playTone(440, 0.08);
});

document.getElementById('lobby-mrwhite').addEventListener('change', () => {
  emitUpdateSettings();
});

function emitUpdateSettings() {
  socket.emit('update-settings', {
    code: state.roomCode,
    undercoverCount: lobbyUndercoverCount,
    hasMrWhite: document.getElementById('lobby-mrwhite').checked,
  });
}

document.getElementById('btn-start-game').addEventListener('click', () => {
  if (state.players.length < 3) {
    showToast('Need at least 3 players to start', 'error');
    return;
  }
  const wordPair = getRandomPair();
  socket.emit('start-game', { code: state.roomCode, wordPair });
  playTone(660, 0.2);
});

// ─── Socket: Room Created ────────────────────────────────────────────────────
socket.on('room-created', ({ code, isHost, players }) => {
  state.roomCode = code;
  state.isHost = true;
  renderPlayers(players);
  document.getElementById('lobby-code').textContent = code;
  document.getElementById('btn-start-game').style.display = 'block';
  const settings = document.getElementById('lobby-settings');
  if (settings) settings.style.display = 'block';
  const waitMsg = document.getElementById('lobby-waiting-msg');
  if (waitMsg) waitMsg.style.display = 'none';
  showScreen('screen-lobby');
  playTone(550, 0.2);
});

// ─── Socket: Room Joined ─────────────────────────────────────────────────────
socket.on('room-joined', ({ code, isHost, players }) => {
  state.roomCode = code;
  state.isHost = false;
  renderPlayers(players);
  document.getElementById('lobby-code').textContent = code;
  document.getElementById('btn-start-game').style.display = 'none';
  const settings = document.getElementById('lobby-settings');
  if (settings) settings.style.display = 'none';
  const waitMsg = document.getElementById('lobby-waiting-msg');
  if (waitMsg) waitMsg.style.display = 'block';
  showScreen('screen-lobby');
  playTone(550, 0.2);
});

// ─── Socket: Player Joined ───────────────────────────────────────────────────
socket.on('player-joined', ({ name, players }) => {
  renderPlayers(players);
  showToast(`${name} joined!`, 'info');
  playTone(480, 0.1);
});

// ─── Socket: Settings Updated ────────────────────────────────────────────────
socket.on('settings-updated', ({ undercoverCount, hasMrWhite }) => {
  lobbyUndercoverCount = undercoverCount;
  document.getElementById('lobby-under-display').textContent = undercoverCount;
  const mrWhiteToggle = document.getElementById('lobby-mrwhite');
  if (mrWhiteToggle) mrWhiteToggle.checked = hasMrWhite;
});

// ─── Socket: Game Started ────────────────────────────────────────────────────
socket.on('game-started', ({ role, word, totalPlayers, round }) => {
  state.myRole = role;
  state.myWord = word;
  state.round = round;

  document.getElementById('reveal-round-pill').textContent = `Round ${round}`;

  const roleBadge = document.getElementById('role-badge-big');
  const roleNameEl = document.getElementById('role-name-big');
  const wordDisplay = document.getElementById('word-display');
  const roleInstruction = document.getElementById('role-instruction');

  roleBadge.className = 'role-badge-big';
  roleNameEl.className = 'role-name-big';

  if (role === 'civilian') {
    roleBadge.textContent = '👁️';
    roleNameEl.textContent = 'Civilian';
    roleNameEl.classList.add('role-civilian');
    wordDisplay.textContent = word;
    if (roleInstruction) roleInstruction.textContent = 'Remember your word. Describe it without saying it directly!';
  } else if (role === 'undercover') {
    roleBadge.textContent = '🕵️';
    roleNameEl.textContent = 'Undercover';
    roleNameEl.classList.add('role-undercover');
    wordDisplay.textContent = word;
    if (roleInstruction) roleInstruction.textContent = "You have a different word. Blend in — don't get caught!";
  } else if (role === 'mrwhite') {
    roleBadge.textContent = '👻';
    roleNameEl.textContent = 'Mr. White';
    roleNameEl.classList.add('role-mrwhite');
    wordDisplay.textContent = '???';
    if (roleInstruction) roleInstruction.textContent = "You don't know the word. Listen carefully and fake it!";
  }

  const readyBtn = document.getElementById('btn-i-am-ready');
  if (readyBtn) {
    readyBtn.disabled = false;
    readyBtn.textContent = "I'm Ready!";
  }

  showScreen('screen-reveal');
  playTone(660, 0.3);
});

// ─── Ready Flow ───────────────────────────────────────────────────────────────
document.getElementById('btn-i-am-ready').addEventListener('click', function () {
  this.disabled = true;
  this.textContent = 'Waiting…';
  socket.emit('player-ready', { code: state.roomCode });
  playTone(550, 0.1);
});

socket.on('ready-progress', ({ ready, total }) => {
  const text = document.getElementById('ready-progress-text');
  if (text) text.textContent = `${ready} / ${total} ready`;
  // Inject/update the progress bar inside #ready-progress-wrap
  let wrap = document.getElementById('ready-progress-wrap');
  if (wrap) {
    let barWrap = wrap.querySelector('.ready-bar-track');
    if (!barWrap) {
      barWrap = document.createElement('div');
      barWrap.className = 'ready-bar-track';
      barWrap.innerHTML = '<div class="ready-bar-fill" id="ready-progress-bar"></div>';
      wrap.prepend(barWrap);
    }
    const fill = document.getElementById('ready-progress-bar');
    if (fill) fill.style.width = `${(ready / total) * 100}%`;
  }
});

// ─── Phase Changed ───────────────────────────────────────────────────────────
socket.on('phase-changed', ({ phase, descriptions, players, round }) => {
  if (phase === 'description') {
    state.round = round || state.round;
    const descPill = document.getElementById('desc-round-pill');
    if (descPill) descPill.textContent = `Round ${state.round}`;
    // Show the player's own word as a reminder
    const reminderWord = document.getElementById('desc-reminder-word');
    if (reminderWord) reminderWord.textContent = state.myWord || '???';
    resetDescriptionForm();
    showScreen('screen-description');
    playTone(500, 0.15);
  } else if (phase === 'discussion') {
    state.descriptions = descriptions || [];
    renderDiscussion(state.descriptions);
    // Hint shown to non-hosts only
    const hostHint = document.getElementById('vote-host-hint');
    if (hostHint) hostHint.style.display = !state.isHost ? 'block' : 'none';
    // Host btn visible to all, but only host emits
    const goVoteBtn = document.getElementById('btn-go-vote');
    if (goVoteBtn) goVoteBtn.style.display = state.isHost ? 'flex' : 'none';
    showScreen('screen-discussion');
    playTone(520, 0.15);
  } else if (phase === 'voting') {
    renderVoteList(players || state.players);
    state.selectedVote = null;
    const casteBtn = document.getElementById('btn-cast-vote');
    if (casteBtn) casteBtn.disabled = true;
    const votedOverlay = document.getElementById('voted-overlay');
    if (votedOverlay) votedOverlay.style.display = 'none';
    showScreen('screen-voting');
    playTone(480, 0.15);
  } else if (phase === 'lobby') {
    state.descriptions = [];
    document.getElementById('lobby-code').textContent = state.roomCode;
    if (state.isHost) {
      document.getElementById('btn-start-game').style.display = 'block';
      const settings = document.getElementById('lobby-settings');
      if (settings) settings.style.display = 'block';
      const waitMsg = document.getElementById('lobby-waiting-msg');
      if (waitMsg) waitMsg.style.display = 'none';
    } else {
      document.getElementById('btn-start-game').style.display = 'none';
      const settings = document.getElementById('lobby-settings');
      if (settings) settings.style.display = 'none';
      const waitMsg = document.getElementById('lobby-waiting-msg');
      if (waitMsg) waitMsg.style.display = 'block';
    }
    if (players) renderPlayers(players);
    showScreen('screen-lobby');
  }
});

// ─── Description Phase ───────────────────────────────────────────────────────
function resetDescriptionForm() {
  const textInput = document.getElementById('desc-text-input');
  if (textInput) textInput.value = '';
  const charCount = document.getElementById('char-count');
  if (charCount) charCount.textContent = '0';
  const submittedOverlay = document.getElementById('submitted-overlay');
  if (submittedOverlay) submittedOverlay.style.display = 'none';
  const submitBtn = document.getElementById('btn-submit-desc');
  if (submitBtn) submitBtn.disabled = false;
  const submittedList = document.getElementById('submitted-players-list');
  if (submittedList) submittedList.innerHTML = '';
  const descProgress = document.getElementById('desc-progress-text');
  if (descProgress) descProgress.textContent = '0 / ?';
  const descFill = document.getElementById('desc-progress-fill');
  if (descFill) descFill.style.width = '0%';
  state.voiceData = null;
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.mediaRecorder = null;
  state.audioChunks = [];
  clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.recordingSeconds = 0;
  const vnBtn = document.getElementById('btn-vn-record');
  if (vnBtn) vnBtn.classList.remove('recording');
  const vnTimer = document.getElementById('vn-timer');
  if (vnTimer) vnTimer.textContent = '0:00';
  const vnPreview = document.getElementById('vn-preview');
  if (vnPreview) vnPreview.style.display = 'none';
  const vnBars = document.querySelectorAll('.vn-bar');
  vnBars.forEach(b => b.classList.remove('active'));
  switchTab('text');
}

// Tab switching
document.getElementById('tab-text').addEventListener('click', () => switchTab('text'));
document.getElementById('tab-voice').addEventListener('click', () => switchTab('voice'));

function switchTab(tab) {
  const textTab = document.getElementById('tab-text');
  const voiceTab = document.getElementById('tab-voice');
  const textPanel = document.getElementById('panel-text');
  const voicePanel = document.getElementById('panel-voice');
  if (tab === 'text') {
    textTab.classList.add('active');
    voiceTab.classList.remove('active');
    if (textPanel) textPanel.classList.remove('hidden');
    if (voicePanel) voicePanel.classList.add('hidden');
  } else {
    voiceTab.classList.add('active');
    textTab.classList.remove('active');
    if (voicePanel) voicePanel.classList.remove('hidden');
    if (textPanel) textPanel.classList.add('hidden');
  }
}

document.getElementById('desc-text-input').addEventListener('input', function () {
  const charCount = document.getElementById('char-count');
  if (charCount) charCount.textContent = this.value.length;
});

// Voice Recording
document.getElementById('btn-vn-record').addEventListener('click', async function () {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];
      state.mediaRecorder = new MediaRecorder(stream);
      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) state.audioChunks.push(e.data);
      };
      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          state.voiceData = reader.result;
          const vnPlayback = document.getElementById('vn-playback');
          if (vnPlayback) vnPlayback.src = reader.result;
          const vnPreview = document.getElementById('vn-preview');
          if (vnPreview) vnPreview.style.display = 'flex';
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      state.mediaRecorder.start();
      this.classList.add('recording');
      const vnBars = document.querySelectorAll('.vn-bar');
      vnBars.forEach(b => b.classList.add('active'));
      state.recordingSeconds = 0;
      const vnTimer = document.getElementById('vn-timer');
      state.recordingTimer = setInterval(() => {
        state.recordingSeconds++;
        const m = Math.floor(state.recordingSeconds / 60);
        const s = state.recordingSeconds % 60;
        if (vnTimer) vnTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      }, 1000);
      playTone(440, 0.1);
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }
  } else if (state.mediaRecorder.state === 'recording') {
    // Stop recording
    state.mediaRecorder.stop();
    this.classList.remove('recording');
    const vnBars = document.querySelectorAll('.vn-bar');
    vnBars.forEach(b => b.classList.remove('active'));
    clearInterval(state.recordingTimer);
    state.recordingTimer = null;
    playTone(330, 0.1);
  }
});

document.getElementById('btn-vn-redo').addEventListener('click', () => {
  state.voiceData = null;
  state.audioChunks = [];
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.mediaRecorder = null;
  clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.recordingSeconds = 0;
  const vnPreview = document.getElementById('vn-preview');
  if (vnPreview) vnPreview.style.display = 'none';
  const vnTimer = document.getElementById('vn-timer');
  if (vnTimer) vnTimer.textContent = '0:00';
  const vnBtn = document.getElementById('btn-vn-record');
  if (vnBtn) vnBtn.classList.remove('recording');
  const vnBars = document.querySelectorAll('.vn-bar');
  vnBars.forEach(b => b.classList.remove('active'));
  playTone(300, 0.1);
});

document.getElementById('btn-submit-desc').addEventListener('click', function () {
  const textPanel = document.getElementById('panel-text');
  const isVoiceTab = document.getElementById('tab-voice').classList.contains('active');

  if (isVoiceTab) {
    if (!state.voiceData) {
      showToast('Please record a voice note first', 'error');
      return;
    }
    socket.emit('submit-description', {
      code: state.roomCode,
      type: 'voice',
      content: state.voiceData,
    });
  } else {
    const text = document.getElementById('desc-text-input').value.trim();
    if (!text) {
      showToast('Please write something first', 'error');
      return;
    }
    socket.emit('submit-description', {
      code: state.roomCode,
      type: 'text',
      content: text,
    });
  }

  const submittedOverlay = document.getElementById('submitted-overlay');
  if (submittedOverlay) submittedOverlay.style.display = 'flex';
  this.disabled = true;
  playTone(600, 0.15);
});

socket.on('description-progress', ({ submitted, total, playerName }) => {
  const text = document.getElementById('desc-progress-text');
  const fill = document.getElementById('desc-progress-fill');
  const list = document.getElementById('submitted-players-list');
  if (text) text.textContent = `${submitted} / ${total}`;
  if (fill) fill.style.width = `${(submitted / total) * 100}%`;
  if (list && playerName) {
    const chip = document.createElement('span');
    chip.className = 'submitted-chip';
    chip.textContent = playerName;
    list.appendChild(chip);
  }
});

// ─── Discussion Phase ─────────────────────────────────────────────────────────
function renderDiscussion(descriptions) {
  const list = document.getElementById('disc-list'); // matches index.html id
  if (!list) return;
  list.innerHTML = '';
  descriptions.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'disc-item';
    if (item.type === 'text') {
      div.innerHTML = `
        <div class="disc-header">
          <span class="disc-avatar">${escapeHtml(item.name.charAt(0).toUpperCase())}</span>
          <span class="disc-name">${escapeHtml(item.name)}</span>
        </div>
        <div class="disc-text-card">${escapeHtml(item.content)}</div>
      `;
    } else if (item.type === 'voice') {
      const audioObj = new Audio(item.content);
      let playing = false;
      const playBtn = document.createElement('button');
      playBtn.className = 'btn-voice-play';
      playBtn.textContent = '▶ Play Voice Note';
      audioObj.onended = () => {
        playing = false;
        playBtn.textContent = '▶ Play Voice Note';
        playBtn.classList.remove('playing');
      };
      playBtn.addEventListener('click', () => {
        if (playing) {
          audioObj.pause();
          audioObj.currentTime = 0;
          playing = false;
          playBtn.textContent = '▶ Play Voice Note';
          playBtn.classList.remove('playing');
        } else {
          audioObj.play();
          playing = true;
          playBtn.textContent = '⏹ Stop';
          playBtn.classList.add('playing');
        }
      });
      div.innerHTML = `
        <div class="disc-header">
          <span class="disc-avatar">${escapeHtml(item.name.charAt(0).toUpperCase())}</span>
          <span class="disc-name">${escapeHtml(item.name)}</span>
        </div>
      `;
      div.appendChild(playBtn);
    }
    list.appendChild(div);
  });
}

document.getElementById('btn-go-vote').addEventListener('click', () => {
  if (state.isHost) {
    socket.emit('start-voting', { code: state.roomCode });
    playTone(550, 0.15);
  } else {
    showToast('Only the host can advance', 'info');
  }
});

// ─── Voting Phase ─────────────────────────────────────────────────────────────
function renderVoteList(players) {
  const list = document.getElementById('vote-list'); // matches index.html id
  if (!list) return;
  list.innerHTML = '';
  players.forEach((p) => {
    if (!p.alive && p.alive !== undefined) return;
    const div = document.createElement('div');
    div.className = 'vote-item';
    div.dataset.name = p.name;
    div.innerHTML = `
      <span class="vote-avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
      <span class="vote-name">${escapeHtml(p.name)}</span>
    `;
    div.addEventListener('click', () => {
      document.querySelectorAll('.vote-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      state.selectedVote = p.name;
      const castBtn = document.getElementById('btn-cast-vote');
      if (castBtn) castBtn.disabled = false;
      playTone(440, 0.08);
    });
    list.appendChild(div);
  });
}

document.getElementById('btn-cast-vote').addEventListener('click', function () {
  if (!state.selectedVote) return;
  socket.emit('cast-vote', { code: state.roomCode, target: state.selectedVote });
  const votedOverlay = document.getElementById('voted-overlay');
  if (votedOverlay) votedOverlay.style.display = 'flex';
  this.disabled = true;
  playTone(600, 0.15);
});

socket.on('vote-progress', ({ voted, total }) => {
  const text = document.getElementById('vote-progress-text');
  if (text) text.textContent = `${voted} / ${total} voted`;
});

// ─── Elimination ──────────────────────────────────────────────────────────────
socket.on('player-eliminated', ({ name, role, mrWhiteGuessing }) => {
  document.getElementById('elim-player-name').textContent = name;
  const badge = document.getElementById('elim-role-badge');
  const roleName = document.getElementById('elim-role-name');
  badge.className = 'elim-role-badge';
  roleName.className = 'elim-role-name';

  if (role === 'civilian') {
    badge.textContent = '👁️';
    roleName.textContent = 'Civilian';
    roleName.classList.add('role-civilian');
  } else if (role === 'undercover') {
    badge.textContent = '🕵️';
    roleName.textContent = 'Undercover';
    roleName.classList.add('role-undercover');
  } else if (role === 'mrwhite') {
    badge.textContent = '👻';
    roleName.textContent = 'Mr. White';
    roleName.classList.add('role-mrwhite');
  }

  const guessWrap = document.getElementById('mrwhite-guess-wrap');
  const waitMsg = document.getElementById('mrwhite-waiting');
  const outcomeEl = document.getElementById('elim-outcome');
  if (outcomeEl) outcomeEl.textContent = '';

  if (mrWhiteGuessing) {
    if (state.myRole === 'mrwhite') {
      if (guessWrap) guessWrap.style.display = 'block';
      if (waitMsg) waitMsg.style.display = 'none';
      const guessInput = document.getElementById('mrwhite-guess-input');
      if (guessInput) guessInput.value = '';
      const guessBtn = document.getElementById('btn-mrwhite-guess');
      if (guessBtn) guessBtn.disabled = false;
    } else {
      if (guessWrap) guessWrap.style.display = 'none';
      if (waitMsg) waitMsg.style.display = 'block';
    }
  } else {
    if (guessWrap) guessWrap.style.display = 'none';
    if (waitMsg) waitMsg.style.display = 'none';
  }

  showScreen('screen-elimination');
  playTone(200, 0.4);
});

document.getElementById('btn-mrwhite-guess').addEventListener('click', function () {
  const guess = document.getElementById('mrwhite-guess-input').value.trim();
  if (!guess) {
    showToast('Enter a guess!', 'error');
    return;
  }
  socket.emit('mrwhite-guess', { code: state.roomCode, guess });
  this.disabled = true;
  playTone(440, 0.2);
});

socket.on('mrwhite-result', ({ correct, guess, civWord }) => {
  const outcomeEl = document.getElementById('elim-outcome');
  const guessWrap = document.getElementById('mrwhite-guess-wrap');
  const waitMsg = document.getElementById('mrwhite-waiting');
  if (guessWrap) guessWrap.style.display = 'none';
  if (waitMsg) waitMsg.style.display = 'none';
  if (outcomeEl) {
    if (correct) {
      outcomeEl.textContent = '✅ Correct! Mr. White wins!';
      outcomeEl.className = 'elim-outcome win';
    } else {
      outcomeEl.textContent = `❌ Wrong! The word was "${civWord}"`;
      outcomeEl.className = 'elim-outcome lose';
    }
  }
  playTone(correct ? 880 : 200, 0.3);
});

// ─── Game Over ────────────────────────────────────────────────────────────────
socket.on('game-over', ({ outcome, civWord, underWord, players, scores }) => {
  setTimeout(() => {
    const badge = document.getElementById('win-badge');
    const title = document.getElementById('win-title');
    const sub = document.getElementById('win-sub');

    if (outcome === 'civilians') {
      if (badge) badge.textContent = '🎉';
      if (title) title.textContent = 'Civilians Win!';
      if (sub) sub.textContent = 'The undercover agent was caught!';
    } else if (outcome === 'undercover') {
      if (badge) badge.textContent = '🕵️';
      if (title) title.textContent = 'Undercover Wins!';
      if (sub) sub.textContent = 'The spy blended in perfectly!';
    } else if (outcome === 'mrwhite') {
      if (badge) badge.textContent = '👻';
      if (title) title.textContent = 'Mr. White Wins!';
      if (sub) sub.textContent = 'The mystery agent guessed correctly!';
    }

    const civWordEl = document.getElementById('revealed-civ-word');
    const underWordEl = document.getElementById('revealed-under-word');
    if (civWordEl) civWordEl.textContent = civWord;
    if (underWordEl) underWordEl.textContent = underWord;

    const rolesSummary = document.getElementById('roles-summary');
    if (rolesSummary && players) {
      rolesSummary.innerHTML = '';
      players.forEach((p) => {
        const chip = document.createElement('div');
        chip.className = `role-chip role-${p.role}`;
        chip.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="chip-role">${getRoleLabel(p.role)}</span>`;
        rolesSummary.appendChild(chip);
      });
    }

    const winScores = document.getElementById('win-scores');
    if (winScores && scores) {
      winScores.innerHTML = '';
      // scores is an object: { playerName: { points, wins } }
      const sorted = Object.entries(scores)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.points - a.points);
      const medals = ['🥇', '🥈', '🥉'];
      sorted.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'score-row';
        row.innerHTML = `
          <span class="score-medal">${medals[i] || (i + 1)}</span>
          <span class="score-name">${escapeHtml(s.name)}</span>
          <span class="score-pts">${s.points} pts</span>
        `;
        winScores.appendChild(row);
      });
    }

    fireConfetti();
    showScreen('screen-win');
    playTone(880, 0.5);
  }, 2500);
});

function getRoleLabel(role) {
  if (role === 'civilian') return '👁️ Civilian';
  if (role === 'undercover') return '🕵️ Undercover';
  if (role === 'mrwhite') return '👻 Mr. White';
  return role;
}

function fireConfetti() {
  const container = document.getElementById('win-confetti');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#a855f7', '#ec4899', '#facc15', '#22d3ee', '#f97316', '#4ade80'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${(Math.random() * 2).toFixed(2)}s`;
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.width = `${8 + Math.random() * 8}px`;
    piece.style.height = `${8 + Math.random() * 8}px`;
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// ─── Win Screen ───────────────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (state.isHost) {
    socket.emit('next-round', { code: state.roomCode });
    playTone(550, 0.15);
  } else {
    showToast('Waiting for host…', 'info');
  }
});

document.getElementById('btn-back-home-win').addEventListener('click', () => {
  showScreen('screen-home');
  resetAllState();
  playTone(330, 0.15);
});

function resetAllState() {
  state.roomCode = '';
  state.isHost = false;
  state.myName = '';
  state.myRole = '';
  state.myWord = '';
  state.round = 1;
  state.players = [];
  state.descriptions = [];
  state.selectedVote = null;
  state.voiceData = null;
  state.mediaRecorder = null;
  state.audioChunks = [];
  clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.recordingSeconds = 0;
}

// ─── Disconnection / Errors ───────────────────────────────────────────────────
socket.on('player-disconnected', ({ name, players }) => {
  showToast(`${name} disconnected`, 'info');
  const lobbyList = document.getElementById('lobby-players-list');
  if (lobbyList && currentScreen && currentScreen.id === 'screen-lobby') {
    renderPlayers(players);
  } else if (players) {
    state.players = players;
  }
});

socket.on('join-error', ({ message }) => {
  showToast(message, 'error');
  playTone(200, 0.2);
});

socket.on('error-msg', ({ message }) => {
  showToast(message, 'error');
  playTone(200, 0.2);
});

socket.on('room-closed', () => {
  showToast('Host left. Room closed.', 'error');
  showScreen('screen-home');
  resetAllState();
  playTone(200, 0.3);
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
showScreen('screen-home');
