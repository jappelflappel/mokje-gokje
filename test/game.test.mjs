import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceRoom, apply, CODE, newRoom, publicState } from '../server/game.mjs';

function fixture(count = 3, settings) {
  const room = newRoom();
  const teams = Array.from({ length: count }, (_, index) =>
    apply(room, '', { action: 'join', name: 'Team ' + (index + 1) }).token);
  const host = (action, extras = {}) => apply(room, room.hostToken, { action, round: room.round?.id, ...extras });
  const team = (index, action, extras = {}) => apply(room, teams[index], { action, round: room.round?.id, ...extras });
  host('start', { settings });
  room.teams[0].timeline = [{ id: 'anchor', title: 'Anker', artist: 'Test', year: 1990 }];
  return { room, host, team, teams };
}

test('invite codes and team recovery survive a round without disclosing credentials', () => {
  for (let index = 0; index < 150; index += 1) assert.match(newRoom().code, CODE);
  const { room, host, teams } = fixture();
  host('next');
  const recovery = publicState(room, teams[1]).self.recovery;
  const recovered = apply(room, '', { action: 'join', recovery });
  assert.equal(recovered.token, teams[1]);
  assert.equal(publicState(room, recovered.token).self.timeline.length, 1);
  const visible = JSON.stringify(publicState(room, teams[1]));
  assert.ok(!visible.includes(room.hostToken));
  assert.ok(!visible.includes(room.djToken));
  assert.ok(!visible.includes(room.teams[2].recovery));
  assert.ok(!visible.includes(room.round.track.title));
  assert.equal(publicState(room, room.hostToken).round.track, undefined);
  assert.equal(publicState(room, room.djToken).round.track.title, room.round.track.title);
  assert.equal(publicState(room, '').teams, undefined);
});

test('the mix keeps the track hidden while teams place and pass', () => {
  const { room, host, team, teams } = fixture(2);
  delete room.pendingTracks.at(-1).link; // A room created before tracks had Spotify links.
  const nextTrack = publicState(room, room.hostToken).spotifyNext;
  assert.match(nextTrack.url, /^spotify:track:[A-Za-z0-9]{22}$/u);
  assert.equal(publicState(room, teams[0]).spotifyNext, undefined);
  assert.throws(() => host('next', { candidate: 'mix-stale' }), /al geopend/);

  host('next', { candidate: nextTrack.candidate });
  assert.equal(publicState(room, room.hostToken).spotifyCurrent, nextTrack.url);
  assert.equal(room.phase, 'guess');
  const secret = room.round.track;
  assert.equal(publicState(room, room.hostToken).round.track, undefined);
  assert.equal(publicState(room, teams[0]).spotifyCurrent, undefined);
  const gap = secret.year < 1990 ? 0 : 1;
  host('place', { gap });
  assert.equal(room.phase, 'steal');
  assert.equal(publicState(room, teams[0]).round.result, null);
  assert.throws(() => host('reveal'), /nog steeltijd/);
  team(1, 'pass');
  assert.equal(room.teams[1].coins, 2);
  assert.throws(() => team(1, 'steal', { gap: 1 - gap }), /overgeslagen/);
  assert.equal(advanceRoom(room), true);
  assert.equal(advanceRoom(room), false);
  assert.equal(publicState(room, teams[0]).round.result.track.title, secret.title);
  host('bonus');
  assert.throws(() => host('bonus'), /al uitgedeeld/);
  assert.equal(room.teams[0].coins, 3);
  assert.equal(room.history[0].bonus, true);
});

test('a different team can steal a misplaced card and the host can award one bonus', () => {
  const { room, host, team } = fixture();
  host('next');
  room.round.track = { id: 'next', year: 1989, title: 'Geheim', artist: 'Test' };
  assert.throws(() => team(0, 'place', { gap: 1 }), /nu geen kaart plaatsen/);
  host('open');
  assert.throws(() => team(1, 'place', { gap: 0 }), /ander team/);
  team(0, 'place', { gap: 1 });
  assert.throws(() => team(1, 'steal', { gap: 1 }), /al geclaimd/);
  const operation = 'ab'.repeat(16);
  team(1, 'steal', { gap: 0, operation });
  assert.equal(team(1, 'steal', { gap: 0, operation }).changed, false);
  assert.throws(() => team(2, 'steal', { gap: 0 }), /al geclaimd/);
  host('reveal', { bonus: true });
  assert.equal(room.teams[0].coins, 3);
  assert.equal(room.teams[1].coins, 1);
  assert.equal(room.teams[1].timeline.length, 2);
  assert.equal(room.round.result.receiverId, room.teams[1].id);
  assert.equal(room.phase, 'result');
  assert.throws(() => host('reveal', { bonus: true }), /wacht op de plaatsing/i);
  host('next');
  assert.equal(publicState(room, room.hostToken).activeId, room.teams[1].id);
});

test('an equal year can be placed on either side and a correct placement wins first', () => {
  const { room, host, team } = fixture(2);
  host('next');
  room.round.track.year = 1990;
  host('open');
  team(0, 'place', { gap: 0 });
  team(1, 'steal', { gap: 1 });
  host('reveal');
  assert.equal(room.round.result.receiverId, room.teams[0].id);
  assert.equal(room.teams[1].coins, 1);
});

test('the playlist uses an external Spotify URL and keeps DJ-entered data private until reveal', () => {
  const playlist = 'https://open.spotify.com/playlist/1234567890123456789012?si=trackers';
  const { room, host, team, teams } = fixture(2, { deck: 'playlist', target: 5, playlist });
  host('next');
  assert.equal(room.round.track, null);
  assert.equal(room.settings.playlist, playlist.split('?')[0]);
  const input = { action: 'open', round: room.round.id, title: 'Playlistnummer', artist: 'Artiest', year: '2004' };
  assert.throws(() => apply(room, room.djToken, { ...input, year: '' }), /uitgavejaar/);
  assert.throws(() => apply(room, room.djToken, { ...input, link: 'https://example.com/track/123' }), /Spotify-tracklink/);
  assert.throws(() => apply(room, teams[0], input), /mag deze actie niet/);
  apply(room, room.djToken, input);
  const guestTrack = publicState(room, teams[0]).round;
  assert.equal(guestTrack.hasTrack, true);
  assert.equal(guestTrack.track, undefined);
  team(0, 'place', { gap: 1 });
  room.round.stealUntil = Date.now() - 1;
  assert.throws(() => team(1, 'steal', { gap: 0 }), /steeltijd is voorbij/);
  assert.equal(advanceRoom(room), true);
  assert.equal(publicState(room, teams[0]).round.result.track.title, 'Playlistnummer');
});

test('lobby validates teams and settings and stops admitting new teams once started', () => {
  const room = newRoom();
  const team = apply(room, '', { action: 'join', name: 'Luid' });
  assert.ok(team.token);
  assert.throws(() => apply(room, '', { action: 'join', name: 'luid' }), /al gekozen/);
  assert.throws(() => apply(room, room.hostToken, { action: 'start' }), /minstens twee/);
  apply(room, '', { action: 'join', name: 'Stil' });
  assert.throws(() => apply(room, room.hostToken, {
    action: 'start', settings: { deck: 'playlist', target: 5, playlist: 'https://example.org' }
  }), /Spotify-playlistlink/);
  apply(room, room.hostToken, { action: 'start' });
  assert.throws(() => apply(room, '', { action: 'join', name: 'Te laat' }), /loopt al/);
});
