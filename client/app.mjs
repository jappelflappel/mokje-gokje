import QRCode from 'qrcode';
import { GAME_SERVER } from './config.mjs';
import { djView, errorView, guestView, h, hostView, takenGaps, teamView } from './view.mjs';

const root = document.getElementById('app');
const popup = document.getElementById('dialog');
const notice = document.getElementById('notice');
const home = new URL('.', location.href);
const api = location.hostname === 'jappelflappel.github.io' ? GAME_SERVER : '';
const codePattern = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/u;
const tokenPattern = /^[a-f0-9]{40}$/u;
const blankDj = () => ({ title: '', artist: '', year: '', link: '' });
const blankMug = () => ({ open: false, teams: null, rolling: false, winner: null, angle: 0, from: 0, startedAt: 0 });
const ui = { recover: false, entryError: '', entryValue: '', setup: null, dj: blankDj(), gap: null, bonus: false, mug: blankMug() };

let state = null;
let revision = 0;
let role = 'host';
let code = '';
let token = '';
let lastRound = null;
let busy = false;
let refreshing = false;
let poll = 0;
let noticeTimer = 0;
let mugTimer = 0;
let offline = false;
let roomUnavailable = false;

const key = (part, room = '') => 'terugspoel:' + part + ':' + room;

function remembered(part, room = '') {
  try {
    const storage = part === 'dj' ? sessionStorage : localStorage;
    return storage.getItem(key(part, room)) || '';
  } catch {
    return '';
  }
}

function remember(part, room, value) {
  try {
    const storage = part === 'dj' ? sessionStorage : localStorage;
    if (value) storage.setItem(key(part, room), value);
    else storage.removeItem(key(part, room));
  } catch {
    // A browser with blocked storage can still play until the page closes.
  }
}

function operation() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { credential = '', data, create = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(api + '/api/rooms' + (path ? '/' + path : ''), {
      method: data || create ? 'POST' : 'GET',
      credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: {
        ...(credential ? { authorization: 'Bearer ' + credential } : {}),
        ...(data ? { 'content-type': 'application/json' } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.state) {
      throw new RequestError(response.status, result.error || 'Het spel is even onbereikbaar.');
    }
    return result;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(0, 'Verbinding verbroken. Controleer je internetverbinding.');
  } finally {
    clearTimeout(timeout);
  }
}

function roomURL(mode, room, secret = '') {
  const url = new URL(home);
  url.searchParams.set(mode, room);
  if (secret) url.hash = secret;
  return url.href;
}

function urls() {
  return { join: roomURL('join', code), dj: roomURL('dj', code, state?.djToken) };
}

function readFocus() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !root.contains(element)) return null;
  const selector = element.id ? '#' + CSS.escape(element.id)
    : (element.dataset.gap !== undefined ? '[data-gap="' + element.dataset.gap + '"]'
      : (element.dataset.action ? '[data-action="' + element.dataset.action + '"]' : null));
  if (!selector) return null;
  return { selector, start: element.selectionStart, end: element.selectionEnd };
}

function restoreFocus(focus) {
  if (!focus) return;
  const element = root.querySelector(focus.selector);
  if (!element || element.disabled) return;
  element.focus({ preventScroll: true });
  if (focus.start != null && element.setSelectionRange) element.setSelectionRange(focus.start, focus.end);
}

function render() {
  const focus = readFocus();
  const qr = document.getElementById('room-qr');
  const horizontal = root.querySelector('.timeline.horizontal')?.scrollLeft ?? 0;
  if (role === 'host' && state?.role === 'host') root.innerHTML = hostView(state, urls(), ui);
  else if (role === 'dj' && state?.role === 'dj') root.innerHTML = djView(state, ui);
  else if (role === 'team' && state?.role === 'team') root.innerHTML = teamView(state, ui);
  else if (role === 'team') root.innerHTML = guestView(state, ui);

  const canvas = document.getElementById('room-qr');
  if (canvas) {
    if (qr?.dataset.url === canvas.dataset.url) canvas.replaceWith(qr);
    else QRCode.toCanvas(canvas, canvas.dataset.url, {
      errorCorrectionLevel: 'M', margin: 4, scale: 7, color: { dark: '#171c27', light: '#ffffff' }
    }).catch(() => notify('De QR-code kon niet worden getekend. Gebruik de deelnamelink.', true));
  }
  const timeline = root.querySelector('.timeline.horizontal');
  if (timeline) timeline.scrollLeft = horizontal;
  restoreFocus(focus);
}

function closeMug() {
  clearTimeout(mugTimer);
  ui.mug = blankMug();
}

