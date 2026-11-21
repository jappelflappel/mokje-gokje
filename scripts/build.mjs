import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('docs', { recursive: true });
await cp('client/index.html', 'docs/index.html');
await cp('client/theme.css', 'docs/theme.css');
await writeFile('docs/.nojekyll', '');
await build({
  entryPoints: ['client/app.mjs'], bundle: true, minify: true, format: 'esm',
  target: ['safari15', 'chrome96', 'firefox96'], outfile: 'docs/app.js'
});

if (process.env.TERUGSPOEL_BUILD_CLIENT_ONLY !== '1') {
  await mkdir('dist/server', { recursive: true });
  await mkdir('dist/.openai', { recursive: true });
  await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
  await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
  await build({
    entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser',
    target: 'es2022', outfile: 'dist/server/index.js',
    plugins: [{
      name: 'embed-static-assets',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]docs[\\/](index\.html|app\.js|theme\.css)$/ },
          async ({ path }) => ({ contents: await readFile(path, 'utf8'), loader: 'text' }));
      }
    }]
  });
}
