(() => {
  'use strict';

  // ============ Constants ============
  const STORAGE_KEY = 'nosmoke_state';
  const GRADES = [
    { id: 'V1', max: 0,  label: 'Zi perfectă',   hex: '#1a4a2e' },
    { id: 'V2', max: 3,  label: 'Excelent',       hex: '#2d7a4a' },
    { id: 'V3', max: 6,  label: 'Bun',            hex: '#4a9e6a' },
    { id: 'V4', max: 9,  label: 'Acceptabil',     hex: '#7ab896' },
    { id: 'V5', max: 12, label: 'La limită',      hex: '#a8c87a' },
    { id: 'R1', max: 14, label: 'Puțin peste',    hex: '#c87a7a' },
    { id: 'R2', max: 16, label: 'Moderat peste',  hex: '#b85555' },
    { id: 'R3', max: 18, label: 'Rău',            hex: '#a03030' },
    { id: 'R4', max: 20, label: 'Foarte rău',     hex: '#7a1a1a' },
    { id: 'R5', max: Infinity, label: 'Cel mai rău', hex: '#3a0a0a' },
  ];
  const MONTHS       = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
  const MONTHS_SHORT = ['ian','feb','mar','apr','mai','iun','iul','aug','sep','oct','nov','dec'];

  // ============ State ============
  const defaultState = () => ({
    dayActive: false,
    dayStart: null,
    lastSmoke: null,
    cheatCount: 0,
    todayLog: [],
    history: {},
    settings: {
      intervalMinutes: 60,
      dailyLimit: 12,
      sleepTime: null,
      notifEnabled: false,
      notifFiveMin: false,
      notifWindowOpen: true,
      defaultType: 'ask',
    },
    selectedType: 'normal',
    sleepPromptKey: null,
  });

  let state;
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const p = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...p, settings: { ...d.settings, ...(p.settings || {}) }, history: p.history || {}, todayLog: p.todayLog || [] };
    } catch { return defaultState(); }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  // ============ Helpers ============
  const pad        = (n) => String(n).padStart(2, '0');
  const cigStr     = (n) => n === 1 ? 'țigară fumată' : 'țigări fumate';
  const dateKey    = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const fromKey    = (k) => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
  const formatHM   = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const $          = (s) => document.querySelector(s);
  const $$         = (s) => Array.from(document.querySelectorAll(s));
  const getGrade   = (n) => GRADES.find(g => n <= g.max);

  function todayDateLabel() {
    const d = new Date();
    return `${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
  }

  const QUOTES = [
    'Fiecare oră fără țigară e un pas spre libertate.',
    'Corpul tău se vindecă în fiecare zi în care alegi mai bine.',
    'Dependența spune că ai nevoie. Puterea ta spune că nu.',
    'Nu renunța la a renunța.',
    'Cel mai bun moment să oprești a fost ieri. Al doilea cel mai bun e acum.',
    'Dorința de a fuma durează câteva minute. Mândria durează toată ziua.',
    'Plămânii tăi îți mulțumesc în tăcere.',
    'Fiecare zi controlată e o zi câștigată.',
    'Nu ești dependent — ești mai puternic decât crezi.',
    'Streak-ul tău e dovada că poți.',
    'Gândește-te la cum vei respira peste un an.',
    'Rezistă acum, bucură-te mai târziu.',
    'Fiecare minut de așteptare e un minut pentru tine.',
    'Nu e vorba de voință — e vorba de alegeri mici, repetate.',
    'Corpul tău știe să se repare. Lasă-l.',
    'O țigară mai puțin azi e o zi mai mult mâine.',
    'Libertatea e de cealaltă parte a disconfortului.',
    'Dependența e zgomotoasă. Sănătatea e liniștită.',
    'Fiecare zi perfectă e posibilă.',
    'Respiră adânc. E gratuit și nu lasă urme.',
    'Progresul nu e liniar. Ține-o tot așa.',
    'Poți face asta. O zi odată.',
    'Fiecare timer completat e o dovadă de caracter.',
    'Nu te gândi la toată viața. Gândește-te la azi.',
    'Corpul tău e de partea ta.',
    'Fumatul e un obicei. Obiceiurile se schimbă.',
    'Fiecare decizie bună face următoarea mai ușoară.',
    'Nu e ușor. Nici nu trebuie să fie. Mergi mai departe.',
    'Ai mai mult control decât crezi.',
    'Azi e o zi pe care ți-o dăruiești ție.',
  ];

  function getDailyQuote() {
    const seed = dateKey().split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return QUOTES[seed % QUOTES.length];
  }

  // ============ Icon helper ============
  function ic(name, size = 20, cls = '') {
    return `<svg class="icon${cls ? ' ' + cls : ''}" style="width:${size}px;height:${size}px" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  }

  // ============ SW + Notifications ============
  let swReg = null;
  async function initSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      // Caching SW
      navigator.serviceWorker.register('sw.js').catch(() => {});
      // OneSignal SW (for push notifications)
      swReg = await navigator.serviceWorker.register('OneSignalSDKWorker.js');
      await navigator.serviceWorker.ready;
    } catch (e) { console.warn('SW init failed', e); }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function notifSupported() { return 'Notification' in window; }
  function notifGranted()   { return notifSupported() && Notification.permission === 'granted'; }

  async function requestNotifPerm() {
    if (!notifSupported()) return false;
    return new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      OneSignalDeferred.push(async function(OneSignal) {
        await OneSignal.Notifications.requestPermission();
        if (OneSignal.Notifications.permission === true) {
          state.settings.notifEnabled = true;
          saveState();
          updateNotifUI();
          renderSettings();
          checkPushConnection();
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  function checkPushConnection() {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(function(OneSignal) {
      const el = $('#pushConnectionStatus');
      if (!el) return;
      const hasId = OneSignal.User && OneSignal.User.PushSubscription && OneSignal.User.PushSubscription.id;
      el.style.display = hasId ? 'flex' : 'none';
    });
  }

  function postSW(msg) {
    if (!('serviceWorker' in navigator)) return;
    const c = navigator.serviceWorker.controller;
    if (c) c.postMessage(msg);
  }

  async function notifyNow(title, body, tag) {
    if (!state.settings.notifEnabled || !notifGranted()) return;
    try {
      if (swReg) {
        await swReg.showNotification(title, { body, tag: tag || 'nosmoke', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
        return;
      }
      new Notification(title, { body });
    } catch {}
  }

  function schedulePushViaCloudflare(title, body, dateObj) {
    if (!state.settings.notifEnabled) return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      const playerId = OneSignal.User.PushSubscription.id;
      if (!playerId) return;
      try {
        await fetch('https://nosmoke-push.alexandru-brasoveanu7.workers.dev/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, title, message: body, sendAfter: dateObj.toUTCString() }),
        });
      } catch (e) { console.warn('Push schedule failed', e); }
    });
  }

  function cancelAllNotifs() {
    postSW({ type: 'cancelAll' });
  }

  function rescheduleTimerNotifs() {
    cancelAllNotifs();
    if (!state.dayActive || !state.lastSmoke) return;
    const intervalMs = state.settings.intervalMinutes * 60 * 1000;
    const expireAt = new Date(state.lastSmoke + intervalMs);
    if (expireAt > new Date()) {
      schedulePushViaCloudflare('Poți fuma acum', 'Timerul e gata.', expireAt);
    }
    if (state.settings.notifFiveMin) {
      const fiveBefore = new Date(expireAt.getTime() - 5 * 60 * 1000);
      if (fiveBefore > new Date()) schedulePushViaCloudflare('Mai ai 5 minute', 'Timerul e aproape gata.', fiveBefore);
    }
    if (state.settings.notifWindowOpen) {
      const after15 = new Date(expireAt.getTime() + 15 * 60 * 1000);
      schedulePushViaCloudflare('Fereastra e deschisă', 'Mai ai timp — nu te grăbi.', after15);
    }
    scheduleSleepNotif();
  }

  function scheduleSleepNotif() {
    if (!state.dayActive) return;
    const t = state.settings.sleepTime;
    if (!t) return;
    const todayK = dateKey();
    if (state.sleepPromptKey === todayK) return;
    const [hh, mm] = t.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (target > now) {
      schedulePushViaCloudflare('E timpul de somn?', 'Obișnuiești să te culci acum. Vrei să închizi ziua?', target);
      state.sleepPromptKey = todayK;
      saveState();
    }
  }

  // ============ Screen routing ============
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // ============ Modal / Sheet ============
  function showModal(html) {
    $('#modalCard').innerHTML = html;
    $('#modalOverlay').classList.add('active');
  }
  function closeModal() {
    $('#modalOverlay').classList.remove('active');
  }
  function showSheet(html) {
    $('#sheetContent').innerHTML = `<div class="sheet-handle"></div>` + html;
    $('#sheetOverlay').classList.add('active');
  }
  function closeSheet() { $('#sheetOverlay').classList.remove('active'); }

  // ============ Notif banner UI ============
  function updateNotifUI() {
    const btn    = $('#enableNotifBtn');
    const banner = $('#iosBanner');
    const showBanner = isIOS() && !isStandalone();
    if (!notifSupported()) {
      btn.classList.add('hidden');
      banner.classList.toggle('hidden', !showBanner);
      return;
    }
    if (notifGranted() && state.settings.notifEnabled) {
      btn.classList.add('hidden');
      banner.classList.add('hidden');
    } else {
      btn.classList.remove('hidden');
      banner.classList.toggle('hidden', !showBanner);
    }
  }

  // ============ Day Inactive ============
  function renderDayInactive() {
    $('#greetingText').textContent = 'Salut, Alex!';
    $('#todayDate').textContent = todayDateLabel();
    $('#dailyQuote').textContent = `"${getDailyQuote()}"`;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yEntry = state.history[dateKey(y)];
    const ydCard = $('#yesterdayCard');
    if (yEntry && yEntry.sessions) {
      const count = yEntry.sessions.length;
      const grade = getGrade(count);
      $('#ydSwatch').style.background = grade.hex;
      $('#ydValue').textContent = `${count} ${cigStr(count)} • ${grade.label}`;
      ydCard.classList.remove('hidden');
    } else {
      ydCard.classList.add('hidden');
    }
    updateNotifUI();
  }

  // ============ Timer ============
  let timerInterval = null;
  function startTimerLoop() { stopTimerLoop(); updateTimer(); timerInterval = setInterval(updateTimer, 1000); }
  function stopTimerLoop()  { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

  const RING_R = 92;
  const RING_C = 2 * Math.PI * RING_R;

  function updateTimer() {
    const intervalMs = state.settings.intervalMinutes * 60 * 1000;
    const now        = Date.now();
    const ring       = $('#ringProgress');
    const cdEl       = $('#countdown');
    const ulEl       = $('#unlockTime');
    const smokeBtn   = $('#smokeBtn');

    let remaining = 0, progress = 1, ready = true;
    if (state.lastSmoke) {
      const expire = state.lastSmoke + intervalMs;
      remaining = expire - now;
      if (remaining > 0) { ready = false; progress = 1 - (remaining / intervalMs); }
      else { remaining = 0; progress = 1; }
    }

    const over = ready && !!state.lastSmoke;
    if (!ready) {
      const totalSec = Math.ceil(remaining / 1000);
      cdEl.textContent = `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
    } else if (over) {
      const elapsed = Math.floor((now - (state.lastSmoke + intervalMs)) / 1000);
      cdEl.textContent = `+${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`;
    } else {
      cdEl.textContent = '00:00';
    }

    ring.setAttribute('stroke-dashoffset', RING_C * (1 - progress));
    ring.classList.toggle('ready', ready);
    ring.classList.toggle('over', over);
    cdEl.classList.toggle('ready', ready);
    cdEl.classList.toggle('over', over);
    smokeBtn.classList.toggle('green', ready);

    if (state.lastSmoke && remaining > 0) {
      ulEl.textContent = `Poți fuma la ${formatHM(state.lastSmoke + intervalMs)}`;
    } else if (over) {
      ulEl.textContent = 'Fereastra e deschisă';
    } else {
      ulEl.textContent = 'Poți fuma acum';
    }

    $('#sessionCounter').textContent = `Azi: ${state.todayLog.length} ${cigStr(state.todayLog.length)}`;
  }

  function setSelectedType(t) {
    state.selectedType = t;
    $$('#typeSelector .type-btn').forEach(b => b.classList.toggle('selected', b.dataset.type === t));
    saveState();
  }
  function applyDefaultType() {
    const def = state.settings.defaultType;
    setSelectedType((def === 'normal' || def === 'iqos') ? def : (state.selectedType || 'normal'));
  }

  // ============ Day lifecycle ============
  function startDay() {
    state.dayActive = true;
    state.dayStart  = Date.now();
    state.lastSmoke = null;
    state.cheatCount = 0;
    state.todayLog  = [];
    state.sleepPromptKey = null;
    const k = dateKey();
    if (!state.history[k]) state.history[k] = { sessions: [], cheatCount: 0 };
    saveState();
    notifyNow('Ziua a început', 'Poți fuma acum.', 'startday');
    scheduleSleepNotif();
    enterDayActive();
  }

  function enterDayActive() {
    showScreen('dayActive');
    applyDefaultType();
    startTimerLoop();
    rescheduleTimerNotifs();
  }

  function logSession(type) {
    const now = Date.now();
    state.todayLog.push({ time: now, type });
    state.lastSmoke = now;
    const k = dateKey();
    if (!state.history[k]) state.history[k] = { sessions: [], cheatCount: 0 };
    state.history[k].sessions   = [...state.todayLog];
    state.history[k].cheatCount = state.cheatCount;
    saveState();
    updateTimer();
    rescheduleTimerNotifs();
  }

  function isTimerRunning() {
    if (!state.lastSmoke) return false;
    return Date.now() < state.lastSmoke + state.settings.intervalMinutes * 60 * 1000;
  }

  function onSmokePressed() {
    const type = state.selectedType || 'normal';
    if (!isTimerRunning()) { logSession(type); return; }

    const remainingMin = Math.ceil((state.lastSmoke + state.settings.intervalMinutes * 60 * 1000 - Date.now()) / 60000);
    const idx = state.cheatCount;

    if (idx === 0) {
      showModal(`
        <h2>${ic('alert', 22, 'warn')} Mai ai ${remainingMin} min</h2>
        <p>Dacă fumezi acum, timerul se resetează de la zero.<br>Ești sigur?</p>
        <div class="modal-actions row">
          <button class="btn ghost" id="cancelCheat">Anulează</button>
          <button class="btn red" id="confirmCheat">Da, am fumat</button>
        </div>`);
    } else {
      showModal(`
        <h2>${ic('alert-filled', 22, 'danger')} ${idx === 1 ? 'A doua' : 'Încă o'} țigară înainte de termen</h2>
        <p>Ești pe un drum greșit azi.<br>Timerul se resetează.</p>
        <div class="modal-actions">
          <button class="btn red" id="confirmCheat">Am fumat, știu</button>
        </div>`);
    }
    document.getElementById('confirmCheat')?.addEventListener('click', () => { closeModal(); commitCheat(type); });
    document.getElementById('cancelCheat')?.addEventListener('click', closeModal);
  }

  function commitCheat(type) {
    state.cheatCount += 1;
    const k = dateKey();
    if (!state.history[k]) state.history[k] = { sessions: [], cheatCount: 0 };
    state.history[k].cheatCount = state.cheatCount;
    logSession(type);
  }

  function endDay(silent = false) {
    const k = state.dayStart ? dateKey(new Date(state.dayStart)) : dateKey();
    if (!state.history[k]) state.history[k] = { sessions: [], cheatCount: 0 };
    state.history[k].sessions   = [...state.todayLog];
    state.history[k].cheatCount = state.cheatCount;
    const count = state.todayLog.length;
    const grade = getGrade(count);
    state.dayActive = false; state.dayStart = null; state.lastSmoke = null;
    state.cheatCount = 0; state.todayLog = []; state.sleepPromptKey = null;
    saveState();
    cancelAllNotifs();
    stopTimerLoop();
    showScreen('dayInactive');
    renderDayInactive();
    if (!silent) {
      notifyNow('Noapte bună', `Azi: ${count} ${cigStr(count)}.`, 'endday');
      showModal(`
        <div class="modal-icon-banner green">${ic('check', 28)}</div>
        <h2>Ziua s-a încheiat</h2>
        <p><strong>${count} ${cigStr(count)}</strong> azi.<br>
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${grade.hex};vertical-align:middle;margin-right:4px"></span>${grade.label}</p>
        <div class="modal-actions">
          <button class="btn accent" id="closeSummary">Închide</button>
        </div>`);
      document.getElementById('closeSummary').addEventListener('click', closeModal);
    }
  }

  function confirmEndDay() {
    showModal(`
      <div class="modal-icon-banner">${ic('moon', 28)}</div>
      <h2>Închide ziua?</h2>
      <p>Vei vedea un rezumat și vei reveni la ecranul principal.</p>
      <div class="modal-actions row">
        <button class="btn ghost" id="cancelEnd">Anulează</button>
        <button class="btn accent" id="confirmEnd">Da, închide</button>
      </div>`);
    document.getElementById('cancelEnd').addEventListener('click', closeModal);
    document.getElementById('confirmEnd').addEventListener('click', () => { closeModal(); endDay(false); });
  }

  // ============ Calendar ============
  let calCursor = new Date(); calCursor.setDate(1);

  function renderCalendar() {
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    $('#calTitle').textContent = `${MONTHS[m]} ${y}`;
    const grid = $('#calGrid');
    grid.innerHTML = '';
    const startDow   = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayK     = dateKey();

    for (let i = 0; i < startDow; i++) {
      const c = document.createElement('div'); c.className = 'cal-cell empty'; grid.appendChild(c);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const k    = `${y}-${pad(m+1)}-${pad(day)}`;
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      const entry = state.history[k];
      if (entry) {
        const count = entry.sessions.length;
        const grade = getGrade(count);
        cell.style.background = grade.hex;
        cell.classList.add('has-data');
        cell.innerHTML = `<span class="cell-num">${day}</span>${count > 0 ? `<span class="cell-label">${count}</span>` : ''}`;
        if (entry.cheatCount > 2) {
          const mark = document.createElement('div');
          mark.className = 'cheat-mark';
          mark.innerHTML = ic('alert', 12);
          cell.appendChild(mark);
        }
        cell.addEventListener('click', () => openDaySheet(k));
      } else {
        cell.innerHTML = `<span class="cell-num" style="color:var(--text-mute)">${day}</span>`;
      }
      if (k === todayK) cell.classList.add('today');
      grid.appendChild(cell);
    }
    renderStats();
  }

  function openDaySheet(k) {
    const entry = state.history[k];
    if (!entry) return;
    const d      = fromKey(k);
    const lbl    = `${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
    const count  = entry.sessions.length;
    const grade  = getGrade(count);
    const cheatPill = entry.cheatCount > 2
      ? `<span class="cheat-pill">${ic('alert', 12)} ${entry.cheatCount} avertismente</span>`
      : '';
    const sessHtml = count === 0
      ? `<div class="session-empty">${ic('check', 28)}<span>Nicio țigară — zi perfectă</span></div>`
      : entry.sessions.map(s => `
          <div class="session-item">
            <div class="si-icon">${ic(s.type === 'iqos' ? 'iqos' : 'cigarette', 16)}</div>
            <span class="si-time">${formatHM(s.time)}</span>
            <span class="si-type">${s.type === 'iqos' ? 'IQOS' : 'Normală'}</span>
          </div>`).join('');
    showSheet(`
      <h3>${ic('calendar', 18)} ${lbl}</h3>
      <div class="sheet-grade">
        <span class="grade-dot" style="background:${grade.hex}"></span>
        ${count} ${cigStr(count)} • ${grade.label}
        ${cheatPill}
      </div>
      <div class="session-list">${sessHtml}</div>`);
  }

  // ============ Stats ============
  function renderStats() {
    const limit = state.settings.dailyLimit;
    const keys  = Object.keys(state.history).sort();
    const today = dateKey();

    let cursor = new Date();
    if (state.dayActive) { cursor.setDate(cursor.getDate() - 1); }
    cursor.setHours(0,0,0,0);
    let streak = 0;
    while (true) {
      const e = state.history[dateKey(cursor)];
      if (!e || e.sessions.length > limit) break;
      streak++; cursor.setDate(cursor.getDate() - 1);
    }

    let best = 0, run = 0;
    if (keys.length) {
      const it = fromKey(keys[0]), end = fromKey(keys[keys.length - 1]);
      while (it <= end) {
        const e = state.history[dateKey(it)];
        if (e && e.sessions.length <= limit) { run++; if (run > best) best = run; } else run = 0;
        it.setDate(it.getDate() + 1);
      }
    }

    let sum = 0, days = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const e = state.history[dateKey(d)];
      if (e) { sum += e.sessions.length; days++; }
    }

    let nN = 0, nI = 0;
    for (const k of keys) for (const s of state.history[k].sessions) { if (s.type === 'iqos') nI++; else nN++; }
    const total = nN + nI;

    const cy = calCursor.getFullYear(), cm = calCursor.getMonth();
    let bestKey = null, bestCount = Infinity;
    for (const k of keys) {
      const d = fromKey(k);
      if (d.getFullYear() !== cy || d.getMonth() !== cm || (k === today && state.dayActive)) continue;
      const c = state.history[k].sessions.length;
      if (c < bestCount) { bestCount = c; bestKey = k; }
    }

    $('#statStreak').textContent  = `${streak} ${streak === 1 ? 'zi' : 'zile'}`;
    $('#statBest').textContent    = `${best} ${best === 1 ? 'zi' : 'zile'}`;
    $('#statAvg').textContent     = days ? (sum / days).toFixed(1) : '—';
    $('#statSplit').textContent   = total === 0 ? '—' : `${Math.round(nN/total*100)}% / ${Math.round(nI/total*100)}%`;
    $('#statBestDay').textContent = bestKey ? `${fromKey(bestKey).getDate()} ${MONTHS_SHORT[fromKey(bestKey).getMonth()]} • ${bestCount}` : '—';
  }

  // ============ Settings ============
  function renderSettings() {
    $$('.toggle').forEach(t => t.classList.toggle('on', !!state.settings[t.dataset.setting]));
    $$('.segmented').forEach(seg => {
      const isNum = seg.dataset.type === 'number';
      const val   = state.settings[seg.dataset.setting];
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('selected', (isNum ? Number(b.dataset.value) : b.dataset.value) === val));
    });
    $('#sleepTimeInput').value = state.settings.sleepTime || '';
    checkPushConnection();
  }

  function bindSettings() {
    $$('.toggle').forEach(t => t.addEventListener('click', async () => {
      const k = t.dataset.setting;
      const newVal = !state.settings[k];
      if (k === 'notifEnabled' && newVal && !notifGranted()) {
        const ok = await requestNotifPerm();
        if (!ok) return;
      }
      state.settings[k] = newVal;
      saveState(); renderSettings();
      if (['notifEnabled','notifFiveMin','notifWindowOpen'].includes(k)) {
        if (state.dayActive) rescheduleTimerNotifs();
        updateNotifUI();
      }
    }));

    $$('.segmented').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const k = seg.dataset.setting;
      const v = seg.dataset.type === 'number' ? Number(b.dataset.value) : b.dataset.value;
      state.settings[k] = v; saveState(); renderSettings();
      if (k === 'intervalMinutes' && state.dayActive) { updateTimer(); rescheduleTimerNotifs(); }
    })));

    $('#sleepTimeInput').addEventListener('change', (e) => {
      state.settings.sleepTime = e.target.value || null;
      saveState(); if (state.dayActive) rescheduleTimerNotifs();
    });
    $('#exportBtn').addEventListener('click', exportCSV);
    $('#resetTodayBtn').addEventListener('click', confirmResetToday);
    $('#deleteAllBtn').addEventListener('click', confirmDeleteAll);
    $('#clearCacheBtn').addEventListener('click', confirmClearCache);
  }

  function exportCSV() {
    const rows = [['date','time','type','cheat']];
    for (const k of Object.keys(state.history).sort()) {
      const e = state.history[k];
      for (const s of e.sessions) {
        const d = new Date(s.time);
        rows.push([k, `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, s.type, '']);
      }
      if (e.cheatCount > 0) rows.push([k, '', 'cheat_count', String(e.cheatCount)]);
    }
    const csv  = rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g,'""')}"` : c).join(',')).join('\n');
    const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a    = Object.assign(document.createElement('a'), { href: url, download: `nosmoke-${dateKey()}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function confirmResetToday() {
    showModal(`
      <div class="modal-icon-banner warn">${ic('refresh', 28)}</div>
      <h2>Resetează ziua de azi?</h2>
      <p>Toate țigările înregistrate azi vor fi șterse. Acțiune ireversibilă.</p>
      <div class="modal-actions row">
        <button class="btn ghost" id="cancelRT">Anulează</button>
        <button class="btn red" id="okRT">Resetează</button>
      </div>`);
    document.getElementById('cancelRT').addEventListener('click', closeModal);
    document.getElementById('okRT').addEventListener('click', () => {
      state.todayLog = []; state.lastSmoke = null; state.cheatCount = 0;
      const k = dateKey();
      delete state.history[k];
      if (state.dayActive) state.history[k] = { sessions: [], cheatCount: 0 };
      saveState(); cancelAllNotifs();
      if (state.dayActive) updateTimer();
      closeModal();
    });
  }

  function confirmDeleteAll() {
    showModal(`
      <div class="modal-icon-banner danger">${ic('trash', 28)}</div>
      <h2>Șterge tot istoricul</h2>
      <p>Tastează <strong>STERGE</strong> ca să confirmi. Acțiune ireversibilă.</p>
      <input type="text" id="confirmInput" placeholder="STERGE" autocomplete="off" autocapitalize="characters" style="margin-bottom:14px">
      <div class="modal-actions row">
        <button class="btn ghost" id="cancelDA">Anulează</button>
        <button class="btn red" id="okDA" disabled>Șterge tot</button>
      </div>`);
    const input = document.getElementById('confirmInput');
    const ok    = document.getElementById('okDA');
    input.addEventListener('input', () => ok.toggleAttribute('disabled', input.value.trim() !== 'STERGE'));
    document.getElementById('cancelDA').addEventListener('click', closeModal);
    ok.addEventListener('click', () => {
      const settings = state.settings;
      state = defaultState(); state.settings = settings;
      saveState(); cancelAllNotifs(); stopTimerLoop();
      closeModal(); showScreen('dayInactive'); renderDayInactive(); renderSettings();
    });
  }

  function confirmClearCache() {
    showModal(`
      <div class="modal-icon-banner danger">${ic('x', 28)}</div>
      <h2>Curăță Cache?</h2>
      <p>Aplicația se va reseta forțat și se va reîncărca. Istoricul nu se pierde.</p>
      <div class="modal-actions row">
        <button class="btn ghost" id="cancelCC">Anulează</button>
        <button class="btn red" id="okCC">Curăță acum</button>
      </div>`);
    document.getElementById('cancelCC').addEventListener('click', closeModal);
    document.getElementById('okCC').addEventListener('click', async () => {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        for (const r of regs) await r.unregister().catch(() => {});
      }
      const cacheKeys = await caches.keys().catch(() => []);
      for (const k of cacheKeys) await caches.delete(k).catch(() => {});
      window.location.reload(true);
    });
  }

  // ============ Swipe ============
  function attachSwipe(el, onLeft, onRight) {
    let sx = 0, sy = 0, t0 = 0;
    el.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - t0;
      if (dt > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (dx < 0) onLeft?.(); else onRight?.();
    }, { passive: true });
  }

  // ============ Init ============
  function init() {
    state = loadState();

    // Auto-close stale day
    if (state.dayActive && state.dayStart) {
      const k = dateKey(new Date(state.dayStart));
      if (k !== dateKey()) {
        if (!state.history[k]) state.history[k] = { sessions: [], cheatCount: 0 };
        state.history[k].sessions   = [...state.todayLog];
        state.history[k].cheatCount = state.cheatCount;
        Object.assign(state, { dayActive: false, dayStart: null, lastSmoke: null, cheatCount: 0, todayLog: [], sleepPromptKey: null });
        saveState();
      }
    }

    // Set ring dasharray
    $('#ringProgress').setAttribute('stroke-dasharray', RING_C);

    // Splash → correct screen
    setTimeout(() => {
      if (state.dayActive) enterDayActive();
      else { showScreen('dayInactive'); renderDayInactive(); }
    }, 1100);

    // Day Inactive
    $('#startDayBtn').addEventListener('click', startDay);
    $('#calendarLink').addEventListener('click', (e) => {
      e.preventDefault(); calCursor = new Date(); calCursor.setDate(1); renderCalendar(); showScreen('calendar');
    });
    $('#settingsBtn').addEventListener('click', () => { renderSettings(); showScreen('settings'); });
    $('#enableNotifBtn').addEventListener('click', requestNotifPerm);

    // Day Active
    $('#calendarBtnActive').addEventListener('click', () => { calCursor = new Date(); calCursor.setDate(1); renderCalendar(); showScreen('calendar'); });
    $('#settingsBtnActive').addEventListener('click', () => { renderSettings(); showScreen('settings'); });
    $$('#typeSelector .type-btn').forEach(b => b.addEventListener('click', () => setSelectedType(b.dataset.type)));
    $('#smokeBtn').addEventListener('click', onSmokePressed);
    $('#endDayLink').addEventListener('click', (e) => { e.preventDefault(); confirmEndDay(); });
    attachSwipe($('#dayActive'), () => { calCursor = new Date(); calCursor.setDate(1); renderCalendar(); showScreen('calendar'); }, null);

    // Calendar
    $('#calBack').addEventListener('click', () => { state.dayActive ? enterDayActive() : (showScreen('dayInactive'), renderDayInactive()); });
    $('#calPrev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
    $('#calNext').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
    attachSwipe($('#calendar'),
      () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); },
      () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); }
    );

    // Settings
    $('#settingsBack').addEventListener('click', () => { state.dayActive ? enterDayActive() : (showScreen('dayInactive'), renderDayInactive()); });
    bindSettings();

    // Sheet click-out
    $('#sheetOverlay').addEventListener('click', (e) => { if (e.target.id === 'sheetOverlay') closeSheet(); });
    $('#modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });

    // SW + notifs
    initSW();
    updateNotifUI();

    // Visibility change — refresh on resume
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (state.dayActive && state.dayStart && dateKey(new Date(state.dayStart)) !== dateKey()) {
        endDay(true); return;
      }
      if (state.dayActive) updateTimer();
      else if ($('#dayInactive').classList.contains('active')) renderDayInactive();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
