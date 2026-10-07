/* =========================================================
   BIG BOSS COMMAND CENTER — app.js
   Architecture: single state store → actions (permission-checked)
   mutate state → commit() persists, broadcasts to other tabs and
   re-renders every component.
   ========================================================= */

const STORAGE_KEY = 'bigboss-command-center-v2';
const ROLE_KEY = 'bigboss-role';
const TAB_ID = Math.random().toString(36).slice(2, 8);
const TEAM_COLORS = { Alpha: '#7c5cff', Beta: '#00d4ff', Gamma: '#22e39b', Delta: '#ff8a3d' };

/* ---------------- Role-based access control ---------------- */
const PERMISSIONS = {
  contestants: 'Add contestants',
  points: 'Points',
  tasks: 'Tasks',
  timer: 'Timer',
  announce: 'Broadcasts',
  captain: 'Captaincy',
  nominate: 'Nominations',
  immunity: 'Immunity',
  evict: 'Eviction',
  log_clear: 'Clear log',
  reset: 'Reset house',
};
const ROLES = {
  bigboss: {
    label: 'Big Boss', icon: '👁', color: '#ff3b5c', pin: '9999', level: 3,
    desc: 'Supreme authority. Full control of the house.',
    perms: Object.keys(PERMISSIONS),
  },
  producer: {
    label: 'Producer', icon: '🎬', color: '#ffc940', pin: '2025', level: 2,
    desc: 'Runs the show: tasks, timer, points and broadcasts.',
    perms: ['contestants', 'points', 'tasks', 'timer', 'announce'],
  },
  moderator: {
    label: 'Moderator', icon: '⚖️', color: '#22e39b', pin: '1234', level: 2,
    desc: 'Handles house politics: captaincy, nominations, immunity.',
    perms: ['captain', 'nominate', 'immunity', 'timer'],
  },
  viewer: {
    label: 'Viewer', icon: '👀', color: '#00d4ff', pin: null, level: 0,
    desc: 'Read-only monitoring of the live house.',
    perms: [],
  },
};
let currentRole = ROLES[sessionStorage.getItem(ROLE_KEY)] ? sessionStorage.getItem(ROLE_KEY) : 'bigboss';
const role = () => ROLES[currentRole];
const can = (perm) => role().perms.includes(perm);
const rolesWith = (perm) => Object.values(ROLES).filter((r) => r.perms.includes(perm)).map((r) => r.label);

/* ---------------- Activity log categories ---------------- */
const LOG_TYPES = {
  points: { label: 'Points', icon: '💎', color: '#7c5cff' },
  task: { label: 'Tasks', icon: '📋', color: '#00d4ff' },
  captain: { label: 'Captaincy', icon: '👑', color: '#ffc940' },
  nomination: { label: 'Nominations', icon: '🎯', color: '#ff3b5c' },
  immunity: { label: 'Immunity', icon: '🛡', color: '#22e39b' },
  eviction: { label: 'Evictions', icon: '🚪', color: '#ff6b81' },
  announce: { label: 'Broadcasts', icon: '📢', color: '#c45cff' },
  timer: { label: 'Timer', icon: '⏱', color: '#4dd0e1' },
  contestant: { label: 'Contestants', icon: '👥', color: '#8a8fb3' },
  access: { label: 'Access', icon: '🔐', color: '#ff8a3d' },
  system: { label: 'System', icon: '⚙', color: '#8a8fb3' },
};

/* ---------------- Event Notification System ---------------- */
const NOTIF_KEY = 'bigboss-notifications';
const NOTIF_PREFS_KEY = 'bigboss-notif-prefs';

// Priority map: which log types get which notification priority
const NOTIF_PRIORITY = {
  eviction: 'critical', nomination: 'high', captain: 'high', announce: 'high',
  immunity: 'normal', points: 'normal', task: 'normal', timer: 'low',
  contestant: 'low', access: 'low', system: 'low',
};
const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_LABELS = { critical: '🔴 Critical', high: '🟡 High', normal: '🔵 Normal', low: '⚪ Low' };

// Sound frequencies for different priorities (Web Audio API)
const NOTIF_SOUNDS = {
  critical: [{ f: 880, d: 120 }, { f: 0, d: 60 }, { f: 880, d: 120 }, { f: 0, d: 60 }, { f: 1100, d: 200 }],
  high: [{ f: 660, d: 150 }, { f: 880, d: 200 }],
  normal: [{ f: 520, d: 180 }],
  low: [{ f: 440, d: 100 }],
};

let notifications = loadNotifications();
let notifPrefs = loadNotifPrefs();
let notifPanelOpen = false;
let notifFilter = 'all';
let notifFreshIds = new Set();
let audioCtx = null;

function loadNotifications() {
  try {
    const n = JSON.parse(localStorage.getItem(NOTIF_KEY));
    return Array.isArray(n) ? n.slice(0, 100) : [];
  } catch (e) { return []; }
}
function saveNotifications() { localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications)); }

function defaultPrefs() {
  const cats = {};
  for (const [k, t] of Object.entries(LOG_TYPES)) {
    cats[k] = { enabled: true, priority: NOTIF_PRIORITY[k] || 'normal' };
  }
  return { cats, sound: true, browser: false, dnd: false };
}
function loadNotifPrefs() {
  try {
    const p = JSON.parse(sessionStorage.getItem(NOTIF_PREFS_KEY));
    if (p && p.cats) return p;
  } catch (e) { /* ignore */ }
  return defaultPrefs();
}
function saveNotifPrefs() { sessionStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(notifPrefs)); }

/** Create a notification from a log entry */
function emitNotification(logEntry) {
  const catPref = notifPrefs.cats[logEntry.type];
  if (!catPref || !catPref.enabled) return;
  if (notifPrefs.dnd) return;

  const lt = LOG_TYPES[logEntry.type] || LOG_TYPES.system;
  const priority = catPref.priority || NOTIF_PRIORITY[logEntry.type] || 'normal';
  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
    logId: logEntry.id, text: logEntry.text, type: logEntry.type,
    icon: lt.icon, priority, role: logEntry.role,
    read: false, time: logEntry.time,
  };
  notifications.unshift(notif);
  notifications = notifications.slice(0, 100);
  notifFreshIds.add(notif.id);
  saveNotifications();

  // Play sound
  if (notifPrefs.sound) playNotifSound(priority);

  // Browser push notification
  if (notifPrefs.browser && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`${lt.icon} ${lt.label} — Big Boss Command Center`, {
        body: logEntry.text, icon: '👁', tag: notif.id, silent: true,
      });
    } catch (e) { /* not all contexts support Notification constructor */ }
  }

  // Update badge immediately
  renderNotifBadge();
}

/** Web Audio API sound synthesis — no external files needed */
function playNotifSound(priority) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const tones = NOTIF_SOUNDS[priority] || NOTIF_SOUNDS.normal;
    let startTime = audioCtx.currentTime;
    for (const tone of tones) {
      if (tone.f === 0) { startTime += tone.d / 1000; continue; }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = priority === 'critical' ? 'square' : 'sine';
      osc.frequency.value = tone.f;
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + tone.d / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + tone.d / 1000);
      startTime += tone.d / 1000;
    }
  } catch (e) { /* Audio not available */ }
}

/* ---------------- Seed data ---------------- */
function seedState() {
  const seed = [
    ['Aarav', 'Alpha', 850], ['Riya', 'Alpha', 720], ['Kabir', 'Beta', 680], ['Ananya', 'Beta', 610],
    ['Vihaan', 'Gamma', 560], ['Meera', 'Gamma', 490], ['Arjun', 'Delta', 430], ['Tara', 'Delta', 390],
  ];
  return {
    nextId: seed.length + 1,
    contestants: seed.map(([name, team, points], i) => ({
      id: i + 1, name, team, points, captain: false, immune: false, nominated: false, evicted: false,
    })),
    tasks: [
      { id: 1, title: 'Debug the Mainframe', assignee: 't:Alpha', reward: 100, done: false, createdAt: Date.now() },
      { id: 2, title: 'Hackathon Sprint', assignee: 'c:3', reward: 75, done: false, createdAt: Date.now() },
    ],
    nextTaskId: 3,
    announcements: [],
    activity: [{ id: 1, text: 'Command Center online. Tech House is LIVE.', type: 'system', role: 'system', tab: 'boot', time: Date.now() }],
    nextLogId: 2,
    evictions: [],
    timer: { duration: 300, remaining: 300, status: 'ready', taskId: null },
    pointHistory: seed.map(([name, , pts], i) => [{ cid: i + 1, pts, delta: pts, time: Date.now(), reason: 'Initial' }]).flat(),
  };
}

