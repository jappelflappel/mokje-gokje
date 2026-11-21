import { mix, spotifyTrackLink } from './tracks.mjs';

export const MAX_TEAMS = 8;
export const ROOM_TTL = 3 * 24 * 60 * 60 * 1000;
export const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/;
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const targets = [5, 7, 10];
const STEAL_MS = 12_000;

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, message, status = 409) {
  if (!condition) throw new GameError(status, message);
}

export function makeCode(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

export function makeToken() {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
}

export function newRoom() {
  return {
    code: makeCode(7),
    hostToken: makeToken(),
    phase: 'lobby',
    settings: { deck: 'mix', target: 7 },
    teams: [],
    pendingTracks: [],
    turn: 0,
    roundNumber: 0,
    round: null,
    history: [],
    recentOperations: [],
    winnerIds: []
  };
}

export function access(room, token) {
  if (!token) return { role: 'guest' };
  if (token === room.hostToken) return { role: 'host' };
  const team = room.teams.find(candidate => candidate.token === token);
  requireThat(team, 'Deze toegangscode is verlopen of ongeldig.', 401);
  return { role: 'team', team };
}

export function cleanRoomCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase().replaceAll('-', '').replace(/\s+/gu, '') : '';
}

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function spotifyAppUrl(value, kind) {
  const match = typeof value === 'string'
    ? value.match(new RegExp('^https://open\\.spotify\\.com/' + kind + '/([a-zA-Z0-9]{22})(?:[/?#].*)?$', 'u'))
    : null;
  return match ? 'spotify:' + kind + ':' + match[1] : '';
}

const ordered = (a, b) => a.year - b.year;

function shuffledTracks() {
  const tracks = [...mix];
  for (let last = tracks.length - 1; last > 0; last -= 1) {
    const index = Math.floor(Math.random() * (last + 1));
    [tracks[last], tracks[index]] = [tracks[index], tracks[last]];
  }
  return tracks;
}

function join(room, data) {
  if (data.recovery) {
    const recovery = cleanRoomCode(data.recovery);
    const team = room.teams.find(candidate => candidate.recovery === recovery);
    requireThat(team, 'Geen team gevonden met die teamcode.', 404);
    return { token: team.token, changed: false };
  }
  if (typeof data.joinKey === 'string' && /^[a-f0-9]{32}$/u.test(data.joinKey)) {
    const existing = room.teams.find(candidate => candidate.joinKey === data.joinKey);
    if (existing) return { token: existing.token, changed: false };
  }
  requireThat(room.phase === 'lobby', 'Dit spel loopt al. Gebruik de teamcode van je bestaande team.');
  requireThat(room.teams.length < MAX_TEAMS, 'Alle acht teamplaatsen zijn bezet.');
  const name = cleanText(data.name, 26);
  requireThat(name.length >= 2, 'Kies een teamnaam van minstens twee tekens.', 400);
  requireThat(!room.teams.some(team => team.name.localeCompare(name, 'nl', { sensitivity: 'base' }) === 0),
    'Die teamnaam is al gekozen.');
  const team = { id: makeToken().slice(0, 10), name, token: makeToken(), recovery: makeCode(8),
    joinKey: typeof data.joinKey === 'string' ? data.joinKey.slice(0, 32) : '', timeline: [], coins: 2 };
  room.teams.push(team);
  return { token: team.token, changed: true };
}

function settings(room, data) {
  requireThat(room.phase === 'lobby', 'De instellingen staan vast zodra het spel begint.');
  requireThat((data.deck ?? 'mix') === 'mix' && targets.includes(data.target),
    'Kies een geldig kaartdoel voor de vaste mix.', 400);
  room.settings = { deck: 'mix', target: data.target };
}

function start(room) {
  requireThat(room.phase === 'lobby', 'Dit spel is al begonnen.');
  requireThat(room.teams.length >= 2, 'Er zijn minstens twee teams nodig.');
  room.settings.deck = 'mix';
  room.pendingTracks = shuffledTracks();
  for (const team of room.teams) team.timeline.push(room.pendingTracks.pop());
  room.phase = 'ready';
}

function endByScore(room) {
  const best = Math.max(...room.teams.map(team => team.timeline.length));
  room.winnerIds = room.teams.filter(team => team.timeline.length === best).map(team => team.id);
  room.phase = 'finished';
}

