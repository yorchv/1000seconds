// GET /api/og                      -> 1200x630 home card
// GET /api/og?l=9&t=612.4&o=i&d=… -> card for one finished run (see parseRun in _card.mjs)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from '@vercel/og';
import sharp from 'sharp';
import { parseRun, headline, MAX_LEVEL } from './_card.mjs';

// Node runtime (default). Fonts and art are bundled via "includeFiles" in vercel.json.
const ASSETS = join(process.cwd(), 'assets');

const INK = '#1d1d1b';
const PAPER = '#ecebe6';
const ORANGE = '#f0601a';
const MUTE = '#8a8a84';
const RULE = '#d2d0c8';

const font500 = readFile(join(ASSETS, 'fonts', 'inter-500.woff'));
const font800 = readFile(join(ASSETS, 'fonts', 'inter-800.woff'));

// Tiny element helper so this file needs no JSX build step. Satori wants display:flex on any multi-child div.
function h(type, style, ...children) {
  const kids = children.flat().filter((c) => c !== null && c !== false && c !== undefined);
  return { type, key: null, props: { style: { display: 'flex', ...style }, children: kids.length === 1 ? kids[0] : kids } };
}

// key is always '1'..'10' or 'win' (derived from the clamped run), never raw input.
async function artDataUri(key) {
  try {
    const buf = await readFile(join(ASSETS, 'og', `${key}.jpg`));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function ladder(level, won) {
  const segs = [];
  for (let i = 1; i <= MAX_LEVEL; i++) {
    const bg = won || i < level ? INK : i === level ? ORANGE : RULE;
    segs.push(h('div', { width: 40, height: 12, borderRadius: 3, background: bg, marginRight: i < MAX_LEVEL ? 8 : 0 }));
  }
  return h('div', { flexDirection: 'row' }, segs);
}

function brand() {
  return h('div', { flexDirection: 'row', alignItems: 'center' },
    h('div', { width: 26, height: 26, borderRadius: 13, background: ORANGE, marginRight: 14 }),
    h('div', { fontSize: 22, fontWeight: 800, letterSpacing: 4, color: INK }, '1000 SECONDS TO AGI'));
}

function homeCard() {
  return [
    brand(),
    h('div', { flexDirection: 'column' },
      h('div', { fontSize: 22, fontWeight: 500, letterSpacing: 3, color: MUTE, marginBottom: 14 }, 'NEW RUN EVERY DAY'),
      h('div', { fontSize: 76, fontWeight: 800, letterSpacing: -3.5, lineHeight: 0.95, color: INK, whiteSpace: 'nowrap' }, '1000 seconds'),
      h('div', { flexDirection: 'row', fontSize: 76, fontWeight: 800, letterSpacing: -3.5, lineHeight: 1.05 },
        h('span', { color: INK }, 'to '), h('span', { color: ORANGE }, 'AGI'), h('span', { color: INK }, '.')),
      h('div', { fontSize: 27, fontWeight: 500, color: '#3a3a37', marginTop: 20, lineHeight: 1.3 },
        'Rent GPUs in a Taipei market. Climb to orbital superintelligence. Pitch every 10s or the investors walk.')),
    h('div', { flexDirection: 'column' },
      ladder(1, true),
      h('div', { fontSize: 26, fontWeight: 800, color: INK, marginTop: 20 }, 'Play free in your browser →')),
  ];
}

function runCard(run) {
  const won = run.o === 'w';
  const big = won
    ? h('div', { flexDirection: 'column', fontSize: 104, fontWeight: 800, letterSpacing: -5, lineHeight: 0.95 },
        h('div', { color: INK }, 'Beyond'),
        h('div', { flexDirection: 'row' }, h('span', { color: ORANGE }, 'AGI'), h('span', { color: INK }, '.')))
    : h('div', { flexDirection: 'row', alignItems: 'flex-end', lineHeight: 1 },
        h('div', { fontSize: 168, fontWeight: 800, letterSpacing: -10, color: INK }, String(run.level).padStart(2, '0')),
        h('div', { fontSize: 40, fontWeight: 800, color: MUTE, marginBottom: 22, marginLeft: 6 }, `/${MAX_LEVEL}`));
  const result = won ? `Finished in ${run.time}s`
    : run.o === 'i' ? `Investors walked at ${run.time}s` : 'The clock ran out';
  return [
    brand(),
    h('div', { flexDirection: 'column' },
      h('div', { fontSize: 22, fontWeight: 500, letterSpacing: 3, color: MUTE, marginBottom: 6 },
        run.date ? `DAILY RUN · ${run.date}` : 'MY RUN'),
      big,
      h('div', { fontSize: 46, fontWeight: 800, letterSpacing: -1.5, color: INK, marginTop: won ? 18 : 0, lineHeight: 1.05 }, run.name),
      h('div', { fontSize: 30, fontWeight: 500, color: won ? ORANGE : '#3a3a37', marginTop: 12 }, result)),
    h('div', { flexDirection: 'column' },
      ladder(run.level, won),
      h('div', { fontSize: 28, fontWeight: 800, color: INK, marginTop: 20 }, 'Can you beat it? →')),
  ];
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const run = parseRun(url.searchParams);
    const key = !run ? '10' : run.o === 'w' ? 'win' : String(run.level);
    const [art, f500, f800] = await Promise.all([artDataUri(key), font500, font800]);

    const left = h('div', { flexDirection: 'column', justifyContent: 'space-between', width: 636, height: 630, padding: '52px 56px', background: PAPER },
      run ? runCard(run) : homeCard());
    const right = art
      ? { type: 'img', key: null, props: { src: art, width: 560, height: 630, style: { width: 560, height: 630, objectFit: 'cover' } } }
      : h('div', { width: 560, height: 630, background: ORANGE });

    const png = new ImageResponse(
      h('div', { width: '100%', height: '100%', flexDirection: 'row', fontFamily: 'Inter', background: PAPER },
        left, h('div', { width: 4, height: 630, background: INK }), right),
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: 'Inter', data: f500, weight: 500, style: 'normal' },
          { name: 'Inter', data: f800, weight: 800, style: 'normal' },
        ],
      },
    );
    // JPEG keeps the card well under WhatsApp's ~300 KB preview limit (the PNG is ~550 KB).
    const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    return new Response(jpeg, {
      headers: {
        'Content-Type': 'image/jpeg',
        // The query fully determines the image, so let the CDN keep it.
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
    });
  } catch (e) {
    console.error('og render failed:', e && e.stack || e);
    return new Response(`Could not render card: ${headline(null)}`, { status: 500 });
  }
}