let state = load();
let timerInterval = null;
let prevPoints = {};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.contestants) {
      if (s.timer.status === 'running' && !otherConsolesOnline()) s.timer.status = 'paused';
      return s;
    }
  } catch (e) { /* ignore */ }
  return seedState();
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ---------------- Helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (id) => state.contestants.find((c) => c.id === Number(id));
const active = () => state.contestants.filter((c) => !c.evicted);
const captain = () => state.contestants.find((c) => c.captain && !c.evicted);
const ranked = () => [...active()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
const teams = () => [...new Set(state.contestants.map((c) => c.team))];
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const teamColor = (t) => TEAM_COLORS[t] || '#c45cff';
const teamTag = (t) => `<span class="team" style="background:${teamColor(t)}22;color:${teamColor(t)}">${esc(t)}</span>`;

function relTime(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function primaryStatus(c) {
  if (c.evicted) return 'Evicted';
  if (c.captain) return 'Captain';
  if (c.nominated) return 'Nominated';
  if (c.immune) return 'Immune';
  return 'Active';
}
function badges(c) {
  if (c.evicted) return '<span class="badge b-evicted">🚪 Evicted</span>';
  let b = '';
  if (c.captain) b += '<span class="badge b-captain">👑 Captain</span>';
  if (c.immune) b += '<span class="badge b-immune">🛡 Immune</span>';
  if (c.nominated) b += '<span class="badge b-nominated">🎯 Nominated</span>';
  if (!b) b = '<span class="badge b-active">● Active</span>';
  return b;
}

function log(text, type = 'system') {
  const entry = { id: state.nextLogId++, text, type, role: currentRole, tab: TAB_ID, time: Date.now() };
  state.activity.unshift(entry);
  state.activity = state.activity.slice(0, 200);
  $('tickerInner').textContent = `🔴 LIVE · ${text}`;
  // Emit notification for this event
  emitNotification(entry);
}
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function commit() { save(); render(); }

/** Action-layer permission guard — UI locking alone is never trusted. */
function requirePerm(perm) {
  if (can(perm)) return true;
  const msg = `${role().label} attempted "${PERMISSIONS[perm]}" — ACCESS DENIED.`;
  toast(`🔒 ${PERMISSIONS[perm]} requires: ${rolesWith(perm).join(' / ')}`, 'error');
  log(msg, 'access');
  commit();
  return false;
}

function guardActive(c, action) {
  if (!c) { toast('Select a contestant first.', 'error'); return false; }
  if (c.evicted) { toast(`${c.name} is evicted — cannot ${action}.`, 'error'); return false; }
  return true;
}

/* ---------------- Actions ---------------- */
const Actions = {
  addContestant(name, team, points) {
    if (!requirePerm('contestants')) return;
    name = name.trim(); team = team.trim();
    if (!name || !team) return;
    if (state.contestants.some((c) => c.name.toLowerCase() === name.toLowerCase() && !c.evicted)) {
      return toast('A contestant with that name is already in the house.', 'error');
    }
    state.contestants.push({ id: state.nextId++, name, team, points: Number(points) || 0, captain: false, immune: false, nominated: false, evicted: false });
    log(`${name} entered the house (Team ${team}).`, 'contestant');
    toast(`${name} added to the house`, 'success');
    commit();
  },

  changePoints(id, delta) {
    if (!requirePerm('points')) return;
    const c = byId(id);
    if (!guardActive(c, 'receive points')) return;
    delta = Number(delta);
    if (!delta) return toast('Enter a valid amount.', 'error');
    c.points = Math.max(0, c.points + delta);
    if (!state.pointHistory) state.pointHistory = [];
    state.pointHistory.push({ cid: c.id, pts: c.points, delta, time: Date.now(), reason: 'Manual' });
    log(`${delta > 0 ? '+' : ''}${delta} points ${delta > 0 ? 'to' : 'from'} ${c.name} (now ${c.points}).`, 'points');
    toast(`${c.name}: ${delta > 0 ? '+' : ''}${delta} pts`, delta > 0 ? 'success' : 'error');
    commit();
  },

  setCaptain(id) {
    if (!requirePerm('captain')) return;
    const c = byId(id);
    if (!guardActive(c, 'become Captain')) return;
    if (c.captain) return toast(`${c.name} is already Captain.`);
    const prev = captain();
    state.contestants.forEach((x) => (x.captain = false)); // only one captain
    c.captain = true;
    log(prev ? `Captaincy transferred: ${prev.name} → ${c.name}.` : `${c.name} is the new House Captain.`, 'captain');
    toast(`👑 ${c.name} is now House Captain`, 'gold');
    commit();
  },
  removeCaptain() {
    if (!requirePerm('captain')) return;
    const c = captain();
    if (!c) return toast('There is no Captain right now.', 'error');
    c.captain = false;
    log(`${c.name} was removed from captaincy.`, 'captain');
    commit();
  },

  nominate(id) {
    if (!requirePerm('nominate')) return;
    const c = byId(id);
    if (!guardActive(c, 'be nominated')) return;
    if (c.immune) {
      log(`Nomination of ${c.name} blocked — contestant is immune.`, 'nomination');
      commit();
      return toast(`🛡 ${c.name} has immunity and cannot be nominated!`, 'error');
    }
    if (c.nominated) return toast(`${c.name} is already nominated.`);
    c.nominated = true;
    log(`${c.name} has been NOMINATED for eviction.`, 'nomination');
    toast(`🎯 ${c.name} nominated`, 'error');
    commit();
  },
  cancelNomination(id) {
    if (!requirePerm('nominate')) return;
    const c = byId(id);
    if (!c || !c.nominated) return toast('That contestant is not nominated.', 'error');
    c.nominated = false;
    log(`Nomination cancelled for ${c.name}.`, 'nomination');
    toast(`${c.name} is safe`, 'success');
    commit();
  },

  grantImmunity(id) {
    if (!requirePerm('immunity')) return;
    const c = byId(id);
    if (!guardActive(c, 'receive immunity')) return;
    if (c.immune) return toast(`${c.name} is already immune.`);
    c.immune = true;
    let msg = `${c.name} has been granted IMMUNITY.`;
    if (c.nominated) { c.nominated = false; msg += ' Nomination voided.'; }
    log(msg, 'immunity');
    toast(`🛡 ${c.name} is immune`, 'success');
    commit();
  },
  revokeImmunity(id) {
    if (!requirePerm('immunity')) return;
    const c = byId(id);
    if (!c || !c.immune) return toast('That contestant is not immune.', 'error');
    c.immune = false;
    log(`Immunity revoked from ${c.name}.`, 'immunity');
    commit();
  },

  evict(id) {
    if (!requirePerm('evict')) return;
    const c = byId(id);
    if (!guardActive(c, 'be evicted')) return;
    if (!confirm(`Big Boss, confirm eviction of ${c.name}?`)) return;
    const wasCaptain = c.captain;
    Object.assign(c, { evicted: true, captain: false, nominated: false, immune: false });
    state.evictions.unshift({ id: c.id, name: c.name, team: c.team, points: c.points, wasCaptain, time: Date.now() });
    state.tasks = state.tasks.filter((t) => t.done || t.assignee !== 'c:' + c.id);
    log(`${c.name} has been EVICTED from the Tech House.`, 'eviction');
    toast(`🚪 ${c.name} evicted`, 'error');
    commit();
  },

  createTask(title, assignee, reward) {
    if (!requirePerm('tasks')) return;
    title = title.trim();
    if (!title || !assignee) return toast('Task name and assignee required.', 'error');
    if (assignee.startsWith('c:') && !guardActive(byId(assignee.slice(2)), 'receive tasks')) return;
    state.tasks.unshift({ id: state.nextTaskId++, title, assignee, reward: Math.max(0, Number(reward) || 0), done: false, createdAt: Date.now() });
    log(`New task "${title}" assigned to ${assigneeLabel(assignee)}.`, 'task');
    toast('📋 Task assigned', 'success');
    commit();
  },
  completeTask(id) {
    if (!requirePerm('tasks')) return;
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.done) return;
    t.done = true; t.completedAt = Date.now();
    const winners = t.assignee.startsWith('t:')
      ? active().filter((c) => c.team === t.assignee.slice(2))
      : [byId(t.assignee.slice(2))].filter((c) => c && !c.evicted);
    winners.forEach((c) => {
      c.points += t.reward;
      if (!state.pointHistory) state.pointHistory = [];
      state.pointHistory.push({ cid: c.id, pts: c.points, delta: t.reward, time: Date.now(), reason: `Task: ${t.title}` });
    });
    if (state.timer.taskId === id) Timer.reset(true);
    log(`Task "${t.title}" completed by ${assigneeLabel(t.assignee)}${t.reward ? ` (+${t.reward} pts each)` : ''}.`, 'task');
    toast(`✅ "${t.title}" completed`, 'success');
    commit();
  },
  deleteTask(id) {
    if (!requirePerm('tasks')) return;
    const t = state.tasks.find((x) => x.id === id);
    state.tasks = state.tasks.filter((x) => x.id !== id);
    if (state.timer.taskId === id) state.timer.taskId = null;
    if (t) log(`Task "${t.title}" was deleted.`, 'task');
    commit();
  },

  broadcast(text) {
    if (!requirePerm('announce')) return;
    text = text.trim();
    if (!text) return toast('Type an announcement first.', 'error');
    state.announcements.unshift({ text, time: Date.now(), role: currentRole });
    log(`Broadcast: "${text}"`, 'announce');
    commit();
    showBroadcast(text);
  },

  clearLog() {
    if (!requirePerm('log_clear')) return;
    if (!confirm('Clear the entire activity log?')) return;
    state.activity = [];
    log(`Activity log cleared by ${role().label}.`, 'system');
    commit();
  },

  reset() {
    if (!requirePerm('reset')) return;
    if (!confirm('Reset the Command Center to demo data?')) return;
    clearInterval(timerInterval);
    state = seedState(); prevPoints = {};
    log(`House reset to demo data by ${role().label}.`, 'system');
    commit(); toast('Demo data restored', 'success');
  },
};

function assigneeLabel(a) {
  if (a.startsWith('t:')) return `Team ${a.slice(2)}`;
  const c = byId(a.slice(2));
  return c ? c.name : 'Unknown';
}

/* ---------------- Timer ---------------- */
const Timer = {
  minutes: () => Math.max(1, Math.min(99, Number($('timerMinutes').value) || 5)),
  start() {
    if (!requirePerm('timer')) return;
    const t = state.timer;
    if (t.status === 'running') return;
    if (t.status === 'finished' || (t.status === 'ready' && t.remaining === t.duration)) {
      t.duration = this.minutes() * 60; t.remaining = t.duration;
    }
    t.status = 'running';
    log(`Task timer started (${fmtClock(t.remaining)} left).`, 'timer');
    this.tick();
    commit();
  },
  tick() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const t = state.timer;
      if (t.status !== 'running') return clearInterval(timerInterval);
      t.remaining = Math.max(0, t.remaining - 1);
      if (t.remaining === 0) {
        clearInterval(timerInterval);
        t.status = 'finished';
        log('TIME UP! Task timer finished.', 'timer');
        toast('⏰ Time is up!', 'error');
        commit();
      } else { save(); renderTimer(); }
    }, 1000);
  },
  pause() {
    if (!requirePerm('timer')) return;
    if (state.timer.status !== 'running') return toast('Timer is not running.', 'error');
    clearInterval(timerInterval);
    state.timer.status = 'paused';
    log(`Task timer paused at ${fmtClock(state.timer.remaining)}.`, 'timer');
    commit();
  },
  /** internal=true skips permission check (used by task completion). */
  reset(internal = false) {
    if (!internal && !requirePerm('timer')) return false;
    clearInterval(timerInterval);
    const m = this.minutes();
    Object.assign(state.timer, { duration: m * 60, remaining: m * 60, status: 'ready' });
    return true;
  },
  linkTask(id) {
    if (!requirePerm('timer')) return;
    const t = state.tasks.find((x) => x.id === id);
    this.reset(true);
    state.timer.taskId = id;
    log(`Timer linked to task "${t.title}".`, 'timer');
    toast(`⏱ Timer linked to "${t.title}"`);
    commit();
    $('timerCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
};
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------------- Broadcast overlay ---------------- */
let broadcastTimeout;
function showBroadcast(text) {
  $('broadcastText').textContent = text;
  $('broadcastOverlay').classList.add('show');
  clearTimeout(broadcastTimeout);
  broadcastTimeout = setTimeout(hideBroadcast, 7000);
}
function hideBroadcast() { $('broadcastOverlay').classList.remove('show'); }

/* ---------------- Role switching UI ---------------- */
let pendingRole = null;
function openRoleModal() {
  pendingRole = currentRole;
  renderRoleGrid();
  $('roleOverlay').classList.add('show');
}
function closeRoleModal() { $('roleOverlay').classList.remove('show'); $('pinInput').value = ''; }
function renderRoleGrid() {
  $('roleGrid').innerHTML = Object.entries(ROLES).map(([key, r]) => `
    <button type="button" class="role-card ${key === pendingRole ? 'selected' : ''} ${key === currentRole ? 'current' : ''}"
      data-role="${key}" style="--rc:${r.color}">
      <div class="rn">${r.icon} ${r.label} ${r.pin ? '🔒' : ''}</div>
      <div class="rd">${r.desc}</div>
      <div class="perm-list">${Object.entries(PERMISSIONS).map(([p, l]) => `<span class="${r.perms.includes(p) ? 'on' : ''}">${l}</span>`).join('')}</div>
    </button>`).join('');
  const target = ROLES[pendingRole];
  const needsPin = target.pin && target.level > role().level;
  $('pinInput').style.display = needsPin ? '' : 'none';
  $('pinSubmit').textContent = pendingRole === currentRole ? 'Stay' : needsPin ? `Unlock ${target.label}` : `Switch to ${target.label}`;
  if (needsPin) setTimeout(() => $('pinInput').focus(), 50);
}
function switchRole(e) {
  e.preventDefault();
  const target = ROLES[pendingRole];
  if (pendingRole === currentRole) return closeRoleModal();
  const needsPin = target.pin && target.level > role().level;
  if (needsPin && $('pinInput').value !== target.pin) {
    $('pinForm').classList.remove('shake'); void $('pinForm').offsetWidth; $('pinForm').classList.add('shake');
    toast('❌ Incorrect PIN', 'error');
    log(`Failed PIN attempt for ${target.label} access (from ${role().label}).`, 'access');
    commit();
    return;
  }
  const from = role().label;
  currentRole = pendingRole;
  sessionStorage.setItem(ROLE_KEY, currentRole);
  log(`Console switched role: ${from} → ${target.label}.`, 'access');
  toast(`${target.icon} Now operating as ${target.label}`, 'success');
  closeRoleModal();
  announcePresence();
  commit();
}

/* ---------------- Multi-console presence (BroadcastChannel) ---------------- */
const consoles = new Map(); // tabId -> { role, seen }
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('bigboss-presence') : null;
function announcePresence(type = 'ping') { channel?.postMessage({ type, tab: TAB_ID, role: currentRole }); }
function otherConsolesOnline() {
  const now = Date.now();
  return [...consoles.values()].some((c) => now - c.seen < 5000);
}
if (channel) {
  channel.onmessage = ({ data }) => {
    if (data.type === 'bye') consoles.delete(data.tab);
    else consoles.set(data.tab, { role: data.role, seen: Date.now() });
    if (data.type === 'hello') announcePresence();
    renderPresence();
  };
  window.addEventListener('beforeunload', () => announcePresence('bye'));
}
function renderPresence() {
  const now = Date.now();
  for (const [k, v] of consoles) if (now - v.seen > 6000) consoles.delete(k);
  const all = [{ role: currentRole }, ...consoles.values()];
  const el = $('hConsoles');
  el.textContent = `🖥 ${all.length} console${all.length > 1 ? 's' : ''}`;
  el.title = 'Live consoles: ' + all.map((c, i) => `${ROLES[c.role]?.label || c.role}${i === 0 ? ' (you)' : ''}`).join(', ');
  el.classList.toggle('on', all.length > 1);
}

/* Cross-tab state sync: any change in another console is applied instantly */
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  const lastAnnounce = state.announcements[0]?.time;
  state = JSON.parse(e.newValue);
  if (state.timer.status !== 'running') clearInterval(timerInterval);
  const top = state.announcements[0];
  if (top && top.time !== lastAnnounce && Date.now() - top.time < 5000) showBroadcast(top.text);
  render();
});

