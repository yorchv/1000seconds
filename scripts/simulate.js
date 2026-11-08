#!/usr/bin/env node
/*
 * Balance simulator: a greedy bot plays the real game logic headless.
 *   node scripts/simulate.js [clicksPerSecond...] [--seeds=N]
 * Prints when each level is reached and whether the bot wins in time.
 * A clicks/sec below 1 plays the "charged pitch" rhythm (e.g. 0.15 ≈ one pitch every 6.7s).
 */
'use strict';
const G = require('../src/game.js');
const I = G.ITEMS;

function playGame(cps, opts) {
  opts = opts || {};
  const dt = 0.1;
  const s = G.createState(opts.seed == null ? 'sim' : opts.seed);
  G.click(s); // first click starts the run
  let clickAcc = 0;
  while (s.status === 'playing') {
    clickAcc += cps * dt;
    while (clickAcc >= 1) { G.click(s); clickAcc--; }
    botStep(s);
    G.tick(s, dt);
  }
  if (opts.verbose) console.log(snapshot(s));
  const levelTimes = {};
  s.stats.levelTimes.forEach((t, i) => { levelTimes[i + 1] = t; });
  return { status: s.status, reason: s.lossReason, time: s.time, level: s.level, levelTimes,
    overheats: s.stats.overheats, failed: s.stats.failedRuns, s };
}

function snapshot(s) {
  const own = Object.entries(s.owned).filter(([, n]) => n).map(([k, n]) => k.slice(0, 4) + n).join(' ');
  return `  t=${s.time.toFixed(0)} L${s.level} $${s.money.toFixed(0)} E${s.energy.toFixed(0)} llm${s.llms} cmp${G.computePower(s)} racks${G.slotsUsed(s)}/${G.slotsTotal(s)} ${own}`;
}

const DIAL = [0, 0.25, 0.5, 0.75, 1];

function setDial(s) {
  if (s.level < G.CONFIG.heatLevel) return;
  const heat = G.computeStats(s).heat;
  let pick = 1;
  for (const d of DIAL) {
    if (100 * heat / G.coolingCapacity(s, d) <= 82) { pick = d; break; }
  }
  if (s.heat > 90) pick = 1;
  G.setCooling(s, pick);
}

function botStep(s) {
  setDial(s);
  for (let guard = 0; guard < 60; guard++) {
    if (G.canLevelUp(s) && (s.level < G.CONFIG.heatLevel || s.heat < 85)) { G.levelUp(s); continue; }
    const want = nextPurchase(s);
    if (!want) return;
    if (!G.buy(s, want.id, want.qty || 1)) return; // save up for it
  }
}

function best(s, ids, valueOf) {
  let top = null;
  for (const id of ids) {
    if (!G.isUnlocked(s, id)) continue;
    const v = valueOf(id);
    if (!(v > 0)) continue;
    const per = G.cost(s, id) / v;
    if (!top || per < top.per) top = { id, per };
  }
  return top && top.id;
}

const SITES = ['garages', 'datacenters', 'campuses', 'orbitals'];
const POWER = ['generators', 'solar', 'datacenters', 'campuses', 'orbitals'];
const COOL = ['coolers', 'datacenters', 'campuses', 'orbitals'];

function bestCompute(s, metric) {
  const free = G.slotsTotal(s) - G.slotsUsed(s);
  const unit = best(s, G.COMPUTE_IDS, (id) => I[id][metric]);
  if (!unit) return null;
  if (I[unit].uses > free) {
    const site = best(s, SITES, (id) => I[id].slots);
    // Fall back to a smaller unit that still fits, if the site is far off.
    if (site) return { id: site };
    return null;
  }
  return { id: unit };
}

