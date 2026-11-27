// Erzeugt die Upload-Pakete in dist/:
//  1. berger-service-solutions-website.zip  – für normales Webhosting (Inhalt in den Web-Hauptordner)
//  2. berger-service-solutions-wordpress.zip – für IONOS Managed WordPress (Inhalt nach /public/wp-content)
// Ausführen: node berger-service-solutions/src/paket.mjs  (oder npm run paket:bss)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bauen } from './build.mjs';
import { CONFIG } from './config.mjs';

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(WURZEL, 'public');
const DIST = path.join(WURZEL, 'dist');

export function paketieren() {
  bauen();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const zip = (quelle, ziel) => {
    const r = spawnSync('zip', ['-qr', ziel, '.', '-x', '*.DS_Store'], { cwd: quelle });
    if (r.status !== 0) throw new Error(`zip fehlgeschlagen: ${r.stderr}`);
  };

  // 1. Normales Webhosting
  zip(PUBLIC, path.join(DIST, 'berger-service-solutions-website.zip'));

  // 2. IONOS Managed WordPress: alles unterhalb von wp-content
  const wp = path.join(DIST, 'wordpress-wp-content');
  const site = path.join(wp, 'bss-website');
  cpSync(PUBLIC, site, { recursive: true });
  rmSync(path.join(site, '.htaccess'));
  // Direktaufruf unter /wp-content/bss-website/... nicht indexieren (Doppelinhalt)
  writeFileSync(path.join(site, '.htaccess'), '<IfModule mod_headers.c>\n  <FilesMatch "\\.html$">\n    Header always set X-Robots-Tag "noindex, nofollow"\n  </FilesMatch>\n  <FilesMatch "\\.(webp|png|jpg|ico|woff2)$">\n    Header set Cache-Control "public, max-age=31536000"\n  </FilesMatch>\n  <FilesMatch "\\.(css|js|mjs)$">\n    Header set Cache-Control "public, max-age=604800"\n  </FilesMatch>\n</IfModule>\nAddType text/javascript .mjs\nAddType image/webp .webp\nAddType font/woff2 .woff2\nOptions -Indexes\n');
  // Bilder, CSS und Skripte direkt aus wp-content laden: Der Webserver liefert sie
  // dann selbst aus, auch wenn der Hoster statische Dateien nie an WordPress weiterreicht.
  for (const f of readdirSync(site).filter((n) => n.endsWith('.html'))) {
    const p = path.join(site, f);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/(["\s,(])assets\//g, '$1/wp-content/bss-website/assets/'));
  }
  mkdirSync(path.join(wp, 'mu-plugins'), { recursive: true });
  const plugin = readFileSync(path.join(WURZEL, 'src', 'php', 'wordpress-mu-plugin.php'), 'utf8')
    .replace("if (!defined('ABSPATH')) { exit; }", `if (!defined('ABSPATH')) { exit; }\nif (!defined('BSS_INDEXIERBAR')) { define('BSS_INDEXIERBAR', ${CONFIG.website.indexierbar ? 'true' : 'false'}); }\nif (!defined('BSS_DOMAIN')) { define('BSS_DOMAIN', '${new URL(CONFIG.website.url).hostname}'); }`);
  writeFileSync(path.join(wp, 'mu-plugins', 'bss-website.php'), plugin);
  zip(wp, path.join(DIST, 'berger-service-solutions-wordpress.zip'));
  return { wpVerzeichnis: wp };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  paketieren();
  console.log('Pakete erzeugt in berger-service-solutions/dist/');
}
