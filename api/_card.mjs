// Shared by api/og.mjs (image) and api/share.mjs (link preview page).
// Files starting with "_" are not exposed as functions by Vercel.

// Mirrors LEVELS in src/game.js (name only). Keep in sync if levels are renamed.
export const LEVELS = [
  'Back-Alley GPU Renter', 'Rig Flipper', 'Garage Lab', 'Seed-Stage Startup', 'Unicorn',
  'Neolab', 'Sam Altman', 'Dario Amodei', 'Jensen Huang', 'Elon Musk',
];
export const MAX_LEVEL = LEVELS.length;

// Everything in the URL is untrusted: clamp to known shapes, never echo raw input.
// l = level 1-10, t = seconds 0-1000, o = outcome (w won, i investors walked, t time ran out), d = daily seed date.
export function parseRun(searchParams) {
  if (!searchParams.has('l')) return null;
  const o = ['w', 'i', 't'].includes(searchParams.get('o')) ? searchParams.get('o') : 't';
  let level = Math.round(Number(searchParams.get('l')));
  if (!Number.isFinite(level)) level = 1;
  level = Math.min(MAX_LEVEL, Math.max(1, level));
  if (o === 'w') level = MAX_LEVEL;
  let time = Number(searchParams.get('t'));
  if (!Number.isFinite(time)) time = 0;
  time = Math.min(1000, Math.max(0, time));
  const d = searchParams.get('d') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  return { level, time: time.toFixed(1), o, date, name: LEVELS[level - 1] };
}

export function runQuery(run) {
  const q = new URLSearchParams({ l: String(run.level), t: run.time, o: run.o });
  if (run.date) q.set('d', run.date);
  return q.toString();
}

// Text used in titles, descriptions and alt text.
export function headline(run) {
  if (!run) return '1000 Seconds to AGI';
  if (run.o === 'w') return `I went beyond AGI in ${run.time}s`;
  return `I made it to ${run.name} (level ${run.level}/${MAX_LEVEL})`;
}

export function subline(run) {
  if (!run) return 'A 1000-second incremental game: from renting GPUs in a Taipei market to orbital superintelligence.';
  const day = run.date ? ` · daily run ${run.date}` : '';
  if (run.o === 'w') return `From back-alley GPU renter to orbital superintelligence${day}. Can you beat it?`;
  if (run.o === 'i') return `The investors walked at ${run.time}s${day}. Can you beat it?`;
  return `The clock ran out${day}. Can you beat it?`;
}