function nextPurchase(s) {
  const r = G.requirements(s);
  if (!r) return null;
  const cs = G.computeStats(s);
  const power = G.powerOutput(s);
  const llmRate = cs.algos * G.outputMult(s) / G.CONFIG.algosPerLLM;

  // 1. Cooling capacity: keep full-dial heat comfortably below 100.
  if (s.level >= G.CONFIG.heatLevel && 100 * cs.heat / G.coolingCapacity(s, 1) > 75) {
    return { id: best(s, COOL, (id) => I[id].cooling) };
  }

  // 2. Keep compute fed: at least ~4s of uncovered consumption in the tank.
  const deficit = cs.energy - power;
  if (deficit > 0 && s.energy < deficit * 4) {
    return { id: 'energy', qty: Math.max(1, Math.ceil(deficit * 4 / 10)) };
  }

  // 3. Power plants to cover consumption.
  if (G.isUnlocked(s, 'generators') && power < cs.energy * 1.1 + 2) {
    return { id: best(s, POWER, (id) => I[id].power - (I[id].upkeep || 0) * 3) };
  }

  // 4. Hit the compute requirement.
  if (G.computePower(s) < r.compute) return bestCompute(s, 'compute');

  // 5. Sales bots while they pay back quickly.
  if (G.isUnlocked(s, 'autoClickers')) {
    const per = G.cost(s, 'autoClickers') / (G.LEVELS[s.level - 1].click * G.CONFIG.autoClickRate);
    if (per < 45) return { id: 'autoClickers' };
  }

  // 6. Throughput upgrades if the LLM target is far off.
  const llmShort = r.llms - s.llms - s.algorithms / G.CONFIG.algosPerLLM;
  const secsToLLM = llmShort > 0 ? llmShort / Math.max(llmRate, 0.01) : 0;
  if (secsToLLM > 25) {
    const opt = G.isUnlocked(s, 'optimizations') && cs.algos > 0
      ? G.cost(s, 'optimizations') / (cs.algos / (1 + s.owned.optimizations * G.CONFIG.optimizationBonus) * G.CONFIG.optimizationBonus)
      : Infinity;
    const unit = best(s, G.COMPUTE_IDS, (id) => I[id].algos);
    const unitPer = unit ? G.cost(s, unit) / I[unit].algos : Infinity;
    if (opt < unitPer) return { id: 'optimizations' };
    return bestCompute(s, 'algos');
  }

  // 7. Stockpile energy toward the training run.
  if (s.energy < r.energy) {
    const gap = r.energy - s.energy;
    const surplus = power - cs.energy;
    if (surplus > 0 && gap / surplus < 15) return null; // power plants will get there
    return { id: 'energy', qty: Math.max(1, Math.min(Math.ceil(gap / 10), G.maxAffordable(s, 'energy'))) };
  }

  // 8. Otherwise save for the training fee.
  return null;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const seedsArg = argv.find((a) => a.startsWith('--seeds='));
  const nSeeds = seedsArg ? Number(seedsArg.split('=')[1]) : 1;
  const speeds = argv.filter((a) => !a.startsWith('--')).map(Number).filter(Boolean);
  for (const cps of speeds.length ? speeds : [0.15, 2, 3, 4, 5, 6]) {
    if (nSeeds > 1) {
      const res = [];
      for (let i = 0; i < nSeeds; i++) res.push(playGame(cps, { seed: 'seed' + i }));
      const wins = res.filter((r) => r.status === 'won');
      const times = wins.map((r) => r.time).sort((a, b) => a - b);
      console.log(`cps=${cps}: won ${wins.length}/${nSeeds}` + (times.length ? ` t=${times[0].toFixed(0)}..${times[times.length - 1].toFixed(0)} median ${times[times.length >> 1].toFixed(0)}` : '') +
        ` maxLevel ${Math.max(...res.map((r) => r.level))}`);
      continue;
    }
    const res = playGame(cps, { verbose: true });
    const lv = Object.entries(res.levelTimes).map(([l, t]) => `L${l}@${t.toFixed(0)}`).join(' ');
    console.log(`cps=${cps}: ${res.status.toUpperCase()}${res.reason ? ' (' + res.reason + ')' : ''} t=${res.time.toFixed(1)} overheats=${res.overheats} failed=${res.failed}\n  ${lv}`);
  }
}

module.exports = { playGame };
