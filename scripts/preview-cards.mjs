// Render the share cards locally without deploying: node scripts/preview-cards.mjs -> .og-test/og-*.jpg
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof URL ? input.href : input);
  if (u.startsWith('file:')) return new Response(await readFile(fileURLToPath(u)));
  if (u.startsWith('https://test.local/')) {
    try { return new Response(await readFile(new URL(u.slice('https://test.local/'.length), root))); }
    catch { return new Response('nf', { status: 404 }); }
  }
  return realFetch(input, init);
};
import { mkdir } from 'node:fs/promises';
await mkdir(new URL('../.og-test/', import.meta.url), { recursive: true });
const { GET: og } = await import('../api/og.mjs');
const { default: share } = await import('../api/share.mjs');
const cases = { home: '', l9: 'l=9&t=612.4&o=i&d=2026-11-08', win: 'l=10&t=912.3&o=w&d=2026-11-08', l1: 'l=1&t=1000&o=t&d=2026-11-08', evil: 'l=<script>&t=NaN&o=x&d=../../etc' };
for (const [k, q] of Object.entries(cases)) {
  const res = await og(new Request(`https://test.local/api/og${q ? '?' + q : ''}`));
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(new URL(`../.og-test/og-${k}.jpg`, import.meta.url), buf);
  console.log(k, res.status, res.headers.get('content-type'), buf.length);
}
const html = await (await share(new Request('https://test.local/s?l=9&t=612.4&o=i&d=2026-11-08'))).text();
console.log(html.split('\n').filter((l) => /og:title|og:image"|twitter:card|og:description/.test(l)).join('\n'));
const evil = await (await share(new Request('https://test.local/s?l="><script>alert(1)</script>&t=1e9&o=w&d=x'))).text();
console.log('evil has <script>alert:', evil.includes('alert(1)'), '| title:', evil.match(/<title>(.*)<\/title>/)[1]);