function next(room, candidate) {
  requireThat(['ready', 'result'].includes(room.phase), 'Rond eerst het huidige nummer af.');
  requireThat(room.settings.deck === 'mix', 'Start een nieuw spel met de vaste mix.');
  if (candidate !== undefined) {
    requireThat(room.pendingTracks.at(-1)?.id === candidate,
      'Dit nummer is al geopend. Gebruik het huidige nummer in het hostscherm.');
  }
  if (!room.pendingTracks.length) {
    endByScore(room);
    return;
  }
  if (room.phase === 'result') room.turn = (room.turn + 1) % room.teams.length;
  room.roundNumber += 1;
  room.round = {
    id: makeToken().slice(0, 16),
    track: room.pendingTracks.pop(),
    placement: null, steals: [], result: null
  };
  room.phase = candidate === undefined ? 'cue' : 'guess';
}

function openRound(room) {
  requireThat(room.phase === 'cue', 'De plaatsing is al geopend.');
  requireThat(room.round.track, 'Start een nieuw spel met de vaste mix.');
  room.phase = 'guess';
}

function skip(room) {
  requireThat(['cue', 'guess'].includes(room.phase), 'Er is al een plaatsing bevestigd.');
  room.round = null;
  room.phase = 'ready';
}

function place(room, team, gap) {
  requireThat(room.phase === 'guess', 'Je kunt nu geen kaart plaatsen.');
  requireThat(room.teams[room.turn].id === team.id, 'Een ander team is aan de beurt.', 403);
  requireThat(Number.isInteger(gap) && gap >= 0 && gap <= team.timeline.length, 'Kies een vak op je tijdlijn.', 400);
  room.round.placement = gap;
  room.round.stealUntil = Date.now() + STEAL_MS;
  room.round.passes = [];
  room.phase = 'steal';
}

function stealWindow(room) {
  if (room.phase !== 'steal') return null;
  const { stealUntil = 0, passes = [], steals } = room.round;
  const now = Date.now();
  const active = room.teams[room.turn];
  const free = active.timeline.length - steals.length;
  const waiting = free > 0 && now < stealUntil
    ? room.teams.filter(team => team.id !== active.id && team.coins > 0
      && !passes.includes(team.id) && !steals.some(claim => claim.teamId === team.id)).map(team => team.id)
    : [];
  return { until: stealUntil, now, waiting, passes };
}

function pass(room, team) {
  requireThat(stealWindow(room)?.waiting.includes(team.id), 'Je kunt deze steelkans niet meer overslaan.');
  room.round.passes.push(team.id);
}

function steal(room, team, gap) {
  requireThat(room.phase === 'steal', 'Er is nu geen steelkans.');
  requireThat(room.round.stealUntil === undefined || Date.now() < room.round.stealUntil, 'De steeltijd is voorbij.');
  const active = room.teams[room.turn];
  requireThat(active.id !== team.id, 'Deze steelkans is voor de andere teams.', 403);
  requireThat(team.coins > 0, 'Je hebt geen munten meer.');
  requireThat(!room.round.steals.some(claim => claim.teamId === team.id), 'Je hebt al een steelpoging gedaan.');
  requireThat(!room.round.passes?.includes(team.id), 'Jullie hebben deze steelkans overgeslagen.');
  requireThat(Number.isInteger(gap) && gap >= 0 && gap <= active.timeline.length, 'Kies een vak op de tijdlijn.', 400);
  requireThat(room.round.placement !== gap && !room.round.steals.some(claim => claim.gap === gap),
    'Dat vak is al geclaimd. Kies een ander vak.');
  team.coins -= 1;
  room.round.steals.push({ teamId: team.id, gap });
}

function fits(cards, position, year) {
  return (position === 0 || cards[position - 1].year <= year)
    && (position === cards.length || year <= cards[position].year);
}

function reveal(room, bonus) {
  requireThat(room.phase === 'steal', 'Wacht op de plaatsing van het team.');
  requireThat(!stealWindow(room).waiting.length, 'De andere teams hebben nog steeltijd.');
  const active = room.teams[room.turn];
  const { track, placement, steals } = room.round;
  const placedCorrectly = fits(active.timeline, placement, track.year);
  const winningSteal = !placedCorrectly && steals.find(claim => fits(active.timeline, claim.gap, track.year));
  const receiver = placedCorrectly ? active : room.teams.find(team => team.id === winningSteal?.teamId);
  if (receiver) {
    receiver.timeline.push(track);
    receiver.timeline.sort(ordered);
  }
  if (bonus === true) active.coins += 1;

  room.round.result = {
    track,
    placedCorrectly,
    receiverId: receiver?.id ?? null,
    activeId: active.id,
    bonus: bonus === true,
    roundNumber: room.roundNumber
  };
  room.history.unshift(room.round.result);
  if (receiver?.timeline.length >= room.settings.target) {
    room.winnerIds = [receiver.id];
    room.phase = 'finished';
  } else {
    room.phase = 'result';
  }
}

