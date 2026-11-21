import { handleAPI } from './api.mjs';
import { d1Store } from './store.mjs';
import html from '../docs/index.html';
import js from '../docs/app.js';
import css from '../docs/theme.css';

const files = new Map([
  ['/', [html, 'text/html']],
  ['/index.html', [html, 'text/html']],
  ['/app.js', [js, 'text/javascript']],
  ['/theme.css', [css, 'text/css']]
]);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleAPI(request, d1Store(env.DB));
    const file = files.get(pathname);
    if (!file) return new Response('Niet gevonden', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file[0], { headers: {
      'content-type': file[1] + '; charset=utf-8',
      'cache-control': 'no-cache',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    } });
  }
};
