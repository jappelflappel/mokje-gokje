import { access, advanceRoom, apply, CODE, GameError, newRoom, publicState, ROOM_TTL } from './game.mjs';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '600',
  'x-content-type-options': 'nosniff'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

async function readData(request) {
  if (!request.body || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new GameError(415, 'Deze aanvraag moet JSON bevatten.');
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      throw new GameError(413, 'Deze aanvraag is te groot.');
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // A malformed request is handled by the same validation response below.
  }
  throw new GameError(400, 'Deze aanvraag is ongeldig.');
}

async function createRoom(store) {
  await store.prune(Date.now() - ROOM_TTL);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const room = newRoom();
    if (await store.insert(room)) {
      return json({ token: room.hostToken, revision: 1, state: publicState(room, room.hostToken) }, 201);
    }
  }
  throw new GameError(503, 'Er kon geen spel worden aangemaakt. Probeer het opnieuw.');
}

async function loadRoom(store, code) {
  const row = await store.read(code);
  if (!row || row.updated_at < Date.now() - ROOM_TTL) {
    throw new GameError(404, 'Dit spel bestaat niet meer. Vraag de host om de actuele QR-code.');
  }
  return { room: JSON.parse(row.state), revision: row.revision };
}

async function change(store, code, token, data) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { room, revision } = await loadRoom(store, code);
    const result = apply(room, token, data);
    if (result.changed) advanceRoom(room);
    if (result.changed && !await store.update(room, revision)) continue;
    return json({
      revision: result.changed ? revision + 1 : revision,
      state: publicState(room, result.token ?? token),
      ...(result.token ? { token: result.token } : {})
    });
  }
  throw new GameError(409, 'Er kwamen tegelijk veel keuzes binnen. Probeer het opnieuw.');
}

async function readRoom(store, code, token) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { room, revision } = await loadRoom(store, code);
    if (!token) return json({ revision, state: publicState(room, token) });
    access(room, token);
    if (!advanceRoom(room)) return json({ revision, state: publicState(room, token) });
    if (await store.update(room, revision)) return json({ revision: revision + 1, state: publicState(room, token) });
  }
  throw new GameError(409, 'Er kwamen tegelijk veel keuzes binnen. Probeer het opnieuw.');
}

export async function handleAPI(request, store) {
  try {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (pathname === '/api/health' && request.method === 'GET') {
      await store.health();
      return json({ status: 'ok' });
    }
    if (pathname === '/api/rooms' && request.method === 'POST') return await createRoom(store);

    const code = pathname.match(/^\/api\/rooms\/([^/]+)$/u)?.[1];
    if (!code || !CODE.test(code)) throw new GameError(404, 'Onbekende spelcode.');
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{40})$/u)?.[1] || null;
    if (!token && request.headers.has('authorization')) {
      throw new GameError(401, 'Deze toegangscode is ongeldig.');
    }

    if (request.method === 'GET') {
      return await readRoom(store, code, token);
    }
    if (request.method === 'POST') {
      const data = await readData(request);
      if (data.action !== 'join' && !token) throw new GameError(401, 'Je bent niet bij dit spel ingelogd.');
      return await change(store, code, token, data);
    }
    throw new GameError(405, 'Deze aanvraag wordt niet ondersteund.');
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, error.status);
    console.error('Mokje Gokje API:', error.message);
    return json({ error: 'Het spel is even onbereikbaar. Probeer het opnieuw.' }, 503);
  }
}