/* ---------------- Rendering ---------------- */
function render() {
  applyAccess();
  renderHeader();
  renderLeaderboard();
  renderContestants();
  renderTasks();
  renderSelects();
  renderDangerZone();
  renderStats();
  renderTimer();
  renderFeeds();
  renderLog();
  renderNotifBadge();
  if (notifPanelOpen) renderNotifPanel();
  renderAnalytics();
  prevPoints = Object.fromEntries(state.contestants.map((c) => [c.id, c.points]));
}

function applyAccess() {
  const r = role();
  const btn = $('roleBtn');
  btn.textContent = `${r.icon} ${r.label} ▾`;
  btn.style.setProperty('--role-color', r.color);
  document.body.dataset.role = currentRole;
  document.querySelectorAll('[data-perm]').forEach((el) => {
    const ok = can(el.dataset.perm);
    el.classList.toggle('locked', !ok);
    el.dataset.lockLabel = `🔒 ${rolesWith(el.dataset.perm).join(' / ')}`;
    el.querySelectorAll('input, select, textarea, button').forEach((i) => (i.tabIndex = ok ? 0 : -1));
  });
}

function renderHeader() {
  const cap = captain();
  $('hActive').textContent = active().length;
  $('hCaptain').textContent = cap ? cap.name : 'None';
  $('captainCurrent').textContent = cap ? `${cap.name} (Team ${cap.team})` : 'None';
  const last = state.announcements[0];
  const hb = $('hBroadcast');
  const recent = last && Date.now() - last.time < 60000;
  hb.classList.toggle('on', !!recent);
  hb.textContent = last ? `📡 ${recent ? 'ON AIR' : 'Last'}: ${last.text.slice(0, 28)}${last.text.length > 28 ? '…' : ''}` : '📡 No broadcast';
}

