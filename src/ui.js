/* 1000 Seconds to AGI — DOM layer. Game rules live in game.js, sound in sound.js. */
(function () {
  'use strict';
  const G = window.AGIGame;
  const S = window.AGISound;
  const $ = (id) => document.getElementById(id);
  const BEST_KEY = 'agi1000.best';
  const SOUND_KEY = 'agi1000.sound';

  // localStorage throws in sandboxed iframes and some privacy modes; the game must not depend on it.
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* preference just won't persist */ } },
  };

  const DIAL = [{ v: 0, l: 'Off' }, { v: 0.25, l: '25' }, { v: 0.5, l: '50' }, { v: 0.75, l: '75' }, { v: 1, l: 'Max' }];
  const SITE_IDS = ['garages', 'datacenters', 'campuses', 'orbitals'];
  // Per-level artwork (scripts/generate-art.py). Missing files just hide themselves.
  const ART_V = 2; // bump when the art in assets/levels changes
  const art = (key) => `assets/levels/${key}.jpg?v=${ART_V}`;
  const img = (key, cls) => `<img class="${cls}" src="${art(key)}" alt="" decoding="async" onerror="this.remove()">`;
  function preload(key) { const i = new Image(); i.src = art(key); }
  // One-line stats for the compact phone shop tiles; the full desc stays in the tooltip and on desktop.
  const SHORT = {
    energy: '+10 energy', gpus: '1 rack → 1 algo/s', autoClickers: 'Pitches 1×/s', garages: '+8 racks',
    generators: '+6 energy/s', clusters: '4 racks → 10 algo/s', coolers: '−3 heat/s', datacenters: '+50 racks · power',
    optimizations: '+50% output', solar: '+40 energy/s', campuses: '+250 racks · power', superpods: '12 racks → 60 algo/s',
    orbitals: '+1200 racks · solar',
  };
  const GRILLE_DOTS = 60;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state;
  let qtyMode = '1';
  let lastFrame = 0;
  let endShown = false;
  let shownLevel = 0;
  let lastLeftWhole = 10;
  let lastBeat = 0;
  let streak = 0;
  let lastPitchAt = -1;
  let milestones;
  const newUntil = {};
  const els = {};

  // ---------- formatting ----------
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a < 10) return (Math.floor(n * 10) / 10).toString();
    if (a < 1000) return Math.floor(n).toString();
    const units = ['K', 'M', 'B', 'T', 'Qa'];
    let u = -1;
    let v = n;
    while (Math.abs(v) >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    return (Math.abs(v) < 100 ? v.toFixed(1) : Math.floor(v).toString()) + units[u];
  }
  const money = (n) => '$' + fmt(n);
  function rate(n, prefix) {
    if (Math.abs(n) < 0.05) return '';
    return (n > 0 ? '+' : '−') + (prefix || '') + fmt(Math.abs(n)) + '/s';
  }
  function setText(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  function setHTML(el, v) { if (el._h !== v) { el._h = v; el.innerHTML = v; } }
  function setClass(el, cls, on) { if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- static DOM ----------
  const CHIPS = [
    { id: 'money', label: 'Money' },
    { id: 'energy', label: 'Energy' },
    { id: 'racks', label: 'Racks' },
    { id: 'llms', label: 'LLMs' },
    { id: 'heat', label: 'Heat' },
  ];

  function build() {
    const chips = $('chips');
    chips.innerHTML = '';
    for (const c of CHIPS) {
      const d = document.createElement('div');
      d.className = 'chip';
      d.innerHTML = `<span class="chip-l">${c.label}</span><span class="chip-v"></span><span class="chip-r"></span>`;
      chips.appendChild(d);
      els['chip-' + c.id] = { box: d, l: d.querySelector('.chip-l'), v: d.querySelector('.chip-v'), r: d.querySelector('.chip-r') };
    }

    const reqs = $('reqs');
    reqs.innerHTML = '';
    for (const k of ['compute', 'llms', 'energy', 'money']) {
      const d = document.createElement('div');
      d.className = 'req';
      d.innerHTML = `<div class="req-row"><span>${{ compute: 'Compute', llms: 'LLMs', energy: 'Energy', money: 'Fee' }[k]}</span><span></span></div><div class="bar"><div class="bar-fill"></div></div>`;
      reqs.appendChild(d);
      els['req-' + k] = { box: d, v: d.querySelector('.req-row span:last-child'), fill: d.querySelector('.bar-fill') };
    }

    const grille = $('grille');
    grille.innerHTML = '';
    els.dots = [];
    for (let i = 0; i < GRILLE_DOTS; i++) { const dot = document.createElement('i'); grille.appendChild(dot); els.dots.push(dot); }

    const fs = $('fac-stats');
    fs.innerHTML = '';
    for (const k of ['racks', 'power', 'output', 'upkeep']) {
      const d = document.createElement('div');
      d.className = 'fs';
      d.innerHTML = `<span>${{ racks: 'Racks', power: 'Power', output: 'Output', upkeep: 'Upkeep' }[k]}</span><b></b>`;
      fs.appendChild(d);
      els['fs-' + k] = { box: d, v: d.querySelector('b') };
    }

    const dial = $('dial');
    dial.innerHTML = '';
    els.dial = DIAL.map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d.l;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { G.setCooling(state, d.v); S.buy(); });
      dial.appendChild(b);
      return b;
    });

    buildShop();
    buildRoad();
    for (const k of ['clock', 'timebar', 'top', 'banner', 'persona', 'train', 'train-main', 'train-sub', 'trainbar', 'train-label',
      'train-pct', 'train-fill', 'sites', 'thermal', 'heat-text', 'heat-fill', 'infl', 'thumb', 'ring', 'pitch', 'pitch-v',
      'charge-val', 'charge-fill', 'g-charge', 'oc-val', 'oc-fill', 'attn-val', 'floaters', 'log', 'vignette', 'watermark',
      'road', 'shop']) els[k] = $(k);
  }

  function buildShop() {
    const shop = $('shop');
    shop.innerHTML = '';
    for (const id of G.ITEM_IDS) {
      const item = G.ITEMS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      btn.dataset.id = id;
      btn.title = item.desc;
      btn.innerHTML =
        `<span class="item-key"></span>` +
        `<span class="item-main"><span class="item-name">${esc(item.name)}<span class="item-own"></span></span>` +
        `<span class="item-desc">${esc(item.desc)}</span><span class="item-short">${esc(SHORT[id] || '')}</span></span>` +
        `<span class="item-buy"><span class="item-cost"></span><span class="item-sub"></span></span>`;
      btn.addEventListener('click', () => buyItem(id));
      shop.appendChild(btn);
      els['item-' + id] = { btn, key: btn.querySelector('.item-key'), own: btn.querySelector('.item-own'),
        cost: btn.querySelector('.item-cost'), sub: btn.querySelector('.item-sub') };
    }
  }

  function buildRoad() {
    const road = $('road');
    road.innerHTML = '';
    G.LEVELS.forEach((l, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="n">${pad2(i + 1)}</span><span>${esc(l.name)}</span><span class="t"></span>`;
      road.appendChild(li);
    });
    const fin = document.createElement('li');
    fin.className = 'final';
    fin.innerHTML = `<span class="n">→</span><span>${esc(G.FINAL_MISSION)}</span><span class="t">win</span>`;
    road.appendChild(fin);
  }

  // ---------- actions ----------
  function pitch() {
    S.unlock();
    const wasReady = state.status === 'ready';
    const ch = G.charge(state);
    const v = G.click(state);
    if (!v) return;
    if (wasReady) closeOverlay();
    const now = state.time;
    streak = lastPitchAt >= 0 && now - lastPitchAt < 0.6 ? streak + 1 : 0;
    lastPitchAt = now;
    const charged = ch > G.clickValue(state) * 2 && ch > 1;
    S.pitch(streak, charged);
    if (charged && navigator.vibrate) navigator.vibrate(15);
    floatText('+' + money(v), charged);
    const c = els['chip-money'].box;
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
    render();
  }

  function floatText(text, big) {
    if (els.floaters.childElementCount > 10) els.floaters.firstElementChild.remove();
    const f = document.createElement('span');
    f.className = 'floater' + (big ? ' big' : '');
    f.textContent = text;
    f.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 70) + 'px');
    f.style.top = (25 + Math.random() * 25) + '%';
    els.floaters.appendChild(f);
    setTimeout(() => f.remove(), 950);
  }

  function qtyFor(id) {
    if (qtyMode === 'max') return Math.max(1, G.maxAffordable(state, id));
    return Number(qtyMode);
  }

  function buyItem(id) {
    if (state.status !== 'playing') return;
    const q = qtyFor(id);
    if (G.buy(state, id, q)) { S.buy(); delete newUntil[id]; render(); }
    else S.deny();
  }

  function train() {
    if (G.levelUp(state)) { S.train(); render(); }
  }

  function setQty(mode) {
    qtyMode = mode;
    document.querySelectorAll('#qty button').forEach((b) => b.classList.toggle('on', b.dataset.qty === mode));
  }

  function toggleSound() {
    S.setEnabled(!S.enabled);
    store.set(SOUND_KEY, S.enabled ? '1' : '0');
    const b = $('sound');
    b.setAttribute('aria-pressed', S.enabled ? 'true' : 'false');
    b.setAttribute('aria-label', S.enabled ? 'Sound on' : 'Sound off');
    if (S.enabled) S.buy();
  }

  // ---------- render ----------
  function render() {
    const s = state;
    const playing = s.status === 'playing';
    const remaining = G.CONFIG.duration - s.time;

    // Clock
    setText(els.clock, remaining.toFixed(1));
    setClass(els.clock.parentNode, 'low', remaining < 100);
    setClass(els.clock.parentNode, 'crit', remaining < 10);
    setClass(els.top, 'low', remaining < 100);
    els.timebar.style.width = (remaining / G.CONFIG.duration * 100) + '%';
    setText(els.watermark, playing && remaining < 10 ? Math.ceil(remaining).toString() : '');

    renderChips(s);
    renderBanner(s);
    renderCareer(s);
    renderFacility(s);
    renderShop(s);
    renderThumb(s, playing);

    // Alarm layers
    const left = G.CONFIG.idleLimit - (s.time - s.lastClick);
    setClass(document.body, 'alarm-idle', playing && left < 3);
    setClass(document.body, 'alarm-time', playing && remaining < 100);
  }

  function renderChips(s) {
    const c = els;
    setText(c['chip-money'].v, money(s.money));
    setText(c['chip-money'].r, rate(s.rates.money, '$'));
    setClass(c['chip-money'].r, 'neg', s.rates.money < -0.05);

    const cs = G.computeStats(s);
    const starving = s.status === 'playing' && cs.energy > 0 && s.runFrac < 0.99 && !s.overheated;
    setText(c['chip-energy'].v, fmt(s.energy));
    setText(c['chip-energy'].r, starving ? 'Starved' : rate(s.rates.energy));
    setClass(c['chip-energy'].r, 'neg', !starving && s.rates.energy < -0.05);
    setClass(c['chip-energy'].box, 'warn', starving);

    const used = G.slotsUsed(s), total = G.slotsTotal(s);
    setText(c['chip-racks'].v, used + '/' + fmt(total));
    setText(c['chip-racks'].r, used >= total ? 'Full' : fmt(G.computePower(s)) + ' compute');
    setClass(c['chip-racks'].box, 'warn', used >= total && s.level >= 2);

    if (s.level >= G.CONFIG.llmLevel) {
      setText(c['chip-llms'].l, 'LLMs');
      setText(c['chip-llms'].v, fmt(s.llms));
      setText(c['chip-llms'].r, rate(s.rates.algorithms / G.CONFIG.algosPerLLM));
    } else {
      setText(c['chip-llms'].l, 'Algos');
      setText(c['chip-llms'].v, fmt(s.algorithms));
      setText(c['chip-llms'].r, rate(s.rates.algorithms));
    }

    if (s.level >= G.CONFIG.heatLevel) {
      setText(c['chip-heat'].v, Math.round(s.heat) + '%');
      setText(c['chip-heat'].r, s.overheated ? 'Overheat' : '+' + Math.round(G.CONFIG.runHotBonus * s.heat) + '% out');
      setClass(c['chip-heat'].box, 'warn', s.overheated || s.heat > 90);
    } else {
      setText(c['chip-heat'].v, '—');
      setText(c['chip-heat'].r, 'Lv 5');
    }
  }

  function renderBanner(s) {
    const parts = [];
    const ne = s.nextEvent;
    if (ne && ne.announced && ne.at > s.time) {
      const e = G.EVENTS[ne.type];
      parts.push(`<span class="ev soon ${e.good ? 'good' : ''}"><i class="dot"></i><b>In ${Math.ceil(ne.at - s.time)}s · ${esc(e.name)}</b> ${esc(e.desc)}</span>`);
    }
    if (G.hyped(s)) parts.push(`<span class="ev good"><i class="dot"></i><b>Hype ${Math.ceil(s.hypeUntil - s.time)}s</b> Pitches ×${G.CONFIG.hypeMult}</span>`);
    for (const e of G.activeEffects(s)) {
      parts.push(`<span class="ev ${e.info.good ? 'good' : ''}"><i class="dot"></i><b>${esc(e.info.name)} ${Math.ceil(e.left)}s</b> ${esc(e.info.desc)}</span>`);
    }
    const html = s.status === 'playing' ? parts.join('') : '';
    setHTML(els.banner, html);
    els.banner.hidden = !html;
  }

  function renderCareer(s) {
    if (shownLevel !== s.level) {
      shownLevel = s.level;
      const L = G.LEVELS[s.level - 1];
      els.persona.innerHTML =
        `<div class="p-num">${pad2(s.level)}<small>/10</small></div>` +
        `<div class="p-where">${esc(L.where)}</div>` +
        `<div class="p-name">${esc(L.name)}</div>` +
        `<div class="p-tag">${esc(L.tagline)}</div>` +
        img(s.level, 'p-img');
      preload(s.level < G.MAX_LEVEL ? s.level + 1 : 'win');
      const now = s.time;
      for (const id of G.ITEM_IDS) if (G.ITEMS[id].unlock === s.level && s.level > 1) newUntil[id] = now + 15;
      // Ladder
      [...els.road.children].forEach((li, i) => {
        if (i >= G.MAX_LEVEL) return;
        li.className = i + 1 < s.level ? 'done' : i + 1 === s.level ? 'cur' : '';
        const t = s.stats.levelTimes[i];
        li.querySelector('.t').textContent = i + 1 <= s.level && t != null && i > 0 ? t.toFixed(0) + 's' : '';
      });
    }

    const checks = G.levelChecks(s);
    const target = s.level >= G.MAX_LEVEL ? G.FINAL_MISSION : G.LEVELS[s.level].name;
    if (checks) {
      for (const k of ['compute', 'llms', 'energy', 'money']) {
        const c = checks[k], e = els['req-' + k];
        const show = k === 'money' ? money(c.have) + ' / ' + money(c.need) : fmt(c.have) + ' / ' + fmt(c.need);
        setText(e.v, c.need === 0 ? '—' : show);
        e.fill.style.width = (c.need === 0 ? 100 : Math.min(100, c.have / c.need * 100)) + '%';
        setClass(e.box, 'ok', c.ok);
      }
    }

    const tr = s.training;
    const can = G.canLevelUp(s);
    els.train.disabled = !can;
    setClass(els.train, 'ready', can);
    if (tr) {
      setText(els['train-main'], 'Training: ' + target);
      setText(els['train-sub'], 'Run in progress · keep pitching');
    } else if (can) {
      setText(els['train-main'], 'Train: ' + target);
      setText(els['train-sub'], G.trainDuration(s.level) + 's run · ' + money(checks.money.need) + ' + ' + fmt(checks.energy.need) + ' energy');
    } else if (checks) {
      const need = [];
      if (!checks.compute.ok) need.push(fmt(checks.compute.need - checks.compute.have) + ' more compute');
      if (!checks.llms.ok) need.push(fmt(checks.llms.need - checks.llms.have) + ' more LLMs');
      if (!checks.energy.ok) need.push(fmt(checks.energy.need - checks.energy.have) + ' energy');
      if (!checks.money.ok) need.push(money(checks.money.need - checks.money.have) + ' more');
      setText(els['train-main'], 'Next: ' + target);
      setText(els['train-sub'], 'Need ' + need.join(' · '));
    }

    els.trainbar.hidden = !tr;
    els.train.hidden = !!tr;
    if (tr) {
      const pct = Math.min(100, tr.progress / tr.duration * 100);
      els['train-fill'].style.width = pct + '%';
      let label = 'Training · ' + Math.max(0, tr.duration - tr.progress).toFixed(1) + 's left';
      let stalled = false;
      if (G.effect(s, 'hearing')) { label = 'Paused · Senate hearing'; stalled = true; }
      else if (s.runFrac < 0.99) { label = 'Stalled · compute starved for energy'; stalled = true; }
      setText(els['train-label'], label);
      setText(els['train-pct'], Math.floor(pct) + '%');
      setClass(els.trainbar, 'stalled', stalled);
    }
  }

  function renderFacility(s) {
    const used = G.slotsUsed(s), total = G.slotsTotal(s);
    const on = Math.round(Math.min(1, used / total) * GRILLE_DOTS);
    const hot = s.level >= G.CONFIG.heatLevel ? Math.round(Math.min(1, s.heat / 100) * on) : 0;
    for (let i = 0; i < GRILLE_DOTS; i++) {
      const d = els.dots[i];
      const cls = i >= on ? '' : s.overheated ? 'over' : i < hot && s.heat > 70 ? 'hot' : 'on';
      if (d._c !== cls) { d._c = cls; d.className = cls; }
    }
    const cs = G.computeStats(s);
    const power = G.powerOutput(s);
    setText(els['fs-racks'].v, used + ' / ' + fmt(total));
    setClass(els['fs-racks'].box, 'bad', used >= total && s.level >= 2);
    setText(els['fs-power'].v, '+' + fmt(power) + ' / −' + fmt(cs.energy));
    setClass(els['fs-power'].box, 'bad', power < cs.energy && s.energy < cs.energy * 3);
    setClass(els['fs-power'].box, 'good', power >= cs.energy && cs.energy > 0);
    setText(els['fs-output'].v, fmt(cs.algos * G.outputMult(s) * s.runFrac) + '/s ×' + G.outputMult(s).toFixed(2));
    setText(els['fs-upkeep'].v, money(G.upkeep(s)) + '/s');

    let sites = `<span class="site"><b>Stall</b> ${G.CONFIG.baseSlots}</span>`;
    for (const id of SITE_IDS) if (s.owned[id]) sites += `<span class="site"><b>${esc(G.ITEMS[id].name)}</b> ×${s.owned[id]}</span>`;
    for (const id of ['generators', 'solar', 'coolers']) if (s.owned[id]) sites += `<span class="site">${esc(G.ITEMS[id].name)} ×${s.owned[id]}</span>`;
    setHTML(els.sites, sites);

    const heatOn = s.level >= G.CONFIG.heatLevel;
    setClass(els.thermal, 'locked', !heatOn);
    els.dial.forEach((b, i) => {
      b.disabled = !heatOn;
      setClass(b, 'on', Math.abs(s.cooling - DIAL[i].v) < 0.01);
      b.setAttribute('aria-checked', Math.abs(s.cooling - DIAL[i].v) < 0.01 ? 'true' : 'false');
    });
    if (heatOn) {
      els['heat-fill'].style.width = s.heat + '%';
      const f = els['heat-fill'];
      setClass(f, 'over', s.overheated);
      setClass(f, 'hot', !s.overheated && s.heat >= 85);
      setClass(f, 'warm', !s.overheated && s.heat >= 60 && s.heat < 85);
      setText(els['heat-text'], s.overheated
        ? 'Overheat · cooling to ' + G.CONFIG.overheatResume + '%'
        : Math.round(s.heat) + '% → ' + Math.round(Math.min(999, s.heatTarget)) + '% · +' + Math.round(G.CONFIG.runHotBonus * s.heat) + '% output');
    } else {
      els['heat-fill'].style.width = '0%';
      setText(els['heat-text'], 'Locked · Level 5');
    }
  }

  function renderShop(s) {
    setText(els.infl, 'Inflation ×' + G.inflation(s).toFixed(2) + (G.effect(s, 'shortage') ? ' · GPU shortage ×1.8' : '') +
      (s.level >= G.CONFIG.discountLevel ? ' · Jensen discount −20% hardware' : ''));
    let key = 0;
    let lockedShown = 0;
    for (const id of G.ITEM_IDS) {
      const e = els['item-' + id];
      const item = G.ITEMS[id];
      const unlocked = G.isUnlocked(s, id);
      const visible = unlocked || lockedShown++ < 2;
      e.btn.hidden = !visible;
      if (!visible) continue;
      setClass(e.btn, 'locked', !unlocked);
      setClass(e.btn, 'new', !!newUntil[id] && newUntil[id] > s.time);
      if (!unlocked) {
        e.btn.disabled = true;
        setText(e.key, '');
        setText(e.own, '');
        setText(e.cost, '🔒');
        setText(e.sub, 'Lv ' + item.unlock + ' · ' + G.LEVELS[item.unlock - 1].name);
        e.btn.style.setProperty('--afford', '0%');
        continue;
      }
      key++;
      e.btn.dataset.key = key <= 9 ? String(key) : '';
      setText(e.key, key <= 9 ? String(key) : '');
      setText(e.own, id === 'energy' ? '' : ' ×' + s.owned[id]);
      let q = qtyMode === 'max' ? G.maxAffordable(s, id) : Number(qtyMode);
      const showQ = Math.max(1, q);
      const price = G.cost(s, id, showQ);
      const block = s.status === 'playing' ? G.blocker(s, id, showQ) : 'idle';
      e.btn.disabled = s.status !== 'playing';
      setClass(e.btn, 'can', !block);
      setClass(e.btn, 'blocked', block === 'racks' || block === 'export');
      setText(e.cost, money(price));
      let sub = '';
      if (block === 'racks') sub = 'Need racks';
      else if (block === 'export') sub = 'Export ban';
      else if (block === 'money') sub = Math.floor(Math.min(99, s.money / price * 100)) + '%';
      else if (!block) sub = qtyMode === '1' ? 'Buy' : 'Buy ×' + showQ;
      setText(e.sub, sub);
      e.btn.style.setProperty('--afford', Math.min(100, s.money / price * 100) + '%');
    }
  }

  function renderThumb(s, playing) {
    const left = playing ? Math.max(0, G.CONFIG.idleLimit - (s.time - s.lastClick)) : G.CONFIG.idleLimit;
    const frac = left / G.CONFIG.idleLimit;
    els.ring.style.strokeDashoffset = String(100 - frac * 100);
    els.thumb.style.setProperty('--attn', (frac * 100) + '%');
    setClass(els.thumb, 'warn', playing && left < 6 && left >= 3);
    setClass(els.thumb, 'crit', playing && left < 3);
    setText(els['attn-val'], s.status === 'ready' ? '—' : left.toFixed(1));
    setText(els['pitch-v'], '+' + money(G.pitchValue(s)));
    setClass(els.pitch, 'hype', G.hyped(s) || G.effect(s, 'frenzy'));

    const ch = G.charge(s);
    const w = playing ? Math.min(s.time - s.lastClick, G.CONFIG.chargeFull) : 0;
    setText(els['charge-val'], G.passiveIncome(s) > 0 ? '+' + money(ch) : 'needs passive income');
    els['charge-fill'].style.width = (G.passiveIncome(s) > 0 ? Math.pow(w / G.CONFIG.chargeFull, 2) * 100 : 0) + '%';
    setClass(els['g-charge'], 'full', w >= G.CONFIG.chargeFull * 0.75 && ch > 0);

    const oc = 1 + G.CONFIG.ocOutput * s.overclock;
    setText(els['oc-val'], '×' + oc.toFixed(2) + ' output');
    els['oc-fill'].style.width = (s.overclock / G.CONFIG.ocMax * 100) + '%';
  }

  // ---------- events → log, toasts, ceremony, sound ----------
  function drainEvents() {
    while (state.events.length) {
      const ev = state.events.shift();
      addLog(ev);
      switch (ev.kind) {
        case 'level':
          if (ev.level > 1) { ceremony(ev.level); S.level(); if (navigator.vibrate) navigator.vibrate([20, 40, 20]); }
          break;
        case 'train': toast('Training run started', 'train'); break;
        case 'warn': toast(ev.text, 'warn'); S.alarm(); if (navigator.vibrate) navigator.vibrate(120); break;
        case 'eventwarn': toast(ev.text, 'eventwarn'); S.event(false); break;
        case 'eventgood': toast(ev.text, 'eventgood'); S.event(true); break;
        case 'eventbad': toast(ev.text, 'eventbad'); S.event(false); break;
        case 'win': S.win(); break;
        case 'loss': S.lose(); break;
        default: break;
      }
    }
  }

  function addLog(ev) {
    const li = document.createElement('li');
    li.className = ev.kind;
    li.innerHTML = `<time>${ev.t.toFixed(0)}s</time><span>${esc(ev.text)}</span>`;
    els.log.prepend(li);
    while (els.log.childElementCount > 40) els.log.lastElementChild.remove();
  }

  function toast(text, kind) {
    const box = $('toasts');
    while (box.childElementCount >= 3) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function ceremony(level) {
    const L = G.LEVELS[level - 1];
    const box = $('ceremony');
    box.innerHTML = `<div class="cer">${img(level, 'cer-img')}<div class="cer-k">Level ${pad2(level)} · You are now</div>` +
      `<div class="cer-n">${esc(L.name)}</div><div class="cer-t">${esc(L.tagline)}</div>` +
      `<div class="cer-u">${esc(L.intro)}</div></div>`;
    const card = box.firstElementChild;
    setTimeout(() => { if (card.parentNode) card.remove(); }, 4600);
  }

  // ---------- per-frame cues ----------
  function cues() {
    const s = state;
    if (s.status !== 'playing') return;
    const left = G.CONFIG.idleLimit - (s.time - s.lastClick);
    const whole = Math.ceil(left);
    if (whole !== lastLeftWhole) {
      if (whole <= 3 && whole < lastLeftWhole && whole > 0) {
        S.tick(whole <= 1);
        if (navigator.vibrate) navigator.vibrate(30);
      }
      lastLeftWhole = whole;
    }
    const remaining = G.CONFIG.duration - s.time;
    for (const m of milestones) {
      if (!m.done && remaining <= m.at) {
        m.done = true;
        toast(m.at + ' seconds left', m.at <= 100 ? 'eventwarn' : '');
        S.tick(m.at <= 100);
      }
    }
    if (remaining < 100) {
      const bpm = 60 + (100 - remaining) * 0.6;
      if (s.time - lastBeat >= 60 / bpm) { lastBeat = s.time; S.heartbeat(); }
    }
  }

  // ---------- overlays ----------
  function openOverlay(html) {
    $('modal').innerHTML = html;
    $('overlay').classList.add('show');
  }
  function closeOverlay() { $('overlay').classList.remove('show'); }

  function bestLine() {
    const best = Number(store.get(BEST_KEY));
    return best ? 'Best: ' + best.toFixed(1) + 's' : 'No wins yet';
  }

  function showIntro() {
    openOverlay(
      img(1, 'modal-img') +
      `<div class="kicker">Daily run · ${esc(state.seed)}</div>` +
      `<h1>1000 seconds<br>to <span>AGI</span>.</h1>` +
      `<p>Start renting GPUs out of a market stall in Taipei. Finish as the hyper mega boss, training a superintelligence in orbit.</p>` +
      `<ol class="rules">` +
      `<li><span><b>Pitch at least every 10 seconds</b> or the investors walk out. The ring shows how long you have.</span></li>` +
      `<li><span><b>Tap fast to overclock</b> your compute. <b>Wait to charge</b> a pitch: once you have passive income, a late pitch pays far more.</span></li>` +
      `<li><span>GPUs burn energy into algorithms, and 20 algorithms make an LLM. Every LLM you hold earns licensing revenue. Hardware needs <b>racks</b>, so build sites.</span></li>` +
      `<li><span><b>Training runs</b> promote you. Keep compute fed and don't overheat mid-run. From level 5, hotter runs mean more output.</span></li>` +
      `</ol>` +
      `<button class="go" id="go" type="button">Pitch to start</button>` +
      `<div class="meta"><span>${bestLine()}</span><span>Events are the same for everyone today</span></div>`);
    $('go').addEventListener('click', pitch);
  }

  function showEnd() {
    const s = state;
    const won = s.status === 'won';
    if (won) {
      const best = Number(store.get(BEST_KEY));
      if (!best || s.time < best) store.set(BEST_KEY, s.time.toFixed(1));
    }
    const L = G.LEVELS[s.level - 1];
    const marks = s.stats.levelTimes.slice(1).map((t, i) =>
      `<i style="left:${(t / G.CONFIG.duration * 100).toFixed(1)}%"${i === s.stats.levelTimes.length - 2 ? ' class="last"' : ''}><span>${i + 2 > G.MAX_LEVEL ? '★' : i + 2}</span></i>`).join('');
    const title = won ? `Beyond <span>AGI</span>.` : s.lossReason === 'idle' ? `Investors <span>walked</span>.` : `Out of <span>time</span>.`;
    const sub = won
      ? `${esc(G.FINAL_MISSION)} came online at ${s.time.toFixed(1)}s. You finished as ${esc(L.name)}.`
      : s.lossReason === 'idle'
        ? `Ten seconds without a pitch. You got as far as ${esc(L.name)} (level ${s.level}).`
        : `The clock ran out while you were ${esc(L.name)} (level ${s.level}).`;
    openOverlay(
      img(won ? 'win' : s.level, 'modal-img') +
      `<div class="kicker">${won ? 'Run complete' : 'Run over'} · ${esc(s.seed)}</div>` +
      `<h1>${title}</h1><p>${sub}</p>` +
      `<div class="timeline"><span class="tl-start">0s</span><span class="tl-end">1000s</span>${marks}</div>` +
      `<div class="stats">` +
      `<div><span>Level</span><b>${s.level}/10</b></div>` +
      `<div><span>Time</span><b>${s.time.toFixed(1)}s</b></div>` +
      `<div><span>Pitches</span><b>${s.stats.clicks}</b></div>` +
      `<div><span>Best charge</span><b>${money(s.stats.bestCharge)}</b></div>` +
      `<div><span>Earned</span><b>${money(s.stats.moneyEarned)}</b></div>` +
      `<div><span>LLMs made</span><b>${fmt(s.stats.llmsMade)}</b></div>` +
      `<div><span>Overheats</span><b>${s.stats.overheats}</b></div>` +
      `<div><span>Failed runs</span><b>${s.stats.failedRuns}</b></div>` +
      `</div>` +
      `<button class="go" id="again" type="button">Play again</button>` +
      `<button class="ghost" id="share" type="button">Share result</button>` +
      `<div class="meta"><span>${bestLine()}</span><span>Space / Enter to restart</span></div>`);
    $('again').addEventListener('click', restart);
    $('share').addEventListener('click', share);
  }

  // Link that unfurls as a score card on socials (see api/share.mjs and api/og.mjs).
  function shareUrl() {
    const s = state;
    const o = s.status === 'won' ? 'w' : s.lossReason === 'idle' ? 'i' : 't';
    const q = new URLSearchParams({ l: String(s.level), t: s.time.toFixed(1), o });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.seed)) q.set('d', s.seed);
    return `${location.origin}/s?${q}`;
  }

  function share() {
    const s = state;
    const name = G.LEVELS[s.level - 1].name;
    const text = s.status === 'won'
      ? `I went beyond AGI in ${s.time.toFixed(1)}s. Can you beat me?`
      : s.lossReason === 'idle'
        ? `I made it to ${name} (level ${s.level}/10) before the investors walked. Can you beat me?`
        : `I made it to ${name} (level ${s.level}/10) in 1000 Seconds to AGI. Can you beat me?`;
    const url = shareUrl();
    if (navigator.share) { navigator.share({ title: '1000 Seconds to AGI', text, url }).catch(() => {}); return; }
    const done = () => toast('Link copied. Paste it anywhere.');
    if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(done, () => toast(url));
    else toast(url);
  }

  function restart() {
    state = G.createState();
    endShown = false;
    shownLevel = 0;
    lastLeftWhole = 10;
    lastBeat = 0;
    streak = 0;
    lastPitchAt = -1;
    milestones = [750, 500, 250, 100].map((at) => ({ at, done: false }));
    for (const k in newUntil) delete newUntil[k];
    els.log.innerHTML = '';
    $('ceremony').innerHTML = '';
    render();
    showIntro();
  }

  // ---------- loop ----------
  function frame(now) {
    requestAnimationFrame(frame); // schedule first so an exception can't stop the loop
    const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    G.tick(state, dt);
    cues();
    drainEvents();
    render();
    if (!endShown && (state.status === 'won' || state.status === 'lost')) {
      endShown = true;
      setTimeout(showEnd, 500);
    }
  }

  function measureTop() {
    const root = document.documentElement.style;
    root.setProperty('--top-h', $('top').offsetHeight + 'px');
    root.setProperty('--thumb-h', $('thumb').offsetHeight + 'px');
  }

  function setTab(tab) {
    $('main').dataset.view = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const pane = document.querySelector(`.pane[data-pane="${tab}"]`);
    if (pane) pane.scrollTop = 0;
  }

  // ---------- input ----------
  function bindInput() {
    // iOS Safari ignores user-scalable=no: stop pinch and double-tap zoom so mashing Pitch never zooms.
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) {
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }
    const p = $('pitch');
    // pointerdown fires immediately on touch (no 300ms wait, no double count with click).
    p.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pitch();
    });
    p.addEventListener('click', (e) => { if (e.detail === 0) pitch(); }); // keyboard activation
    p.addEventListener('contextmenu', (e) => e.preventDefault());

    $('train').addEventListener('click', train);
    // Tap the level thumbnail to see the artwork full-size again.
    $('persona').addEventListener('click', (e) => { if (e.target.classList.contains('p-img')) ceremony(state.level); });
    $('sound').addEventListener('click', toggleSound);
    document.querySelectorAll('#qty button').forEach((b) => b.addEventListener('click', () => setQty(b.dataset.qty)));
    document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const overlayOpen = $('overlay').classList.contains('show');
      if (e.code === 'Space' || e.key === 'Enter') {
        if (e.repeat) { e.preventDefault(); return; }
        if (overlayOpen && endShown) { e.preventDefault(); restart(); return; }
        if (e.key === 'Enter' && document.activeElement && document.activeElement !== document.body && !overlayOpen) return;
        e.preventDefault();
        const pb = $('pitch');
        pb.classList.add('press');
        setTimeout(() => pb.classList.remove('press'), 80);
        pitch();
        return;
      }
      if (state.status !== 'playing') return;
      const k = e.key.toLowerCase();
      if (k === 't' || k === 'l') { train(); return; }
      if (k === 'm') { toggleSound(); return; }
      if (k === 'c') {
        const i = DIAL.findIndex((d) => Math.abs(d.v - state.cooling) < 0.01);
        if (state.level >= G.CONFIG.heatLevel) G.setCooling(state, DIAL[(i + 1) % DIAL.length].v);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const btn = els.shop.querySelector(`.item[data-key="${e.key}"]`);
        if (btn && !btn.hidden) buyItem(btn.dataset.id);
      }
    });
    // Keep keyboard focus off buttons after a mouse click so Space always pitches.
    document.addEventListener('mouseup', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b) b.blur();
    });
    window.addEventListener('resize', measureTop);
  }

  // ---------- boot ----------
  build();
  bindInput();
  if (store.get(SOUND_KEY) === '1') toggleSound();
  state = G.createState();
  restart();
  measureTop();
  requestAnimationFrame(frame);

  window.agiDebug = { get state() { return state; }, G };
})();
