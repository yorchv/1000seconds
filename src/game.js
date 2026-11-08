/*
 * 1000 Seconds to AGI — core game logic.
 *
 * Pure state + actions, no DOM. Runs in the browser (exposed as window.AGIGame)
 * and in Node (module.exports) so the balance simulator can drive it headless.
 *
 * Fixed rules: a run lasts 1000 seconds, and 10 seconds without a manual click loses.
 */
(function (root) {
  'use strict';

  const CONFIG = {
    duration: 1000,            // seconds in a run
    idleLimit: 10,             // seconds allowed without a manual click
    algosPerLLM: 20,           // every 20 algorithms compile into one LLM
    inflationPerSecond: 0.0013, // money prices grow linearly: ×2.3 by the end
    llmLevel: 4,               // LLM compiler switches on
    heatLevel: 5,              // hardware starts making heat
    licenseLevel: 4,           // LLMs earn licensing revenue
    apiLevel: 7,               // API launch: licensing ×4
    apiMult: 4,
    safetyLevel: 8,            // overheats stop wiping work, cooling +25%
    discountLevel: 9,          // compute hardware 20% off
    autoClickRate: 1,          // pitches/sec per sales bot
    licenseRate: 0.05,         // $/sec per LLM held
    baseSlots: 6,              // rack slots in the market stall you start with
    // Heat: heat% eases toward 100 × heatOutput / cooling (time constant heatTau).
    passiveCooling: 2,
    heatTau: 5,
    overheatResume: 60,        // compute restarts once heat falls to this %
    runHotBonus: 0.5,          // output × (1 + 0.5 × heat%)
    overheatAlgoLoss: 0.25,    // overheating wipes 25% of algorithms…
    overheatLlmLoss: 0.05,     // …and 5% of LLMs (before the safety perk)
    optimizationBonus: 0.5,    // +50% output per kernel optimization
    // Charged pitch: waiting between pitches adds passive income × factor × w² / full.
    chargeFactor: 0.6,
    chargeFull: 8,
    // Overclock: every pitch adds to a gauge that decays; it boosts output and heat.
    ocPerClick: 0.25,
    ocDecay: 0.35,
    ocMax: 3,
    ocOutput: 0.2,
    ocHeat: 0.3,
    // Hype after each promotion: pitches pay ×5.
    hypeDuration: 10,
    hypeMult: 5,
    // Training runs (level-ups) take time and need your compute running.
    trainBase: 4,
    trainPerLevel: 2,
    trainFinal: 30,
    trainFailRefund: 0.5,
    // Seeded market events, announced ahead of time.
    eventWarn: 5,
    firstEvent: 50,
    eventGapMin: 60,
    eventGapMax: 95,
  };

  // Ten careers. You climb from a market stall in Taipei to orbit.
  const LEVELS = [
    { name: 'Back-Alley GPU Renter', where: 'Guang Hua Market, Taipei', click: 1,
      tagline: 'Three used GPUs, a folding table and a very long extension cord.',
      intro: 'Pitch investors for cash. Buy grid energy and GPUs. GPUs burn energy into algorithms.' },
    { name: 'Rig Flipper', where: 'Sanchong, New Taipei', click: 2,
      tagline: 'Ex-mining rigs, bought by the pallet.',
      intro: 'Sales bots pitch for you. Rent a garage for more rack space.' },
    { name: 'Garage Lab', where: 'Hsinchu', click: 4,
      tagline: 'Two founders, one garage, a 200-amp breaker.',
      intro: 'Diesel generators make energy on their own, for an upkeep fee.' },
    { name: 'Seed-Stage Startup', where: 'San Francisco', click: 5,
      tagline: 'The demo went viral. The servers did not survive.',
      intro: 'LLM compiler online: every 20 algorithms become an LLM, and every LLM you hold earns licensing revenue. GPU clusters pack 10× compute into 4 racks.' },
    { name: 'Unicorn', where: 'Mission District', click: 8,
      tagline: 'A billion-dollar valuation and no revenue.',
      intro: 'Hardware now makes heat. Running hot boosts output, but overheating wipes work. Data centers bring racks, on-site generators and cooling.' },
    { name: 'Neolab', where: 'Hayes Valley', click: 12,
      tagline: 'A manifesto, a waitlist and a very large seed round.',
      intro: 'Kernel optimizations (+50% output each). Solar farms: free energy with no upkeep.' },
    { name: 'Sam Altman', where: 'The Pioneer Building', click: 18,
      tagline: 'Raise seven trillion. Lowercase everything.',
      intro: 'API launch: licensing revenue ×4. Hyperscale campuses unlocked.' },
    { name: 'Dario Amodei', where: 'Somewhere responsible', click: 26,
      tagline: 'Safety first. Scale anyway.',
      intro: 'Responsible scaling: overheats no longer wipe your work, and cooling is 25% stronger.' },
    { name: 'Jensen Huang', where: 'Santa Clara', click: 38,
      tagline: 'The more you buy, the more you save.',
      intro: 'Superpods unlocked, and all compute hardware is 20% off. Leather jacket included.' },
    { name: 'Elon Musk', where: 'Low Earth Orbit', click: 55,
      tagline: 'Hyper mega boss. Data centers, but in space.',
      intro: 'Orbital data centers: huge rack space, endless solar, free cooling in vacuum. Final mission: train the orbital superintelligence.' },
  ];

  // REQUIREMENTS[i] = the training run that promotes you out of level i+1.
  // compute/llms are thresholds; money and energy are paid when training starts.
  // The last entry is the final mission: completing it wins the game.
  const REQUIREMENTS = [
    { compute: 4,    llms: 0,     energy: 20,     money: 30 },
    { compute: 12,   llms: 0,     energy: 80,     money: 180 },
    { compute: 28,   llms: 0,     energy: 220,    money: 700 },
    { compute: 60,   llms: 100,   energy: 600,    money: 1100 },
    { compute: 120,  llms: 600,   energy: 1500,   money: 3200 },
    { compute: 220,  llms: 2000,  energy: 3500,   money: 8000 },
    { compute: 400,  llms: 6000,  energy: 8000,   money: 20000 },
    { compute: 700,  llms: 14000, energy: 18000,  money: 43000 },
    { compute: 1200, llms: 30000, energy: 40000,  money: 72000 },
    { compute: 2000, llms: 60000, energy: 80000,  money: 135000 },
  ];
  const FINAL_MISSION = 'Orbital Superintelligence';

  // Shop. Cost of the n-th unit = baseCost × growth^n × inflation (× event/perk modifiers).
  //   uses     rack slots taken (compute hardware)   slots   rack slots provided (sites)
  //   compute  counts toward requirements            power   energy/sec produced
  //   energy   energy/sec consumed                   upkeep  $/sec
  //   algos    algorithms/sec produced               cooling heat/sec removed (scaled by the dial)
  //   heat     heat/sec produced (from level 5)
  const ITEMS = {
    energy:      { name: 'Grid Energy',      group: 'power',   unlock: 1, baseCost: 3, growth: 1, pack: 10,
                   desc: '+10 energy from the grid.' },
    gpus:        { name: 'GPU',              group: 'compute', unlock: 1, baseCost: 10, growth: 1.04,
                   uses: 1, compute: 1, energy: 0.5, algos: 1, heat: 0.3,
                   desc: '1 rack · 0.5 energy/s → 1 algorithm/s.' },
    autoClickers:{ name: 'Sales Bot',        group: 'growth',  unlock: 2, baseCost: 20, growth: 1.12,
                   desc: 'Pitches investors once a second.' },
    garages:     { name: 'Garage',           group: 'site',    unlock: 2, baseCost: 60, growth: 1.3,
                   slots: 8, desc: '+8 racks.' },
    generators:  { name: 'Diesel Generator', group: 'power',   unlock: 3, baseCost: 120, growth: 1.13,
                   power: 6, upkeep: 0.6, desc: '+6 energy/s for $0.60/s.' },
    clusters:    { name: 'GPU Cluster',      group: 'compute', unlock: 4, baseCost: 400, growth: 1.045,
                   uses: 4, compute: 10, energy: 3, algos: 10, heat: 2,
                   desc: '4 racks · 3 energy/s → 10 algorithms/s.' },
    coolers:     { name: 'Chiller',          group: 'cooling', unlock: 5, baseCost: 250, growth: 1.09,
                   cooling: 3, desc: 'Removes 3 heat/s.' },
    datacenters: { name: 'Data Center',      group: 'site',    unlock: 5, baseCost: 4000, growth: 1.3,
                   slots: 50, power: 25, upkeep: 4, cooling: 15,
                   desc: '+50 racks, on-site generators (+25 energy/s), cooling. $4/s.' },
    optimizations:{ name: 'Kernel Optimization', group: 'research', unlock: 6, baseCost: 3000, growth: 2.6,
                   desc: '+50% output from all compute.' },
    solar:       { name: 'Solar Farm',       group: 'power',   unlock: 6, baseCost: 6000, growth: 1.12,
                   power: 40, desc: '+40 energy/s. No upkeep.' },
    campuses:    { name: 'Hyperscale Campus', group: 'site',   unlock: 7, baseCost: 50000, growth: 1.3,
                   slots: 250, power: 150, upkeep: 20, cooling: 90,
                   desc: 'A cluster of data centers. +250 racks, +150 energy/s, cooling. $20/s.' },
    superpods:   { name: 'Superpod',         group: 'compute', unlock: 9, baseCost: 15000, growth: 1.05,
                   uses: 12, compute: 60, energy: 12, algos: 60, heat: 8,
                   desc: '12 racks · 12 energy/s → 60 algorithms/s.' },
    orbitals:    { name: 'Orbital Data Center', group: 'site', unlock: 10, baseCost: 400000, growth: 1.35,
                   slots: 1200, power: 900, cooling: 700,
                   desc: 'Launched by rocket. +1200 racks, +900 solar energy/s, space cooling.' },
  };
  const ITEM_IDS = Object.keys(ITEMS);
  const COMPUTE_IDS = ITEM_IDS.filter((id) => ITEMS[id].group === 'compute');

  // Market events. Each lasts `dur` seconds once it lands; `min` is the earliest level it can roll at.
  const EVENTS = {
    frenzy:    { name: 'Investor frenzy',  min: 1, dur: 15, good: true,  desc: 'Your pitches pay ×3.' },
    viral:     { name: 'Demo goes viral',  min: 2, dur: 20, good: true,  desc: 'Sales bots earn ×2.' },
    shortage:  { name: 'GPU shortage',     min: 1, dur: 20, good: false, desc: 'Compute hardware costs ×1.8.' },
    brownout:  { name: 'Grid brownout',    min: 1, dur: 20, good: false, desc: 'Grid energy ×3 price, power output halved.' },
    hearing:   { name: 'Senate hearing',   min: 2, dur: 20, good: false, desc: 'Training runs paused.' },
    exportban: { name: 'Export controls',  min: 4, dur: 15, good: false, desc: 'Compute hardware can’t be bought.' },
    heatwave:  { name: 'Heatwave',         min: 5, dur: 25, good: false, desc: 'Cooling −40%.' },
    leak:      { name: 'Weights leaked',   min: 5, dur: 20, good: false, desc: 'Licensing revenue stops.' },
  };

  const MAX_LEVEL = LEVELS.length;

  // ---------- seeded randomness (same seed → same events) ----------
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rand(s) { // mulberry32
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function dailySeed(date) {
    const d = date || new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function createState(seed) {
    const owned = {};
    for (const id of ITEM_IDS) owned[id] = 0;
    const s = {
      status: 'ready',      // ready | playing | won | lost
      lossReason: null,     // 'idle' | 'time'
      seed: seed == null ? dailySeed() : String(seed),
      rng: 0,
      time: 0,
      lastClick: 0,
      level: 1,
      money: 0,
      energy: 0,
      algorithms: 0,
      llms: 0,
      heat: 0,
      heatTarget: 0,
      overheated: false,
      cooling: 1,           // cooling dial 0..1
      overclock: 0,
      hypeUntil: 0,
      owned: owned,
      training: null,       // { progress, duration, money, energy }
      nextEvent: null,      // { type, at, announced }
      effects: {},          // type → expiry time
      runFrac: 0,
      rates: { money: 0, energy: 0, algorithms: 0 },
      stats: { clicks: 0, moneyEarned: 0, llmsMade: 0, overheats: 0, failedRuns: 0, bestCharge: 0, levelTimes: [0] },
      events: [],
    };
    s.rng = hashSeed(s.seed);
    scheduleEvent(s, CONFIG.firstEvent);
    return s;
  }

  function emit(s, text, kind, extra) {
    const ev = { t: s.time, text: text, kind: kind || 'info' };
    if (extra) Object.assign(ev, extra);
    s.events.push(ev);
  }

  function start(s) {
    if (s.status !== 'ready') return;
    s.status = 'playing';
    s.lastClick = s.time;
    emit(s, LEVELS[0].name + ' — ' + LEVELS[0].intro, 'level', { level: 1 });
  }

  // ---------- derived values ----------
  function inflation(s) { return 1 + s.time * CONFIG.inflationPerSecond; }
  function effect(s, type) { return (s.effects[type] || 0) > s.time; }
  function isUnlocked(s, id) { return s.level >= ITEMS[id].unlock; }
  function hyped(s) { return s.hypeUntil > s.time; }

  function baseClick(s) { return LEVELS[s.level - 1].click; }

  // What a manual pitch pays before charge (hype and frenzy only boost your own pitches).
  function clickValue(s) {
    let v = baseClick(s);
    if (hyped(s)) v *= CONFIG.hypeMult;
    if (effect(s, 'frenzy')) v *= 3;
    return v;
  }

  // Money per second that doesn't need you: sales bots + licensing.
  function passiveIncome(s) {
    let bots = s.owned.autoClickers * CONFIG.autoClickRate * baseClick(s);
    if (effect(s, 'viral')) bots *= 2;
    let lic = s.level >= CONFIG.licenseLevel && !effect(s, 'leak') ? s.llms * CONFIG.licenseRate : 0;
    if (s.level >= CONFIG.apiLevel) lic *= CONFIG.apiMult;
    return bots + lic;
  }

  // Bonus a pitch would earn right now for having waited.
  function charge(s) {
    if (s.status !== 'playing') return 0;
    const w = Math.min(s.time - s.lastClick, CONFIG.chargeFull);
    return passiveIncome(s) * CONFIG.chargeFactor * w * w / CONFIG.chargeFull;
  }

  function pitchValue(s) { return clickValue(s) + charge(s); }

  function slotsTotal(s) {
    let n = CONFIG.baseSlots;
    for (const id of ITEM_IDS) if (ITEMS[id].slots) n += s.owned[id] * ITEMS[id].slots;
    return n;
  }
  function slotsUsed(s) {
    let n = 0;
    for (const id of COMPUTE_IDS) n += s.owned[id] * ITEMS[id].uses;
    return n;
  }
  function computePower(s) {
    let n = 0;
    for (const id of COMPUTE_IDS) n += s.owned[id] * ITEMS[id].compute;
    return n;
  }

  function powerOutput(s) { // energy/sec from infrastructure, at full upkeep
    let p = 0;
    for (const id of ITEM_IDS) if (ITEMS[id].power) p += s.owned[id] * ITEMS[id].power;
    return effect(s, 'brownout') ? p * 0.5 : p;
  }
  function upkeep(s) {
    let u = 0;
    for (const id of ITEM_IDS) if (ITEMS[id].upkeep) u += s.owned[id] * ITEMS[id].upkeep;
    return u;
  }
  function coolingCapacity(s, dial) {
    let c = 0;
    for (const id of ITEM_IDS) if (ITEMS[id].cooling) c += s.owned[id] * ITEMS[id].cooling;
    c = CONFIG.passiveCooling + c * (dial == null ? s.cooling : dial);
    if (s.level >= CONFIG.safetyLevel) c *= 1.25;
    if (effect(s, 'heatwave')) c *= 0.6;
    return c;
  }
  function outputMult(s) {
    let m = 1 + s.owned.optimizations * CONFIG.optimizationBonus;
    m *= 1 + CONFIG.ocOutput * s.overclock;
    if (s.level >= CONFIG.heatLevel && !s.overheated) m *= 1 + CONFIG.runHotBonus * s.heat / 100;
    return m;
  }
  function computeStats(s) { // raw per-second figures at full power
    let energy = 0, algos = 0, heat = 0;
    for (const id of COMPUTE_IDS) {
      const it = ITEMS[id], n = s.owned[id];
      energy += n * it.energy; algos += n * it.algos; heat += n * it.heat;
    }
    return { energy, algos, heat: heat * (1 + CONFIG.ocHeat * s.overclock) };
  }

  // ---------- shop ----------
  function priceMult(s, id) {
    let m = inflation(s);
    if (ITEMS[id].group === 'compute') {
      if (effect(s, 'shortage')) m *= 1.8;
      if (s.level >= CONFIG.discountLevel) m *= 0.8;
    }
    if (id === 'energy' && effect(s, 'brownout')) m *= 3;
    return m;
  }

  // Total money to buy `qty` more units of an item.
  function cost(s, id, qty) {
    qty = qty || 1;
    const item = ITEMS[id];
    const n = id === 'energy' ? 0 : s.owned[id];
    const g = item.growth;
    const series = g === 1 ? qty : Math.pow(g, n) * (Math.pow(g, qty) - 1) / (g - 1);
    return item.baseCost * series * priceMult(s, id);
  }

  // Why an item can't be bought right now (null if it can).
  function blocker(s, id, qty) {
    qty = qty || 1;
    const item = ITEMS[id];
    if (!isUnlocked(s, id)) return 'locked';
    if (item.group === 'compute') {
      if (effect(s, 'exportban')) return 'export';
      if (slotsUsed(s) + item.uses * qty > slotsTotal(s)) return 'racks';
    }
    if (s.money < cost(s, id, qty) - 1e-9) return 'money';
    return null;
  }
  function canAfford(s, id, qty) { return blocker(s, id, qty) === null; }

  function maxAffordable(s, id) {
    if (!isUnlocked(s, id)) return 0;
    let hi = 1;
    while (canAfford(s, id, hi) && hi < 1e6) hi *= 2;
    let lo = hi === 1 ? 0 : hi / 2;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (canAfford(s, id, mid)) lo = mid; else hi = mid;
    }
    return canAfford(s, id, hi) ? hi : lo;
  }

  function buy(s, id, qty) {
    qty = qty || 1;
    if (s.status !== 'playing' || !ITEMS[id] || qty < 1) return false;
    if (!canAfford(s, id, qty)) return false;
    s.money = Math.max(0, s.money - cost(s, id, qty));
    if (id === 'energy') s.energy += qty * ITEMS.energy.pack;
    else s.owned[id] += qty;
    return true;
  }

  function setCooling(s, v) { s.cooling = Math.max(0, Math.min(1, v)); }

  // ---------- pitching ----------
  function click(s) {
    if (s.status === 'ready') start(s);
    if (s.status !== 'playing') return 0;
    const ch = charge(s);
    const v = clickValue(s) + ch;
    s.money += v;
    s.stats.moneyEarned += v;
    s.stats.clicks++;
    if (ch > s.stats.bestCharge) s.stats.bestCharge = ch;
    s.lastClick = s.time;
    s.overclock = Math.min(CONFIG.ocMax, s.overclock + CONFIG.ocPerClick);
    return v;
  }

  // ---------- training runs (level-ups) ----------
  function requirements(s) { return s.level <= MAX_LEVEL ? REQUIREMENTS[s.level - 1] : null; }

  function trainDuration(level) {
    return level >= MAX_LEVEL ? CONFIG.trainFinal : CONFIG.trainBase + CONFIG.trainPerLevel * level;
  }

  function levelChecks(s) {
    const r = requirements(s);
    if (!r) return null;
    const money = r.money * inflation(s);
    return {
      compute: { have: computePower(s), need: r.compute, ok: computePower(s) >= r.compute },
      llms:    { have: s.llms,   need: r.llms,   ok: s.llms >= r.llms },
      energy:  { have: s.energy, need: r.energy, ok: s.energy >= r.energy - 1e-9 },
      money:   { have: s.money,  need: money,    ok: s.money >= money - 1e-9 },
    };
  }

  function canLevelUp(s) {
    const c = levelChecks(s);
    return !!c && s.status === 'playing' && !s.training &&
      c.compute.ok && c.llms.ok && c.energy.ok && c.money.ok;
  }

  // Starts the training run that promotes you. Returns true if it started.
  function levelUp(s) {
    if (!canLevelUp(s)) return false;
    const r = requirements(s);
    const money = r.money * inflation(s);
    s.money = Math.max(0, s.money - money);
    s.energy = Math.max(0, s.energy - r.energy);
    s.training = { progress: 0, duration: trainDuration(s.level), money: money, energy: r.energy };
    const target = s.level >= MAX_LEVEL ? FINAL_MISSION : LEVELS[s.level].name;
    emit(s, 'Training run started → ' + target + '. Keep compute fed and don’t overheat.', 'train');
    return true;
  }

  function finishTraining(s) {
    s.training = null;
    s.stats.levelTimes.push(s.time);
    if (s.level >= MAX_LEVEL) {
      s.status = 'won';
      emit(s, FINAL_MISSION + ' online at ' + s.time.toFixed(1) + 's. Beyond AGI.', 'win');
      return;
    }
    s.level++;
    s.hypeUntil = s.time + CONFIG.hypeDuration;
    const info = LEVELS[s.level - 1];
    emit(s, 'You are now ' + info.name + '. ' + info.intro, 'level', { level: s.level });
  }

  function failTraining(s, why) {
    const t = s.training;
    s.training = null;
    s.stats.failedRuns++;
    s.money += t.money * CONFIG.trainFailRefund;
    emit(s, 'Training run failed: ' + why + '. Half the fee refunded.', 'warn');
  }

  // ---------- events ----------
  function scheduleEvent(s, at) {
    s.nextEvent = { type: null, at: at, announced: false };
  }

  function rollEvent(s) {
    const pool = Object.keys(EVENTS).filter((k) => EVENTS[k].min <= s.level && !effect(s, k));
    return pool[Math.floor(rand(s) * pool.length)];
  }

  function updateEvents(s) {
    const ne = s.nextEvent;
    if (!ne) return;
    if (!ne.announced && s.time >= ne.at - CONFIG.eventWarn) {
      ne.type = rollEvent(s);
      ne.announced = true;
      const e = EVENTS[ne.type];
      emit(s, 'Incoming in ' + CONFIG.eventWarn + 's: ' + e.name + ' — ' + e.desc, 'eventwarn', { event: ne.type });
    }
    if (ne.announced && s.time >= ne.at) {
      const e = EVENTS[ne.type];
      s.effects[ne.type] = s.time + e.dur;
      emit(s, e.name + '! ' + e.desc + ' (' + e.dur + 's)', e.good ? 'eventgood' : 'eventbad', { event: ne.type });
      const gap = CONFIG.eventGapMin + rand(s) * (CONFIG.eventGapMax - CONFIG.eventGapMin);
      scheduleEvent(s, s.time + gap);
    }
  }

  function activeEffects(s) {
    const out = [];
    for (const k in s.effects) if (s.effects[k] > s.time) out.push({ type: k, left: s.effects[k] - s.time, info: EVENTS[k] });
    return out;
  }

  // ---------- simulation ----------
  function lose(s, reason) {
    s.status = 'lost';
    s.lossReason = reason;
    emit(s, reason === 'idle'
      ? 'You stopped pitching for 10 seconds. The investors walked out.'
      : 'Time is up. Someone else got there first.', 'loss');
  }

  function tick(s, dt) {
    if (s.status !== 'playing') return;
    dt = Math.min(dt, CONFIG.duration - s.time);
    s.time += dt;

    const before = { money: s.money, energy: s.energy, algorithms: s.algorithms + s.llms * CONFIG.algosPerLLM };

    updateEvents(s);

    // Passive income
    const inc = passiveIncome(s) * dt;
    s.money += inc;
    s.stats.moneyEarned += inc;

    // Infrastructure: pay upkeep, produce energy (partial if you can't pay in full)
    const up = upkeep(s) * dt;
    const frac = up > 0 ? Math.min(1, s.money / up) : 1;
    s.money -= up * frac;
    s.energy += powerOutput(s) * dt * frac;

    // Overclock gauge decays toward zero
    s.overclock = Math.max(0, s.overclock - s.overclock * CONFIG.ocDecay * dt);

    // Compute burns energy into algorithms
    const cs = computeStats(s);
    let runFrac = 0;
    if (!s.overheated && cs.energy > 0) {
      runFrac = Math.min(1, s.energy / (cs.energy * dt));
      s.energy -= cs.energy * dt * runFrac;
      s.algorithms += cs.algos * outputMult(s) * dt * runFrac;
    }
    s.runFrac = runFrac;

    // Heat eases toward the ratio of heat output to cooling
    if (s.level >= CONFIG.heatLevel) {
      s.heatTarget = 100 * cs.heat * (s.overheated ? 0 : 1) / coolingCapacity(s);
      s.heat += (s.heatTarget - s.heat) * Math.min(1, dt / CONFIG.heatTau);
      s.heat = Math.max(0, Math.min(100, s.heat));
      if (!s.overheated && s.heat >= 100) {
        s.overheated = true;
        s.stats.overheats++;
        if (s.level < CONFIG.safetyLevel) {
          s.algorithms *= 1 - CONFIG.overheatAlgoLoss;
          s.llms = Math.floor(s.llms * (1 - CONFIG.overheatLlmLoss));
          emit(s, 'OVERHEAT! Lost 25% of algorithms and 5% of LLMs. Compute halted until ' + CONFIG.overheatResume + '%.', 'warn');
        } else {
          emit(s, 'OVERHEAT! Compute halted until ' + CONFIG.overheatResume + '%.', 'warn');
        }
        if (s.training) failTraining(s, 'the cluster overheated');
      } else if (s.overheated && s.heat <= CONFIG.overheatResume) {
        s.overheated = false;
        emit(s, 'Systems cooled. Compute back online.', 'info');
      }
    }

    // LLM compilation
    if (s.level >= CONFIG.llmLevel && s.algorithms >= CONFIG.algosPerLLM) {
      const made = Math.floor(s.algorithms / CONFIG.algosPerLLM);
      s.llms += made;
      s.algorithms -= made * CONFIG.algosPerLLM;
      s.stats.llmsMade += made;
    }

    // Training progresses only while compute runs
    if (s.training && !effect(s, 'hearing')) {
      s.training.progress += dt * runFrac;
      if (s.training.progress >= s.training.duration) finishTraining(s);
    }

    // Smoothed per-second rates for the UI
    if (dt > 0) {
      const k = Math.min(1, dt * 2);
      const r = s.rates;
      r.money += ((s.money - before.money) / dt - r.money) * k;
      r.energy += ((s.energy - before.energy) / dt - r.energy) * k;
      r.algorithms += ((s.algorithms + s.llms * CONFIG.algosPerLLM - before.algorithms) / dt - r.algorithms) * k;
    }

    if (s.status !== 'playing') return;
    if (s.time - s.lastClick >= CONFIG.idleLimit) lose(s, 'idle');
    else if (s.time >= CONFIG.duration) lose(s, 'time');
  }

  const api = {
    CONFIG, LEVELS, REQUIREMENTS, ITEMS, ITEM_IDS, COMPUTE_IDS, EVENTS, MAX_LEVEL, FINAL_MISSION,
    createState, dailySeed, start, tick, click, buy, cost, blocker, canAfford, maxAffordable, setCooling,
    isUnlocked, inflation, effect, activeEffects, hyped, baseClick, clickValue, passiveIncome, charge, pitchValue,
    slotsTotal, slotsUsed, computePower, powerOutput, upkeep, coolingCapacity, outputMult, computeStats,
    requirements, trainDuration, levelChecks, canLevelUp, levelUp,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AGIGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