function renderLeaderboard() {
  const list = ranked();
  const max = Math.max(1, ...list.map((c) => c.points));
  $('leaderboard').innerHTML = list.length ? list.map((c, i) => {
    const prev = prevPoints[c.id];
    const flash = prev === undefined || prev === c.points ? '' : c.points > prev ? 'flash-up' : 'flash-down';
    const cls = [c.captain && 'captain', c.nominated && 'nominated', c.immune && 'immune', flash].filter(Boolean).join(' ');
    return `<li class="lb-item ${cls}">
      <div class="lb-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</div>
      <div><div class="lb-name">${c.captain ? '👑 ' : ''}${esc(c.name)} ${badges(c)}</div>
        <div class="lb-bar"><div style="width:${(c.points / max) * 100}%"></div></div></div>
      <div class="lb-team">${teamTag(c.team)}</div>
      <div class="lb-points">${c.points}</div>
    </li>`;
  }).join('') : '<li class="empty">No active contestants.</li>';
}

function renderContestants() {
  const list = [...state.contestants].sort((a, b) => a.evicted - b.evicted || b.points - a.points);
  $('contestantCount').textContent = `${active().length} active / ${state.contestants.length} total`;
  $('contestantTable').innerHTML = list.map((c) => {
    let acts = '';
    if (c.evicted) acts = '<span class="t-meta">No actions — evicted</span>';
    else {
      if (can('points')) acts += `
        <button class="btn btn-green xs" data-act="pts" data-id="${c.id}" data-v="50">+50</button>
        <button class="btn btn-red xs" data-act="pts" data-id="${c.id}" data-v="-50">−50</button>`;
      if (can('captain')) acts += `<button class="btn btn-gold xs" data-act="cap" data-id="${c.id}" ${c.captain ? 'disabled' : ''} title="Make Captain">👑</button>`;
      if (can('nominate')) acts += c.nominated
        ? `<button class="btn btn-ghost xs" data-act="unnom" data-id="${c.id}">Un-nominate</button>`
        : `<button class="btn btn-red xs" data-act="nom" data-id="${c.id}" ${c.immune ? 'disabled title="Immune — cannot nominate"' : 'title="Nominate"'}>🎯</button>`;
      if (can('immunity')) acts += c.immune
        ? `<button class="btn btn-ghost xs" data-act="unimm" data-id="${c.id}" title="Revoke immunity">−🛡</button>`
        : `<button class="btn btn-green xs" data-act="imm" data-id="${c.id}" title="Grant immunity">🛡</button>`;
      if (can('evict')) acts += `<button class="btn btn-ghost xs" data-act="evict" data-id="${c.id}" title="Evict">🚪</button>`;
      if (!acts) acts = '<span class="view-only">👀 View only</span>';
    }
    return `<tr class="${c.evicted ? 'evicted' : ''} ${c.captain ? 'captain' : ''}">
      <td>${c.captain ? '👑 ' : ''}${esc(c.name)}</td><td>${teamTag(c.team)}</td>
      <td><strong>${c.points}</strong></td><td title="${primaryStatus(c)}">${badges(c)}</td>
      <td><div class="actions">${acts}</div></td></tr>`;
  }).join('');
  $('teamList').innerHTML = teams().map((t) => `<option value="${esc(t)}">`).join('');
}

function renderTasks() {
  const act = state.tasks.filter((t) => !t.done);
  const done = state.tasks.filter((t) => t.done).sort((a, b) => b.completedAt - a.completedAt);
  $('taskCount').textContent = `${act.length} active · ${done.length} done`;
  $('activeTasks').innerHTML = act.length ? act.map((t) => {
    let btns = '';
    if (can('timer')) btns += `<button class="btn btn-ghost xs" data-task="timer" data-id="${t.id}" title="Link timer">⏱</button>`;
    if (can('tasks')) btns += `<button class="btn btn-green xs" data-task="done" data-id="${t.id}">✓ Done</button>
        <button class="btn btn-ghost xs" data-task="del" data-id="${t.id}" title="Delete">✕</button>`;
    return `<li class="${state.timer.taskId === t.id ? 'timed' : ''}">
      <div><div class="t-title">${esc(t.title)}</div>
      <div class="t-meta">→ ${esc(assigneeLabel(t.assignee))} · 🏅 ${t.reward} pts</div></div>
      <div class="actions">${btns || '<span class="view-only">👀</span>'}</div></li>`;
  }).join('') : '<li class="empty">No active tasks.</li>';
  $('completedTasks').innerHTML = done.length ? done.map((t) => `
    <li><div><div class="t-title">${esc(t.title)}</div>
    <div class="t-meta">${esc(assigneeLabel(t.assignee))} · +${t.reward} · ${fmtTime(t.completedAt)}</div></div><span>✅</span></li>`).join('')
    : '<li class="empty">Nothing completed yet.</li>';
}

function fillSelect(id, items, placeholder) {
  const el = $(id);
  const prev = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + items.map((o) =>
    `<option value="${o.value}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</option>`).join('');
  if ([...el.options].some((o) => o.value === prev && !o.disabled)) el.value = prev;
}

