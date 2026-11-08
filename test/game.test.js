'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game.js');
const { playGame } = require('../scripts/simulate.js');

function run(s, seconds, clickEvery) {
  const dt = 0.1;
  let sinceClick = 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps && s.status === 'playing'; i++) {
    if (clickEvery && (sinceClick += dt) >= clickEvery - 1e-9) { G.click(s); sinceClick = 0; }
    G.tick(s, dt);
  }
}

function fresh() {
  const s = G.createState('test');
  s.nextEvent = null; // no random events unless a test wants them
  G.click(s);
  return s;
}

test('first pitch starts the run and earns money', () => {
  const s = G.createState('test');
  assert.equal(s.status, 'ready');
  assert.equal(G.click(s), 1);
  assert.equal(s.status, 'playing');
  assert.equal(s.money, 1);
});

test('game is lost after 10 seconds without a manual pitch', () => {
  const s = fresh();
  s.owned.autoClickers = 50; // sales bots do not count as pitching
  run(s, 9.5);
  assert.equal(s.status, 'playing');
  run(s, 1);
  assert.equal(s.status, 'lost');
  assert.equal(s.lossReason, 'idle');
});

test('game is lost when the 1000 seconds run out', () => {
  const s = fresh();
  run(s, 1001, 5);
  assert.equal(s.status, 'lost');
  assert.equal(s.lossReason, 'time');
  assert.equal(s.time, 1000);
});

test('costs follow growth and inflation', () => {
  const s = fresh();
  const one = G.cost(s, 'gpus', 1);
  const two = G.cost(s, 'gpus', 2);
  const g = G.ITEMS.gpus.growth;
  assert.ok(Math.abs(one - 10) < 1e-9);
  assert.ok(Math.abs(two - (10 + 10 * g)) < 1e-9);
  s.time = 500;
  assert.ok(G.cost(s, 'gpus', 1) > one, 'inflation raises prices over time');
});

test('items unlock by level and buying deducts money', () => {
  const s = fresh();
  s.money = 1e6;
  assert.equal(G.buy(s, 'autoClickers'), false);
  assert.equal(G.blocker(s, 'autoClickers'), 'locked');
  assert.equal(G.buy(s, 'gpus', 3), true);
  assert.equal(s.owned.gpus, 3);
  assert.ok(s.money < 1e6);
  assert.equal(G.buy(s, 'energy', 2), true);
  assert.equal(s.energy, 20);
});

test('compute hardware needs rack space; sites add racks', () => {
  const s = fresh();
  s.money = 1e6;
  s.level = 2;
  assert.equal(G.maxAffordable(s, 'gpus'), G.CONFIG.baseSlots);
  assert.equal(G.buy(s, 'gpus', G.CONFIG.baseSlots), true);
  assert.equal(G.blocker(s, 'gpus'), 'racks');
  assert.equal(G.buy(s, 'garages'), true);
  assert.equal(G.slotsTotal(s), G.CONFIG.baseSlots + G.ITEMS.garages.slots);
  assert.equal(G.buy(s, 'gpus'), true);
});

test('maxAffordable returns the largest affordable quantity', () => {
  const s = fresh();
  s.money = 100;
  const n = G.maxAffordable(s, 'energy');
  assert.ok(G.canAfford(s, 'energy', n));
  assert.ok(!G.canAfford(s, 'energy', n + 1));
});

test('GPUs burn energy into algorithms; LLMs compile and license from level 4', () => {
  const s = fresh();
  s.owned.gpus = 6;
  s.energy = 100;
  s.overclock = 0;
  G.CONFIG.ocPerClick = 0; // isolate the base rates
  try { run(s, 5, 1); } finally { G.CONFIG.ocPerClick = 0.25; }
  assert.ok(Math.abs(s.energy - 85) < 1e-6);
  assert.ok(Math.abs(s.algorithms - 30) < 1e-6);
  assert.equal(s.llms, 0, 'no LLMs before level 4');
  s.level = 4;
  G.tick(s, 0.1);
  assert.equal(s.llms, 1);
  assert.ok(G.passiveIncome(s) > 0, 'held LLMs earn licensing');
});

