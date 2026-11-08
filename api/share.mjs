// GET /s?l=9&t=612.4&o=i&d=2026-11-08  (rewritten to /api/share by vercel.json)
// Link-preview bots read the meta tags; people are sent straight on to the game.
import { parseRun, runQuery, headline, subline } from './_card.mjs';

export const config = { runtime: 'edge' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default function handler(request) {
  const url = new URL(request.url);
  const run = parseRun(url.searchParams);
  const origin = url.origin;
  const image = run ? `${origin}/api/og?${runQuery(run)}` : `${origin}/api/og`;
  const page = run ? `${origin}/s?${runQuery(run)}` : `${origin}/`;
  const game = `${origin}/?ref=share`;
  const title = run ? `${headline(run)} · 1000 Seconds to AGI` : headline(null);
  const desc = subline(run);

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="1000 Seconds to AGI">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#ecebe6">
<meta http-equiv="refresh" content="0;url=${esc(game)}">
<script>location.replace(${JSON.stringify(game)})</script>
</head><body style="font-family:Helvetica,Arial,sans-serif;background:#ecebe6;color:#1d1d1b">
<p><a href="${esc(game)}">Play 1000 Seconds to AGI →</a></p>
</body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
    },
  });
}