function renderSelects() {
  const act = ranked();
  const opt = (c, suffix = '') => ({ value: c.id, label: `${c.name} (${c.team}) · ${c.points}${suffix}` });
  fillSelect('pointTarget', act.map((c) => opt(c)), 'Select contestant…');
  fillSelect('captainTarget', act.map((c) => ({ ...opt(c, c.captain ? ' 👑 current' : ''), disabled: c.captain })), 'Select new Captain…');
  fillSelect('nominateTarget', act.map((c) => ({
    ...opt(c, c.immune ? ' — 🛡 IMMUNE (locked)' : c.nominated ? ' — 🎯 nominated' : ''),
    disabled: c.immune,
  })), 'Select contestant…');
  fillSelect('immunityTarget', act.map((c) => opt(c, c.immune ? ' — 🛡 immune' : '')), 'Select contestant…');
  fillSelect('evictTarget', act.map((c) => opt(c, c.nominated ? ' — 🎯 nominated' : '')), 'Select contestant to evict…');

  const taskSel = $('taskAssignee');
  const prev = taskSel.value;
  const activeTeams = [...new Set(act.map((c) => c.team))];
  taskSel.innerHTML = '<option value="">Assign to…</option>' +
    `<optgroup label="Teams">${activeTeams.map((t) => `<option value="t:${esc(t)}">Team ${esc(t)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Contestants">${act.map((c) => `<option value="c:${c.id}">${esc(c.name)}</option>`).join('')}</optgroup>`;
  if ([...taskSel.options].some((o) => o.value === prev)) taskSel.value = prev;
}

function renderDangerZone() {
  const noms = ranked().filter((c) => c.nominated);
  $('dzCount').textContent = `${noms.length} nominee${noms.length === 1 ? '' : 's'}`;
  $('dangerZone').innerHTML = noms.length ? noms.map((c) => {
    let btns = '';
    if (can('nominate')) btns += `<button class="btn btn-ghost xs" data-act="unnom" data-id="${c.id}">Save</button>`;
    if (can('immunity')) btns += `<button class="btn btn-green xs" data-act="imm" data-id="${c.id}">🛡 Immunity</button>`;
    if (can('evict')) btns += `<button class="btn btn-red xs" data-act="evict" data-id="${c.id}">🚪 Evict</button>`;
    return `<div class="dz-card">
      <div class="nm">${c.captain ? '👑 ' : ''}${esc(c.name)}</div>
      ${teamTag(c.team)}
      <div class="pts">${c.points} pts</div>
      <div>${badges(c)}${c.immune ? '' : '<span class="badge b-evicted">No immunity</span>'}</div>
      <div class="actions">${btns || '<span class="view-only">👀 View only</span>'}</div>
    </div>`;
  }).join('') : '<div class="empty">The Danger Zone is clear. No nominations.</div>';
}

function renderStats() {
  const list = ranked();
  const top = list[0];
  const tie = top ? list.filter((c) => c.points === top.points) : [];
  const cap = captain();
  const s = [
    ['Active Contestants', active().length, 'blue'],
    ['Highest Scorer', top ? tie.map((c) => c.name).join(', ') : '—', 'gold'],
    ['Highest Score', top ? top.points : 0, 'gold'],
    ['Completed Tasks', state.tasks.filter((t) => t.done).length, 'green'],
    ['Active Tasks', state.tasks.filter((t) => !t.done).length, 'blue'],
    ['Nominees', active().filter((c) => c.nominated).length, 'red'],
    ['Immune', active().filter((c) => c.immune).length, 'green'],
    ['House Captain', cap ? cap.name : 'None', 'gold'],
    ['Evicted', state.evictions.length, ''],
    ['Total House Points', active().reduce((a, c) => a + c.points, 0), ''],
  ];
  $('stats').innerHTML = s.map(([k, v, cls]) => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v" title="${esc(v)}">${esc(v)}</div></div>`).join('');
}

function renderTimer() {
  const t = state.timer;
  const card = $('timerCard');
  card.className = 'card timer-card ' + t.status + (t.status === 'running' && t.remaining <= 10 ? ' warning' : '');
  $('timerDisplay').textContent = fmtClock(t.remaining);
  $('timerState').textContent = { ready: 'READY', running: '● RUNNING', paused: '❚❚ PAUSED', finished: '⏰ TIME UP' }[t.status];
  $('timerBar').style.width = `${(t.remaining / t.duration) * 100}%`;
  const task = state.tasks.find((x) => x.id === t.taskId && !x.done);
  $('timerTask').textContent = task ? `Linked: ${task.title} → ${assigneeLabel(task.assignee)}` : 'No task linked (use ⏱ on a task)';
  $('timerStart').disabled = t.status === 'running';
  $('timerPause').disabled = t.status !== 'running';
  $('timerMinutes').disabled = t.status === 'running' || t.status === 'paused';
}

function renderFeeds() {
  $('announceFeed').innerHTML = state.announcements.length ? state.announcements.map((a) =>
    `<li><span class="time">${fmtTime(a.time)}${a.role ? ' · ' + (ROLES[a.role]?.label || '') : ''}</span>📢 ${esc(a.text)}</li>`).join('') : '<li class="empty">No announcements yet.</li>';
  $('evictionHistory').innerHTML = state.evictions.length ? state.evictions.map((e) =>
    `<li><div><strong>${esc(e.name)}</strong> ${teamTag(e.team)} ${e.wasCaptain ? '<span class="badge b-captain">ex-captain</span>' : ''}
     <span class="time">${fmtTime(e.time)} · Final: ${e.points} pts</span></div><span class="badge b-evicted">Evicted</span></li>`).join('')
    : '<li class="empty">No evictions yet.</li>';
}

/* ---------------- Real-time activity log ---------------- */
const logView = { filter: 'all', search: '', frozenAt: null, seen: new Set() };

function filteredLog() {
  const q = logView.search.toLowerCase();
  return state.activity.filter((a) =>
    (logView.filter === 'all' || a.type === logView.filter) &&
    (logView.frozenAt === null || a.id <= logView.frozenAt) &&
    (!q || a.text.toLowerCase().includes(q) || (ROLES[a.role]?.label || a.role).toLowerCase().includes(q) || (LOG_TYPES[a.type]?.label || '').toLowerCase().includes(q)));
}

function renderLog() {
  // filter chips with live counts
  const counts = state.activity.reduce((m, a) => ((m[a.type] = (m[a.type] || 0) + 1), m), {});
  const chips = [['all', `All<b>${state.activity.length}</b>`]].concat(
    Object.entries(LOG_TYPES).filter(([k]) => counts[k]).map(([k, t]) => [k, `${t.icon} ${t.label}<b>${counts[k]}</b>`]));
  if (logView.filter !== 'all' && !counts[logView.filter]) logView.filter = 'all';
  $('logFilters').innerHTML = chips.map(([k, l]) => `<button class="chip ${logView.filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('');

  const items = filteredLog();
  $('logCount').textContent = `${state.activity.length} events`;
  const pending = logView.frozenAt === null ? 0 : state.activity.filter((a) => a.id > logView.frozenAt).length;
  $('logNew').hidden = !pending;
  $('logNew').textContent = `⬆ ${pending} new event${pending === 1 ? '' : 's'} — resume live`;
  $('activityCard').classList.toggle('frozen', logView.frozenAt !== null);
  $('logFreeze').textContent = logView.frozenAt === null ? '⏸ Freeze' : '▶ Live';

  $('activityLog').innerHTML = items.length ? items.map((a) => {
    const t = LOG_TYPES[a.type] || LOG_TYPES.system;
    const r = ROLES[a.role];
    const fresh = !logView.seen.has(a.id) && logView.seen.size > 0;
    return `<li class="${fresh ? 'fresh' : ''}" style="--lc:${t.color}">
      <div class="li-icon">${t.icon}</div>
      <div><div>${esc(a.text)}</div>
        <div class="li-meta">
          <span class="actor" style="--ac:${r ? r.color : '#8a8fb3'}">${r ? `${r.icon} ${r.label}` : '⚙ System'}</span>
          <span class="cat">${t.label}</span>
          ${a.tab !== TAB_ID && a.tab !== 'boot' ? '<span class="remote" title="Performed from another console">REMOTE</span>' : ''}
        </div></div>
      <div class="when"><span class="rel" data-t="${a.time}">${relTime(a.time)}</span><small>${fmtTime(a.time)}</small></div>
    </li>`;
  }).join('') : '<li class="empty">No events match.</li>';
  state.activity.forEach((a) => logView.seen.add(a.id));
  if (logView.seen.size === 0) logView.seen.add(-1); // first render done; subsequent new items animate
}
function tickLogTimes() {
  document.querySelectorAll('#activityLog .rel').forEach((el) => (el.textContent = relTime(Number(el.dataset.t))));
}
function exportLog() {
  const rows = [['Time', 'Category', 'Role', 'Event']].concat(filteredLog().map((a) =>
    [new Date(a.time).toISOString(), LOG_TYPES[a.type]?.label || a.type, ROLES[a.role]?.label || a.role, a.text]));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `bigboss-activity-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('⬇ Activity log exported', 'success');
}

/* ---------------- Event wiring ---------------- */
function wire() {
  $('addContestantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Actions.addContestant($('newName').value, $('newTeam').value, $('newPoints').value);
    e.target.reset(); $('newPoints').value = 0;
  });
  $('taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    Actions.createTask($('taskTitle').value, $('taskAssignee').value, $('taskReward').value);
    $('taskTitle').value = '';
  });

  $('addPoints').onclick = () => Actions.changePoints($('pointTarget').value, Math.abs($('pointAmount').value));
  $('deductPoints').onclick = () => Actions.changePoints($('pointTarget').value, -Math.abs($('pointAmount').value));
  document.querySelectorAll('[data-quick]').forEach((b) =>
    (b.onclick = () => Actions.changePoints($('pointTarget').value, b.dataset.quick)));

  $('assignCaptain').onclick = () => Actions.setCaptain($('captainTarget').value);
  $('removeCaptain').onclick = () => Actions.removeCaptain();
  $('nominate').onclick = () => Actions.nominate($('nominateTarget').value);
  $('cancelNomination').onclick = () => Actions.cancelNomination($('nominateTarget').value);
  $('grantImmunity').onclick = () => Actions.grantImmunity($('immunityTarget').value);
  $('revokeImmunity').onclick = () => Actions.revokeImmunity($('immunityTarget').value);
  $('evict').onclick = () => Actions.evict($('evictTarget').value);

  $('broadcastBtn').onclick = () => { Actions.broadcast($('announceText').value); if (can('announce')) $('announceText').value = ''; };
  $('announceText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('broadcastBtn').click(); }
  });
  $('broadcastClose').onclick = hideBroadcast;
  $('broadcastOverlay').onclick = (e) => { if (e.target.id === 'broadcastOverlay') hideBroadcast(); };

  $('timerStart').onclick = () => Timer.start();
  $('timerPause').onclick = () => Timer.pause();
  $('timerReset').onclick = () => { if (Timer.reset()) { log('Task timer reset.', 'timer'); commit(); } };
  $('timerMinutes').addEventListener('change', () => {
    if (can('timer') && (state.timer.status === 'ready' || state.timer.status === 'finished')) { Timer.reset(true); commit(); }
  });

  // Role modal
  $('roleBtn').onclick = openRoleModal;
  $('roleClose').onclick = closeRoleModal;
  $('roleOverlay').onclick = (e) => { if (e.target.id === 'roleOverlay') closeRoleModal(); };
  $('roleGrid').onclick = (e) => {
    const card = e.target.closest('[data-role]');
    if (card) { pendingRole = card.dataset.role; $('pinInput').value = ''; renderRoleGrid(); }
  };
  $('pinForm').addEventListener('submit', switchRole);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeRoleModal(); hideBroadcast(); } });

  // Activity log controls
  $('logSearch').addEventListener('input', (e) => { logView.search = e.target.value; renderLog(); });
  $('logFilters').onclick = (e) => {
    const c = e.target.closest('[data-filter]');
    if (c) { logView.filter = c.dataset.filter; renderLog(); }
  };
  $('logFreeze').onclick = () => {
    logView.frozenAt = logView.frozenAt === null ? (state.activity[0]?.id ?? 0) : null;
    renderLog();
  };
  $('logNew').onclick = () => { logView.frozenAt = null; renderLog(); };
  $('logExport').onclick = exportLog;
  $('logClear').onclick = () => Actions.clearLog();

  // Delegated quick actions (table, danger zone, tasks)
  document.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const id = b.dataset.id;
      ({
        pts: () => Actions.changePoints(id, b.dataset.v),
        cap: () => Actions.setCaptain(id),
        nom: () => Actions.nominate(id),
        unnom: () => Actions.cancelNomination(id),
        imm: () => Actions.grantImmunity(id),
        unimm: () => Actions.revokeImmunity(id),
        evict: () => Actions.evict(id),
      })[b.dataset.act]?.();
      return;
    }
    const tb = e.target.closest('[data-task]');
    if (tb) {
      const id = Number(tb.dataset.id);
      ({ done: () => Actions.completeTask(id), del: () => Actions.deleteTask(id), timer: () => Timer.linkTask(id) })[tb.dataset.task]();
    }
  });

  $('resetData').onclick = () => Actions.reset();

  setInterval(() => {
    $('hClock').textContent = new Date().toLocaleTimeString();
    renderHeader();
    tickLogTimes();
  }, 1000);
  setInterval(() => { announcePresence(); renderPresence(); }, 2000);
}

