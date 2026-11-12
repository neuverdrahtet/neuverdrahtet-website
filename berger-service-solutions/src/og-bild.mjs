// Erzeugt public/assets/img/og-bild.png (1200×630) per Chromium-Screenshot.
// Ausführen: node berger-service-solutions/src/og-bild.mjs (benötigt Playwright).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const W = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const font = readFileSync(path.join(W, 'public/assets/fonts/inter-var.woff2')).toString('base64');
const html = `<html><head><style>@font-face{font-family:I;src:url(data:font/woff2;base64,${font})}
body{margin:0;width:1200px;height:630px;font-family:I;background:linear-gradient(150deg,#0f2233,#234a6b);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box}
.m{display:flex;align-items:center;gap:26px}.b{font-size:64px;font-weight:800;letter-spacing:8px}.s{font-size:22px;letter-spacing:9px;color:#9fb3c4;font-weight:600}
.sl{margin-top:54px;font-size:44px;font-weight:700;color:#f2a516}.t{margin-top:18px;font-size:27px;color:#d7e2ea;max-width:960px;line-height:1.4}</style></head><body>
<div class="m"><svg width="110" height="110" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0b1a27"/><path d="M12 9h10a6 6 0 0 1 2.2 11.6A6.5 6.5 0 0 1 22.5 31H12z" fill="none" stroke="#f2a516" stroke-width="3.2" stroke-linejoin="round"/><path d="M12 20h10" stroke="#f2a516" stroke-width="3.2"/></svg>
<div><div class="b">BERGER</div><div class="s">SERVICE SOLUTIONS</div></div></div>
<div class="sl">Handwerk. Service. Lösungen.</div>
<div class="t">Elektrotechnik · Sanierung & Bodenlegearbeiten · Hausmeister- & Objektservice · Entrümpelung – Essen und 50 km Umkreis</div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html); await p.waitForTimeout(200);
await p.screenshot({ path: path.join(W, 'public/assets/img/og-bild.png') }); await b.close();
console.log('og-bild.png erzeugt');