function toggleMug() {
  if (ui.mug.open) {
    closeMug();
    render();
    root.querySelector('.mug-toggle')?.focus({ preventScroll: true });
    return;
  }
  ui.mug.open = true;
  render();
  root.querySelector('[data-tool="mug-spin"]:enabled, [data-tool="mug-close"]')?.focus({ preventScroll: true });
}

function spinMug() {
  const mug = ui.mug;
  if (state?.role !== 'host' || !mug.open || mug.rolling || !state.teams.length) return;

  const teams = state.teams.slice();
  const index = Math.floor(Math.random() * teams.length);
  const target = index * 360 / teams.length;
  mug.from = mug.angle;
  mug.angle = mug.from + 5 * 360 + (target - mug.from + 360) % 360;
  mug.teams = teams;
  mug.rolling = true;
  mug.winner = null;
  mug.startedAt = performance.now();
  render();

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  mugTimer = setTimeout(() => {
    mug.angle = target;
    mug.winner = teams[index];
    mug.rolling = false;
    render();
  }, reducedMotion ? 20 : 3060);
}

function useResult(result) {
  if (result.revision < revision) return;
  const changed = result.revision !== revision || result.state.role !== state?.role;
  revision = result.revision;
  state = result.state;
  const round = state.round?.id ?? null;
  if (lastRound !== round) {
    ui.gap = null;
    ui.bonus = false;
    ui.dj = blankDj();
  }
  lastRound = round;
  if (state.phase === 'steal' && ui.gap !== null && takenGaps(state).has(ui.gap)) {
    ui.gap = null;
  }
  if (changed) render();
}

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.toggleAttribute('data-error', error);
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function showError(error, mode = '') {
  root.innerHTML = errorView(
    mode === 'stale-host' ? 'Spel niet gevonden' : 'Even geen verbinding',
    error.message,
    mode
  );
}

async function refresh() {
  if (!code || refreshing || busy || (!token && state)) return;
  const room = code;
  const credential = token;
  refreshing = true;
  try {
    const result = await request(room, { credential });
    if (room !== code || credential !== token) return;
    roomUnavailable = false;
    if (offline) notify('Weer verbonden.');
    offline = false;
    useResult(result);
  } catch (error) {
    if (room !== code || credential !== token) return;
    if (error.status === 401 && role === 'team' && token) {
      remember('team', code, '');
      token = '';
      revision = 0;
      state = null;
      ui.recover = true;
      ui.entryError = 'Gebruik je teamcode om dit team opnieuw te openen.';
      try {
        useResult(await request(code));
      } catch (error) {
        showError(error);
      }
    } else if (!state || [401, 404].includes(error.status)) {
      roomUnavailable = [401, 404].includes(error.status);
      clearTimeout(poll);
      state = null;
      revision = 0;
      showError(error, error.status === 404 && role === 'host' ? 'stale-host' : '');
    } else if (!offline) {
      offline = true;
      notify('Verbinding verbroken. We proberen opnieuw te verbinden.', true);
    }
  } finally {
    refreshing = false;
  }
}

function schedule() {
  clearTimeout(poll);
  if (!token || document.hidden || roomUnavailable) return;
  const interval = state?.phase === 'finished' ? 5500 : (offline ? 3500 : 1450);
  poll = setTimeout(async () => {
    await refresh();
    schedule();
  }, interval);
}

async function createRoom() {
  if (busy) return;
  busy = true;
  clearTimeout(poll);
  try {
    const result = await request('', { create: true });
    code = result.state.code;
    token = result.token;
    role = 'host';
    roomUnavailable = false;
    state = null;
    revision = 0;
    ui.setup = null;
    ui.bonus = false;
    closeMug();
    remember('host', code, token);
    remember('last-host', '', code);
    history.replaceState(null, '', roomURL('host', code));
    useResult(result);
  } catch (error) {
    if (state) notify(error.message, true);
    else showError(error);
  } finally {
    busy = false;
    schedule();
  }
}

async function openRoute() {
  const params = new URLSearchParams(location.search);
  if (params.has('join')) {
    role = 'team';
    code = params.get('join').trim().toUpperCase();
    if (!code) { render(); return; }
    if (!codePattern.test(code)) {
      ui.entryError = 'Die spelcode klopt niet.';
      code = '';
      render();
      return;
    }
    token = remembered('team', code);
  } else if (params.has('dj')) {
    role = 'dj';
    code = params.get('dj').trim().toUpperCase();
    const passed = location.hash.slice(1);
    token = tokenPattern.test(passed) ? passed : remembered('dj', code);
    if (token) remember('dj', code, token);
    history.replaceState(null, '', roomURL('dj', code));
    if (!token || !codePattern.test(code)) {
      showError(new RequestError(401, 'Open de privé-DJ-link opnieuw vanuit het hostscherm.'));
      return;
    }
  } else {
    code = (params.get('host') || remembered('last-host')).trim().toUpperCase();
    token = remembered('host', code);
    if (!token || !codePattern.test(code)) { await createRoom(); return; }
    history.replaceState(null, '', roomURL('host', code));
  }
  await refresh();
  schedule();
}