test('charged pitch pays more the longer you wait', () => {
  const s = fresh();
  s.level = 2;
  s.owned.autoClickers = 10;
  run(s, 0.5);
  const quick = G.charge(s);
  run(s, 7);
  const slow = G.charge(s);
  assert.ok(slow > quick * 50, 'charge grows with the square of the wait');
  const before = s.money;
  const paid = G.click(s);
  assert.ok(Math.abs(s.money - before - paid) < 1e-9);
  assert.ok(paid > G.clickValue(s));
  assert.equal(G.charge(s), 0, 'pitching resets the charge');
});

test('rapid pitching overclocks compute output', () => {
  const s = fresh();
  s.owned.gpus = 6;
  s.energy = 1e4;
  const calm = G.outputMult(s);
  for (let i = 0; i < 12; i++) G.click(s);
  assert.ok(G.outputMult(s) > calm * 1.4);
  run(s, 20, 5);
  assert.ok(G.outputMult(s) < calm * 1.2, 'overclock decays');
});

test('training runs take time, charge up front, and promote on completion', () => {
  const s = fresh();
  assert.equal(G.canLevelUp(s), false);
  Object.assign(s, { money: 1000, energy: 1000 });
  s.owned.gpus = 4;
  assert.equal(G.levelUp(s), true);
  assert.ok(s.training);
  assert.equal(s.level, 1);
  assert.ok(s.money < 1000 && s.energy < 1000);
  assert.equal(G.canLevelUp(s), false, 'one training run at a time');
  run(s, G.trainDuration(1) + 0.5, 1);
  assert.equal(s.training, null);
  assert.equal(s.level, 2);
  assert.ok(G.hyped(s), 'promotion starts a hype window');
  assert.equal(G.clickValue(s), G.LEVELS[1].click * G.CONFIG.hypeMult);
});

test('training stalls without energy for compute', () => {
  const s = fresh();
  Object.assign(s, { money: 1000, energy: 20 });
  s.owned.gpus = 4;
  assert.equal(G.levelUp(s), true);
  assert.equal(s.energy, 0);
  run(s, 20, 1);
  assert.ok(s.training && s.training.progress < 0.1, 'no progress while compute is starved');
});

test('running hot boosts output; overheating halts compute, wipes work and fails training', () => {
  const s = fresh();
  Object.assign(s, { level: 5, energy: 1e6, money: 1e6, algorithms: 1000, llms: 1000 });
  s.owned.gpus = 6;
  const cool = G.outputMult(s);
  s.heat = 80;
  assert.ok(G.outputMult(s) > cool * 1.3, 'hot hardware produces more');
  s.owned.clusters = 50;
  s.training = { progress: 0, duration: 14, money: 100, energy: 0 };
  run(s, 30, 1);
  assert.ok(s.stats.overheats >= 1);
  assert.equal(s.stats.failedRuns, 1);
  assert.ok(s.llms < 1000 + 1000, 'overheating destroys some LLMs');
});

test('cooling dial trades heat for output', () => {
  const s = fresh();
  Object.assign(s, { level: 5, energy: 1e6 });
  s.owned.gpus = 6;
  s.owned.coolers = 2;
  G.setCooling(s, 1);
  run(s, 30, 1);
  const cold = s.heat;
  G.setCooling(s, 0);
  run(s, 30, 1);
  assert.ok(s.heat > cold + 20);
});

test('events are seeded: same seed, same schedule', () => {
  const a = G.createState('daily'), b = G.createState('daily'), c = G.createState('other');
  for (const s of [a, b, c]) { G.click(s); run(s, 300, 1); }
  const kinds = (s) => s.events.filter((e) => e.event).map((e) => e.event + Math.round(e.t)).join();
  assert.equal(kinds(a), kinds(b));
  assert.notEqual(kinds(a), kinds(c));
  assert.ok(kinds(a).length > 0);
});

test('completing the final mission at level 10 wins', () => {
  const s = fresh();
  Object.assign(s, { level: 10, energy: 1e7, llms: 1e6, money: 1e9 });
  s.owned.orbitals = 2;
  s.owned.superpods = 40;
  assert.equal(G.levelUp(s), true);
  run(s, G.CONFIG.trainFinal + 1, 1);
  assert.equal(s.status, 'won');
});

test('balance: a competent bot wins, a slow one mostly does not', () => {
  assert.equal(playGame(4, { seed: 'seed0' }).status, 'won');
  assert.equal(playGame(6, { seed: 'seed1' }).status, 'won');
  assert.equal(playGame(1, { seed: 'seed0' }).status, 'lost', 'too easy if 1 click/s wins');
});
