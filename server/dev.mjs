import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { handleAPI } from './api.mjs';
import { sqliteStore } from './store.mjs';

const workspace = new URL('../.terugspoel/', import.meta.url);
await mkdir(workspace, { recursive: true });
const db = new DatabaseSync(process.env.TERUGSPOEL_DB || new URL('rooms.sqlite', workspace));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
db.exec(await readFile(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
const store = sqliteStore(db);

const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']], ['/theme.css', ['theme.css', 'text/css']]
]);

const port = Number(process.env.PORT || 4173);
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://localhost:' + port);
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, {
        method: incoming.method, headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: 'half' })
      });
      const response = await handleAPI(request, store);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = files.get(url.pathname);
    if (!file) {
      outgoing.writeHead(404).end('Niet gevonden');
      return;
    }
    outgoing.writeHead(200, { 'content-type': file[1] + '; charset=utf-8', 'cache-control': 'no-store' });
    outgoing.end(await readFile(new URL('../docs/' + file[0], import.meta.url)));
  } catch (error) {
    console.error(error.message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});

server.listen(port, '0.0.0.0', () => console.log('Mokje Gokje draait op http://localhost:' + port));