async function move(action, inputs = {}) {
  if (busy || !state || !token) return;
  busy = true;
  const data = { action, operation: operation(), round: state.round?.id, ...inputs };
  const room = code;
  const credential = token;
  try {
    useResult(await request(room, { credential, data }));
  } catch (error) {
    if (error.status === 0) {
      try {
        useResult(await request(room, { credential, data }));
        return;
      } catch (retryError) {
        error = retryError;
      }
    }
    notify(error.message, true);
  } finally {
    busy = false;
    schedule();
  }
}

async function join(form) {
  if (busy || !code) return;
  busy = true;
  const data = Object.fromEntries(new FormData(form));
  ui.entryValue = data.name ?? data.recovery ?? '';
  let joinKey = remembered('join-key', code);
  if (!joinKey) {
    joinKey = operation();
    remember('join-key', code, joinKey);
  }
  try {
    const result = await request(code, { data: { action: 'join', joinKey, ...data } });
    token = result.token;
    remember('team', code, token);
    revision = 0;
    ui.entryError = '';
    useResult(result);
  } catch (error) {
    ui.entryError = error.message;
    if (error.status === 409) {
      try {
        const latest = await request(code);
        state = latest.state;
        if (state.phase !== 'lobby') ui.entryValue = '';
      } catch {
        // Keep the form available if the status cannot be refreshed.
      }
    }
    render();
  } finally {
    busy = false;
    schedule();
  }
}

async function copy(value, message) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      (popup.open ? popup : document.body).append(input);
      input.select();
      const success = document.execCommand('copy');
      input.remove();
      if (!success) throw new Error();
    }
    notify(message);
  } catch {
    showDialog('Kopieer de link', `<label class="field">Link of code<input type="text" readonly value="${h(value)}"></label>`);
    popup.querySelector('input').select();
  }
}

function showDialog(title, content) {
  popup.innerHTML = `<div class="dialog-top"><h2 id="dialog-title">${h(title)}</h2>
    <form method="dialog"><button type="submit" class="button soft">Sluit</button></form></div>
    <div class="dialog-content">${content}</div>`;
  if (!popup.open) popup.showModal();
}

function manage() {
  const rows = state.teams.map(team => {
    const recovery = state.recoveries.find(item => item.id === team.id).recovery;
    return `<div class="manage-row"><b>${h(team.name)}</b><span class="room-code">${h(recovery)}</span>
      ${state.phase === 'lobby' ? `<button class="button soft" type="button" data-remove="${h(team.id)}" aria-label="${h(team.name)} verwijderen">Verwijder</button>` : ''}</div>`;
  }).join('');
  showDialog('Spelbeheer', `<div class="dialog-actions">
    <a class="button primary" href="${h(urls().dj)}" target="_blank" rel="noopener noreferrer">Open DJ-scherm</a>
    <button class="button soft" type="button" data-tool="copy-dj">Kopieer privé-DJ-link</button>
  </div><p>Open deze link op het apparaat waarmee de DJ Spotify bedient. Deze weergave toont de antwoorden.</p>
  ${rows ? `<div><b>Teamcodes om te hervatten</b>${rows}</div>` : ''}
  <div class="dialog-actions">
    <button class="button soft" type="button" data-tool="new">Nieuw spel</button>
    ${['ready', 'result'].includes(state.phase)
      ? '<button class="button soft" type="button" data-tool="end">Bekijk eindstand</button>' : ''}
  </div>`);
}

function help() {
  showDialog('Zo speel je Terugspoel', `<ol>
    <li><b>Sluit aan.</b> Scan de QR-code met één telefoon per team. Ieder team begint met één kaart en twee munten.</li>
    <li><b>Luister.</b> De DJ speelt het nummer in Spotify. Gebruik de Terugspoel-mix of voeg in de lobby een eigen Spotify-playlist toe.</li>
    <li><b>Plaats.</b> Het team dat aan de beurt is, kiest waar het nummer chronologisch hoort. Een gelijk jaar mag aan beide kanten.</li>
    <li><b>Steel.</b> Andere teams kunnen één munt inzetten voor een vrij vak op dezelfde tijdlijn. Alleen als de eerste plaatsing fout is, kan een goede steelpoging de kaart winnen.</li>
    <li><b>Onthul.</b> De host bepaalt of het spelende team een bonusmunt krijgt. Het eerste team dat het ingestelde kaartdoel haalt, wint.</li>
  </ol>`);
}