/* ---------------- Notification panel rendering ---------------- */
function renderNotifBadge() {
  const unread = notifications.filter((n) => !n.read).length;
  const badge = $('notifBadge');
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : unread;
  $('notifBell').classList.toggle('has-unread', unread > 0);
}

function renderNotifPanel() {
  // Filters
  const priorities = ['all', 'critical', 'high', 'normal', 'low'];
  const counts = notifications.reduce((m, n) => ((m[n.priority] = (m[n.priority] || 0) + 1), m), {});
  $('notifFilters').innerHTML = priorities.map((p) => {
    const cnt = p === 'all' ? notifications.length : (counts[p] || 0);
    const label = p === 'all' ? `All <b>${cnt}</b>` : `${PRIORITY_LABELS[p]} <b>${cnt}</b>`;
    return `<button class="chip ${notifFilter === p ? 'active' : ''}" data-nfilter="${p}">${label}</button>`;
  }).join('');

  // Filtered list
  const filtered = notifFilter === 'all' ? notifications : notifications.filter((n) => n.priority === notifFilter);
  const list = $('notifList');

  if (!filtered.length) {
    list.innerHTML = `<li class="notif-empty">${notifications.length ? 'No notifications in this filter.' : '🔔 No notifications yet.<br>Events will appear here in real time.'}</li>`;
  } else {
    list.innerHTML = filtered.map((n) => {
      const r = ROLES[n.role];
      const isFresh = notifFreshIds.has(n.id);
      return `<li class="${n.read ? '' : 'unread'} p-${n.priority} ${isFresh ? 'fresh-notif' : ''}" data-nid="${n.id}">
        <div class="ni-icon">${n.icon}</div>
        <div class="ni-text">
          <div>${esc(n.text)}</div>
          <div class="ni-sub">
            <span class="actor" style="--ac:${r ? r.color : '#8a8fb3'}">${r ? r.icon + ' ' + r.label : '⚙ System'}</span>
            <span>${LOG_TYPES[n.type]?.label || n.type}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <span class="ni-time">${relTime(n.time)}</span>
          <button class="ni-dismiss" data-ndismiss="${n.id}" title="Dismiss">✕</button>
        </div>
      </li>`;
    }).join('');
  }
  notifFreshIds.clear();

  // Footer
  const unread = notifications.filter((n) => !n.read).length;
  $('notifSummary').textContent = `${unread} unread · ${notifications.length} total`;

  // Browser notification permission button
  const permBtn = $('notifBrowserPerm');
  if ('Notification' in window && Notification.permission === 'default') {
    permBtn.hidden = false;
  } else {
    permBtn.hidden = true;
  }
}

function renderNotifPrefs() {
  $('notifPrefsGrid').innerHTML = Object.entries(LOG_TYPES).map(([k, t]) => {
    const pref = notifPrefs.cats[k] || { enabled: true, priority: 'normal' };
    return `<div class="pref-row">
      <input type="checkbox" data-npref="${k}" ${pref.enabled ? 'checked' : ''} />
      <span class="prow-icon">${t.icon}</span>
      <span class="prow-label">${t.label}</span>
      <select data-nprio="${k}">
        ${Object.entries(PRIORITY_LABELS).map(([p, l]) => `<option value="${p}" ${pref.priority === p ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
  $('prefSound').checked = notifPrefs.sound;
  $('prefBrowser').checked = notifPrefs.browser;
  $('prefDND').checked = notifPrefs.dnd;
}

/* ---------------- Notification event wiring ---------------- */
function wireNotifications() {
  // Bell toggle
  $('notifBell').onclick = (e) => {
    e.stopPropagation();
    notifPanelOpen = !notifPanelOpen;
    $('notifPanel').hidden = !notifPanelOpen;
    if (notifPanelOpen) renderNotifPanel();
  };

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (notifPanelOpen && !e.target.closest('.notif-wrap')) {
      notifPanelOpen = false;
      $('notifPanel').hidden = true;
    }
  });

  // Mark all read
  $('notifMarkAll').onclick = () => {
    notifications.forEach((n) => (n.read = true));
    saveNotifications();
    renderNotifBadge();
    renderNotifPanel();
    toast('All notifications marked as read', 'success');
  };

  // Clear all
  $('notifClearAll').onclick = () => {
    notifications = [];
    saveNotifications();
    renderNotifBadge();
    renderNotifPanel();
    toast('Notifications cleared');
  };

  // Click notification to mark read / dismiss
  $('notifList').addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-ndismiss]');
    if (dismiss) {
      notifications = notifications.filter((n) => n.id !== dismiss.dataset.ndismiss);
      saveNotifications();
      renderNotifBadge();
      renderNotifPanel();
      return;
    }
    const li = e.target.closest('[data-nid]');
    if (li) {
      const n = notifications.find((x) => x.id === li.dataset.nid);
      if (n) { n.read = true; saveNotifications(); renderNotifBadge(); renderNotifPanel(); }
    }
  });

  // Filter chips
  $('notifFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-nfilter]');
    if (chip) { notifFilter = chip.dataset.nfilter; renderNotifPanel(); }
  });

  // Browser notification permission
  $('notifBrowserPerm').onclick = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        notifPrefs.browser = true;
        saveNotifPrefs();
        toast('🌐 Browser notifications enabled', 'success');
      } else {
        toast('Browser notifications denied', 'error');
      }
      renderNotifPanel();
    }
  };

  // Preferences modal
  $('notifPrefsBtn').onclick = () => {
    renderNotifPrefs();
    $('notifPrefsOverlay').classList.add('show');
  };
  $('notifPrefsClose').onclick = () => $('notifPrefsOverlay').classList.remove('show');
  $('notifPrefsOverlay').onclick = (e) => { if (e.target.id === 'notifPrefsOverlay') $('notifPrefsOverlay').classList.remove('show'); };

  // Per-category toggles and priority selects
  $('notifPrefsGrid').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-npref]');
    if (cb) { notifPrefs.cats[cb.dataset.npref].enabled = cb.checked; saveNotifPrefs(); }
    const sel = e.target.closest('[data-nprio]');
    if (sel) { notifPrefs.cats[sel.dataset.nprio].priority = sel.value; saveNotifPrefs(); }
  });

  // Global toggles
  $('prefSound').onchange = () => { notifPrefs.sound = $('prefSound').checked; saveNotifPrefs(); };
  $('prefBrowser').onchange = async () => {
    if ($('prefBrowser').checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { $('prefBrowser').checked = false; toast('Browser notifications denied', 'error'); return; }
    }
    notifPrefs.browser = $('prefBrowser').checked;
    saveNotifPrefs();
  };
  $('prefDND').onchange = () => {
    notifPrefs.dnd = $('prefDND').checked;
    saveNotifPrefs();
    toast(notifPrefs.dnd ? '🌙 Do Not Disturb enabled' : '🔔 Notifications resumed');
  };
}

/* ---------------- Performance Analytics ---------------- */
let activeATab = 'overview';

