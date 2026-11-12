// Minimaler statischer Server für Browser-Tests (nur lokal, nur public/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPEN = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };

export function starteServer(port = 0) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const datei = path.join(PUBLIC, path.normalize(p));
      if (!datei.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
      try {
        const inhalt = await readFile(datei);
        res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' }).end(inhalt);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(path.join(PUBLIC, '404.html')));
      }
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, basis: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { basis } = await starteServer(Number(process.env.PORT || 4173));
  console.log(`Prototyp läuft auf ${basis}`);
}