function recovery() {
  showDialog('Hervat dit team', `<p>Scan opnieuw de deelname-QR en kies aanmelden met een teamcode om jullie kaarten op een andere telefoon terug te halen.</p>
    <strong class="room-code">${h(state.self.recovery)}</strong>
    <button class="button soft" type="button" data-tool="copy-recovery">Kopieer teamcode</button>`);
}

function start() {
  const form = document.getElementById('setup-form');
  if (!form?.reportValidity()) return;
  const values = new FormData(form);
  const settings = { deck: values.get('deck'), target: Number(values.get('target')), playlist: values.get('playlist') ?? '' };
  if (settings.deck === 'playlist' && !settings.playlist.trim()) {
    notify('Plak eerst de link naar je Spotify-playlist.', true);
    document.getElementById('playlist')?.focus();
    return;
  }
  move('start', { settings });
}

document.addEventListener('click', event => {
  const nextTrack = event.target.closest('a[data-next-track]');
  if (nextTrack) {
    if (busy) event.preventDefault();
    else move('next', { candidate: nextTrack.dataset.nextTrack });
    return;
  }
  const clicked = event.target.closest('button');
  if (!clicked || clicked.disabled) return;
  if (clicked.dataset.gap !== undefined && !busy) {
    ui.gap = Number(clicked.dataset.gap);
    render();
    return;
  }
  if (clicked.dataset.remove) {
    popup.close();
    move('remove', { teamId: clicked.dataset.remove });
    return;
  }
  const action = clicked.dataset.action;
  if (action === 'start') { start(); return; }
  if (action) {
    const data = action === 'reveal' ? { bonus: ui.bonus }
      : (['place', 'steal'].includes(action) ? { gap: ui.gap } : {});
    move(action, data);
    return;
  }
  switch (clicked.dataset.tool) {
    case 'mug-toggle':
    case 'mug-close': toggleMug(); break;
    case 'mug-spin': spinMug(); break;
    case 'help': help(); break;
    case 'manage': manage(); break;
    case 'recovery': recovery(); break;
    case 'copy-join': copy(urls().join, 'Deelnamelink gekopieerd.'); break;
    case 'copy-dj': copy(urls().dj, 'Privé-DJ-link gekopieerd.'); break;
    case 'copy-recovery': copy(state.self.recovery, 'Teamcode gekopieerd.'); break;
    case 'toggle-recover':
      ui.recover = !ui.recover;
      ui.entryError = '';
      ui.entryValue = '';
      render();
      root.querySelector('.entry-form input')?.focus();
      break;
    case 'new':
      showDialog('Nieuw spel', '<p>Je opent een nieuwe kamer met een nieuwe QR-code.</p><button class="button primary" type="button" data-tool="create">Maak nieuw spel</button>');
      break;
    case 'create':
      if (popup.open) popup.close();
      createRoom();
      break;
    case 'end':
      popup.close();
      move('finish');
      break;
    case 'retry':
      if (role === 'host' && !token) createRoom();
      else refresh().then(schedule);
      break;
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  switch (form.id) {
    case 'join-form':
      event.preventDefault();
      join(form);
      break;
    case 'room-form': {
      event.preventDefault();
      const entered = new FormData(form).get('code').trim().toUpperCase().replace(/[\s-]+/gu, '');
      if (codePattern.test(entered)) location.href = roomURL('join', entered);
      else notify('Vul de zeven tekens op het hostscherm in.', true);
      break;
    }
    case 'dj-form':
      event.preventDefault();
      move('open', Object.fromEntries(new FormData(form)));
      break;
    case 'setup-form':
      event.preventDefault();
      start();
      break;
  }
});

document.addEventListener('input', event => {
  const input = event.target;
  if (input.form?.id === 'dj-form') ui.dj[input.name] = input.value;
  if (input.form?.id === 'join-form') ui.entryValue = input.value;
  if (input.id === 'playlist') {
    ui.setup ??= { ...state.settings };
    ui.setup.playlist = input.value;
  }
});

document.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.field === 'bonus') ui.bonus = input.checked;
  if (input.form?.id === 'setup-form' && input.name === 'deck') {
    ui.setup ??= { ...state.settings };
    ui.setup.deck = input.value;
    render();
    if (input.value === 'playlist') document.getElementById('playlist')?.focus();
  }
  if (input.form?.id === 'setup-form' && input.name === 'target') {
    ui.setup ??= { ...state.settings };
    ui.setup.target = Number(input.value);
  }
});

function reconnect() {
  if (!document.hidden && (state || code)) refresh().then(schedule);
  else clearTimeout(poll);
}

document.addEventListener('visibilitychange', reconnect);
window.addEventListener('online', reconnect);
openRoute().catch(showError);