function renderAnalytics() {
  const tab = activeATab;
  if (tab === 'overview') renderAOverview();
  else if (tab === 'teams') renderATeams();
  else if (tab === 'contestants') renderAContestants();
  else if (tab === 'insights') renderAInsights();
}

function renderAOverview() {
  drawPointsBar();
  drawHistoryChart();
  renderKPIs();
}

function drawPointsBar() {
  const canvas = $('chartPoints');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement;
  canvas.width = rect.clientWidth * dpr;
  canvas.height = 220 * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.clientWidth, H = 220;
  ctx.clearRect(0, 0, W, H);

  const list = ranked();
  if (!list.length) return;
  const max = Math.max(1, ...list.map(c => c.points));
  const barW = Math.min(40, (W - 40) / list.length - 6);
  const gap = (W - 40) / list.length;

  list.forEach((c, i) => {
    const x = 30 + i * gap + (gap - barW) / 2;
    const h = (c.points / max) * (H - 50);
    const y = H - 24 - h;
    const col = c.captain ? '#ffc940' : teamColor(c.team);

    // Bar
    const grad = ctx.createLinearGradient(x, y, x, H - 24);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '44');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, [4, 4, 0, 0]);
    ctx.fill();

    // Value
    ctx.fillStyle = '#e8e9f5';
    ctx.font = '600 10px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(c.points, x + barW / 2, y - 6);

    // Name
    ctx.fillStyle = '#8a8fb3';
    ctx.font = '500 9px Inter';
    ctx.fillText(c.name.slice(0, 6), x + barW / 2, H - 10);
  });
}

function drawHistoryChart() {
  const canvas = $('chartHistory');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.parentElement.clientWidth * dpr;
  canvas.height = 220 * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.parentElement.clientWidth, H = 220;
  ctx.clearRect(0, 0, W, H);

  const history = state.pointHistory || [];
  if (history.length < 2) {
    ctx.fillStyle = '#8a8fb3';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Point changes will appear here as a timeline', W / 2, H / 2);
    return;
  }

  // Group by contestant, plot lines
  const cids = [...new Set(history.map(h => h.cid))];
  const tMin = Math.min(...history.map(h => h.time));
  const tMax = Math.max(...history.map(h => h.time));
  const tRange = Math.max(1, tMax - tMin);
  const pMax = Math.max(1, ...history.map(h => h.pts));
  const pad = { l: 35, r: 10, t: 10, b: 20 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  // Grid lines
  ctx.strokeStyle = '#1d1f33';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.font = '9px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(pMax * (1 - i / 4)), pad.l - 4, y + 3);
  }

  cids.forEach(cid => {
    const c = byId(cid);
    if (!c) return;
    const points = history.filter(h => h.cid === cid).sort((a, b) => a.time - b.time);
    if (points.length < 1) return;
    const col = c.captain ? '#ffc940' : teamColor(c.team);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = c.evicted ? 0.3 : 0.85;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad.l + ((p.time - tMin) / tRange) * cW;
      const y = pad.t + cH - (p.pts / pMax) * cH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // End dot + label
    const last = points[points.length - 1];
    const lx = pad.l + ((last.time - tMin) / tRange) * cW;
    const ly = pad.t + cH - (last.pts / pMax) * cH;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 8px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(c.name.slice(0, 5), lx + 5, ly + 3);
    ctx.globalAlpha = 1;
  });
}

function renderKPIs() {
  const list = ranked();
  const hist = state.pointHistory || [];
  const totalPts = list.reduce((a, c) => a + c.points, 0);
  const avgPts = list.length ? Math.round(totalPts / list.length) : 0;
  const topGainer = findTopGainer(hist);
  const totalChanges = hist.length;
  const doneTasks = state.tasks.filter(t => t.done).length;
  const taskPts = state.tasks.filter(t => t.done).reduce((a, t) => a + t.reward, 0);
  const spread = list.length >= 2 ? list[0].points - list[list.length - 1].points : 0;

  const kpis = [
    ['Total Points', totalPts, '', 'blue'],
    ['Average Score', avgPts, `across ${list.length} contestants`, ''],
    ['Top Gainer', topGainer.name || '—', topGainer.delta ? `+${topGainer.delta} pts gained` : '', 'up'],
    ['Point Spread', spread, 'gap between #1 and last', spread > 300 ? 'down' : ''],
    ['Task Rewards', taskPts, `from ${doneTasks} completed tasks`, 'gold'],
    ['Point Events', totalChanges, 'total point changes recorded', ''],
  ];
  $('analyticsKPIs').innerHTML = kpis.map(([l, v, d, cls]) =>
    `<div class="kpi ${cls}"><div class="kpi-label">${l}</div><div class="kpi-value">${esc(String(v))}</div><div class="kpi-detail">${d}</div></div>`).join('');
}

function findTopGainer(hist) {
  const gains = {};
  hist.filter(h => h.delta > 0).forEach(h => { gains[h.cid] = (gains[h.cid] || 0) + h.delta; });
  let best = { cid: null, delta: 0 };
  for (const [cid, d] of Object.entries(gains)) if (d > best.delta) best = { cid: Number(cid), delta: d };
  const c = byId(best.cid);
  return { name: c ? c.name : '', delta: best.delta };
}

function renderATeams() {
  drawTeamChart();
  const activeTeams = [...new Set(active().map(c => c.team))];
  const teamData = activeTeams.map(t => {
    const members = active().filter(c => c.team === t);
    const total = members.reduce((a, c) => a + c.points, 0);
    const avg = Math.round(total / members.length);
    const top = members.sort((a, b) => b.points - a.points)[0];
    const tasks = state.tasks.filter(tk => tk.done && tk.assignee === 't:' + t).length;
    return { team: t, members: members.length, total, avg, top, tasks };
  }).sort((a, b) => b.total - a.total);

  const maxTotal = Math.max(1, ...teamData.map(t => t.total));
  $('teamCards').innerHTML = teamData.map((t, i) => `
    <div class="t-card">
      <div class="tc-rank" style="color:${teamColor(t.team)}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</div>
      <div class="tc-info">
        <div class="tc-name">${teamTag(t.team)} <span>${t.members} members</span></div>
        <div class="tc-meta">MVP: <strong>${esc(t.top.name)}</strong> (${t.top.points} pts) · ${t.tasks} tasks done</div>
        <div class="tc-bar"><div style="width:${(t.total / maxTotal) * 100}%;background:${teamColor(t.team)}"></div></div>
      </div>
      <div class="tc-stats">
        <div class="tc-stat">Total<b style="color:${teamColor(t.team)}">${t.total}</b></div>
        <div class="tc-stat">Avg<b>${t.avg}</b></div>
      </div>
    </div>`).join('');
}

function drawTeamChart() {
  const canvas = $('chartTeams');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.parentElement.clientWidth * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.parentElement.clientWidth, H = 200;
  ctx.clearRect(0, 0, W, H);

  const activeTeams = [...new Set(active().map(c => c.team))];
  const data = activeTeams.map(t => ({
    team: t,
    total: active().filter(c => c.team === t).reduce((a, c) => a + c.points, 0),
    avg: Math.round(active().filter(c => c.team === t).reduce((a, c) => a + c.points, 0) / active().filter(c => c.team === t).length),
  })).sort((a, b) => b.total - a.total);
  if (!data.length) return;

  const max = Math.max(1, ...data.map(d => d.total));
  const barW = Math.min(60, (W - 40) / data.length - 12);
  const gap = (W - 40) / data.length;

  data.forEach((d, i) => {
    const x = 30 + i * gap + (gap - barW) / 2;
    const h = (d.total / max) * (H - 50);
    const y = H - 24 - h;
    const col = teamColor(d.team);
    const grad = ctx.createLinearGradient(x, y, x, H - 24);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col + '33');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x, y, barW, h, [6, 6, 0, 0]); ctx.fill();

    ctx.fillStyle = '#e8e9f5';
    ctx.font = '600 12px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(d.total, x + barW / 2, y - 8);
    ctx.fillStyle = col;
    ctx.font = '600 11px Inter';
    ctx.fillText(d.team, x + barW / 2, H - 8);
  });
}