export function advanceRoom(room) {
  if (room.phase !== 'steal' || room.round.stealUntil === undefined || stealWindow(room).waiting.length) return false;
  reveal(room, false);
  return true;
}

function grantBonus(room) {
  const result = room.round.result;
  requireThat(result && ['result', 'finished'].includes(room.phase), 'Wacht op de uitslag.');
  requireThat(!result.bonus, 'De bonusmunt is al uitgedeeld.');
  room.teams.find(team => team.id === result.activeId).coins += 1;
  result.bonus = true;
  room.history[0].bonus = true;
}

const roundActions = new Set(['open', 'skip', 'place', 'steal', 'pass', 'reveal', 'bonus']);
const hostActions = new Set(['settings', 'start', 'next', 'open', 'skip', 'place', 'reveal', 'bonus', 'finish', 'remove']);

export function apply(room, token, data) {
  if (data.action === 'join') return join(room, data);
  const actor = access(room, token);
  const hostAllowed = actor.role === 'host' && hostActions.has(data.action);
  const teamAllowed = actor.role === 'team' && ['place', 'steal', 'pass'].includes(data.action);
  requireThat(hostAllowed || teamAllowed, 'Je mag deze actie niet uitvoeren.', 403);

  const operation = typeof data.operation === 'string' && /^[a-f0-9]{32}$/u.test(data.operation)
    ? actor.role + ':' + (actor.team?.id ?? '') + ':' + data.operation : null;
  if (operation && room.recentOperations.includes(operation)) return { changed: false };
  if (roundActions.has(data.action)) {
    requireThat(room.round && room.round.id === data.round, 'Dit nummer is al voorbij.');
  }

  switch (data.action) {
    case 'settings': settings(room, data); break;
    case 'start':
      if (data.settings) settings(room, data.settings);
      start(room);
      break;
    case 'next': next(room, data.candidate); break;
    case 'open': openRound(room); break;
    case 'skip': skip(room); break;
    case 'place': place(room, actor.team ?? room.teams[room.turn], data.gap); break;
    case 'steal': steal(room, actor.team, data.gap); break;
    case 'pass': pass(room, actor.team); break;
    case 'reveal': reveal(room, data.bonus); break;
    case 'bonus': grantBonus(room); break;
    case 'finish':
      requireThat(['ready', 'result'].includes(room.phase), 'Rond eerst het huidige nummer af.');
      endByScore(room);
      break;
    case 'remove':
      requireThat(room.phase === 'lobby', 'Teams kunnen alleen voor de start worden verwijderd.');
      requireThat(room.teams.some(team => team.id === data.teamId), 'Dat team zit al niet meer in dit spel.');
      room.teams = room.teams.filter(team => team.id !== data.teamId);
      break;
  }

  if (operation) room.recentOperations = [...room.recentOperations.slice(-63), operation];
  return { changed: true };
}

export function publicState(room, token) {
  const { role, team } = access(room, token);
  if (role === 'guest') return { role, code: room.code, phase: room.phase, teamCount: room.teams.length };

  const active = room.phase === 'lobby' ? null : room.teams[room.turn];
  const round = room.round;
  const nextTrack = role === 'host' && room.settings.deck === 'mix' && ['ready', 'result'].includes(room.phase)
    ? room.pendingTracks.at(-1) : null;
  const currentLink = role === 'host' && room.settings.deck === 'mix' && round?.track
    && ['cue', 'guess'].includes(room.phase) ? spotifyAppUrl(spotifyTrackLink(round.track), 'track') : '';
  return {
    role,
    code: room.code,
    phase: room.phase,
    settings: { deck: room.settings.deck, target: room.settings.target },
    teams: room.teams.map(({ id, name, coins, timeline }) => ({ id, name, coins, cards: timeline.length })),
    self: team ? { id: team.id, recovery: team.recovery, timeline: team.timeline } : null,
    activeId: active?.id ?? null,
    activeTimeline: active?.timeline ?? [],
    roundNumber: room.roundNumber,
    round: round ? {
      id: round.id,
      hasTrack: Boolean(round.track),
      placement: round.placement,
      steals: round.steals,
      stealWindow: stealWindow(room),
      result: round.result
    } : null,
    ...(role === 'host' ? {
      spotifyNext: nextTrack ? {
        candidate: nextTrack.id,
        url: spotifyAppUrl(spotifyTrackLink(nextTrack), 'track')
      } : null,
      spotifyCurrent: currentLink,
      recoveries: room.teams.map(({ id, recovery }) => ({ id, recovery })),
      remaining: room.settings.deck === 'mix' ? room.pendingTracks.length : null
    } : {}),
    history: room.history.slice(0, 8),
    winnerIds: room.winnerIds
  };
}