function renderAContestants() {
  const list = [...state.contestants].sort((a, b) => a.evicted - b.evicted || b.points - a.points);
  const hist = state.pointHistory || [];

  $('contestantAnalytics').innerHTML = list.map(c => {
    const cHist = hist.filter(h => h.cid === c.id).sort((a, b) => a.time - b.time);
    const gained = cHist.filter(h => h.delta > 0).reduce((a, h) => a + h.delta, 0);
    const lost = cHist.filter(h => h.delta < 0).reduce((a, h) => a + Math.abs(h.delta), 0);
    const tasksDone = state.tasks.filter(t => t.done && (t.assignee === 'c:' + c.id || (t.assignee.startsWith('t:') && t.assignee.slice(2) === c.team))).length;
    const rank = ranked().findIndex(r => r.id === c.id) + 1;
    const sparkId = 'spark-' + c.id;

    return `<div class="ca-card ${c.captain ? 'captain' : ''} ${c.evicted ? 'evicted' : ''}">
      <div class="ca-head">
        <div class="ca-name">${c.captain ? '👑 ' : ''}${esc(c.name)} ${teamTag(c.team)}</div>
        <div class="ca-pts">${c.points}</div>
      </div>
      <div>${badges(c)}</div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="cs-val" style="color:var(--green)">+${gained}</div><div class="cs-lab">Gained</div></div>
        <div class="ca-stat"><div class="cs-val" style="color:var(--red)">-${lost}</div><div class="cs-lab">Lost</div></div>
        <div class="ca-stat"><div class="cs-val">${tasksDone}</div><div class="cs-lab">Tasks</div></div>
      </div>
      <div class="ca-stats">
        <div class="ca-stat"><div class="cs-val">${cHist.length}</div><div class="cs-lab">Events</div></div>
        <div class="ca-stat"><div class="cs-val">${c.evicted ? '—' : '#' + (rank || '—')}</div><div class="cs-lab">Rank</div></div>
        <div class="ca-stat"><div class="cs-val">${c.immune ? '🛡' : c.nominated ? '🎯' : '—'}</div><div class="cs-lab">Status</div></div>
      </div>
      <canvas class="ca-sparkline" id="${sparkId}" height="36"></canvas>
    </div>`;
  }).join('');

  // Draw sparklines
  list.forEach(c => {
    const canvas = document.getElementById('spark-' + c.id);
    if (!canvas) return;
    drawSparkline(canvas, hist.filter(h => h.cid === c.id).sort((a, b) => a.time - b.time), c);
  });
}

function drawSparkline(canvas, points, c) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = 36 * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.clientWidth, H = 36;
  ctx.clearRect(0, 0, W, H);

  if (points.length < 2) {
    ctx.fillStyle = '#555'; ctx.font = '9px Inter'; ctx.textAlign = 'center';
    ctx.fillText('Not enough data', W / 2, H / 2 + 3);
    return;
  }

  const vals = points.map(p => p.pts);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = Math.max(1, mx - mn);
  const col = c.captain ? '#ffc940' : teamColor(c.team);

  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - 4 - ((p.pts - mn) / range) * (H - 8);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under
  const lastX = W, lastY = H - 4 - ((vals[vals.length - 1] - mn) / range) * (H - 8);
  ctx.lineTo(lastX, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = col + '18';
  ctx.fill();
  ctx.globalAlpha = 1;
}

function renderAInsights() {
  const list = ranked();
  const hist = state.pointHistory || [];
  const insights = [];

  // Leader analysis
  if (list.length >= 2) {
    const gap = list[0].points - list[1].points;
    if (gap > 200) insights.push({ icon: '🏆', text: `<strong>${esc(list[0].name)}</strong> leads by a massive <strong>${gap}</strong> points — dominating the house.`, cls: 'positive' });
    else if (gap > 0) insights.push({ icon: '🏆', text: `<strong>${esc(list[0].name)}</strong> leads <strong>${esc(list[1].name)}</strong> by just <strong>${gap}</strong> points — a close race.`, cls: 'warning' });
    else insights.push({ icon: '🤝', text: `<strong>${esc(list[0].name)}</strong> and <strong>${esc(list[1].name)}</strong> are tied at <strong>${list[0].points}</strong> points!`, cls: 'info' });
  }

  // Underdog
  if (list.length >= 3) {
    const last = list[list.length - 1];
    insights.push({ icon: '🐢', text: `<strong>${esc(last.name)}</strong> is in last place with <strong>${last.points}</strong> points — needs a big task win to climb.`, cls: 'warning' });
  }

  // Captain insight
  const cap = captain();
  if (cap) {
    const capRank = list.findIndex(c => c.id === cap.id) + 1;
    if (capRank === 1) insights.push({ icon: '👑', text: `Captain <strong>${esc(cap.name)}</strong> leads both in rank and authority — a dominant run.`, cls: 'positive' });
    else insights.push({ icon: '👑', text: `Captain <strong>${esc(cap.name)}</strong> is ranked #${capRank} — not the top scorer despite holding the crown.`, cls: 'info' });
  }

  // Team balance
  const activeTeams = [...new Set(active().map(c => c.team))];
  if (activeTeams.length >= 2) {
    const teamTotals = activeTeams.map(t => ({ team: t, total: active().filter(c => c.team === t).reduce((a, c) => a + c.points, 0) })).sort((a, b) => b.total - a.total);
    const diff = teamTotals[0].total - teamTotals[teamTotals.length - 1].total;
    if (diff > 400) insights.push({ icon: '⚖️', text: `Team <strong>${esc(teamTotals[0].team)}</strong> has <strong>${diff}</strong> more total points than Team <strong>${esc(teamTotals[teamTotals.length - 1].team)}</strong> — imbalanced house.`, cls: 'critical' });
    else insights.push({ icon: '⚖️', text: `Team scores are within <strong>${diff}</strong> points of each other — well balanced.`, cls: 'positive' });
  }

  // Nomination pressure
  const noms = active().filter(c => c.nominated);
  if (noms.length >= 3) insights.push({ icon: '🎯', text: `<strong>${noms.length}</strong> contestants are nominated — the Danger Zone is crowded. Expect a dramatic eviction.`, cls: 'critical' });
  else if (noms.length === 0) insights.push({ icon: '✅', text: 'No active nominations. The house is at peace... for now.', cls: 'positive' });

  // Immunity insight
  const immunes = active().filter(c => c.immune);
  if (immunes.length > 0) insights.push({ icon: '🛡', text: `<strong>${immunes.map(c => esc(c.name)).join(', ')}</strong> ${immunes.length === 1 ? 'is' : 'are'} immune — safe from nomination this round.`, cls: 'info' });

  // Top gainer
  const gainer = findTopGainer(hist);
  if (gainer.delta > 0) insights.push({ icon: '📈', text: `<strong>${esc(gainer.name)}</strong> has gained the most points overall: <strong>+${gainer.delta}</strong> total.`, cls: 'positive' });

  // Task efficiency
  const doneTasks = state.tasks.filter(t => t.done).length;
  const allTasks = state.tasks.length;
  if (allTasks > 0) {
    const rate = Math.round((doneTasks / allTasks) * 100);
    insights.push({ icon: '📋', text: `Task completion rate: <strong>${rate}%</strong> (${doneTasks}/${allTasks}). ${rate >= 75 ? 'Excellent productivity.' : rate >= 50 ? 'Room for improvement.' : 'Many tasks still pending.'}`, cls: rate >= 75 ? 'positive' : rate >= 50 ? 'info' : 'warning' });
  }

  // Eviction toll
  if (state.evictions.length > 0) {
    const totalLost = state.evictions.reduce((a, e) => a + e.points, 0);
    insights.push({ icon: '🚪', text: `<strong>${state.evictions.length}</strong> contestant${state.evictions.length > 1 ? 's' : ''} evicted so far, taking <strong>${totalLost}</strong> points out of the house.`, cls: 'critical' });
  }

  // Point volatility
  if (hist.length >= 5) {
    const recent = hist.slice(-10);
    const avgDelta = Math.round(recent.reduce((a, h) => a + Math.abs(h.delta), 0) / recent.length);
    insights.push({ icon: '🌊', text: `Average point swing in recent events: <strong>±${avgDelta}</strong> per change. ${avgDelta > 100 ? 'High volatility!' : 'Relatively stable.'}`, cls: avgDelta > 100 ? 'warning' : 'info' });
  }

  $('insightsList').innerHTML = insights.length ? insights.map(i =>
    `<div class="insight ${i.cls}"><div class="in-icon">${i.icon}</div><div class="in-text">${i.text}</div></div>`).join('') :
    '<div class="notif-empty">No insights available yet. Start playing the game!</div>';
}

function wireAnalyticsTabs() {
  document.querySelector('.analytics-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-atab]');
    if (!tab) return;
    activeATab = tab.dataset.atab;
    document.querySelectorAll('.analytics-tabs .chip').forEach(c => c.classList.toggle('active', c.dataset.atab === activeATab));
    document.querySelectorAll('.atab').forEach(t => t.hidden = t.id !== 'aTab-' + activeATab);
    renderAnalytics();
  });
}

/* ---------------- Boot ---------------- */
wire();
wireNotifications();
wireAnalyticsTabs();
announcePresence('hello');
$('timerMinutes').value = Math.round(state.timer.duration / 60);
render();
renderPresence();
// If this console owns a running timer (e.g. single tab), keep it ticking
if (state.timer.status === 'running') Timer.tick();
