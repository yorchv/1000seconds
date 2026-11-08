1000 Seconds to AGI
===================

Go from renting GPUs out of a market stall in Taipei to training a superintelligence in orbit. You have 1000 seconds, and you lose if you go 10 seconds without pitching investors.

Live: https://1000seconds.vercel.app

## Play

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
npm start            # or: python3 -m http.server 8080
```

The layout is built for phones first, with a thumb bar holding the Pitch button. Desktop keys: **Space** pitch, **1–9** buy, **T** train, **C** cycle cooling, **M** sound.

### Career

| Lv | You are | Unlocks |
|---|---|---|
| 1 | Back-Alley GPU Renter (Guang Hua Market) | Grid energy, GPUs |
| 2 | Rig Flipper | Sales bots, garages (racks) |
| 3 | Garage Lab (Hsinchu) | Diesel generators |
| 4 | Seed-Stage Startup | LLM compiler, licensing, GPU clusters |
| 5 | Unicorn | Heat, run-hot bonus, chillers, data centers |
| 6 | Neolab | Kernel optimizations, solar farms |
| 7 | Sam Altman | API licensing ×4, hyperscale campuses |
| 8 | Dario Amodei | Overheats no longer wipe work, cooling +25% |
| 9 | Jensen Huang | Superpods, compute hardware 20% off |
| 10 | Elon Musk | Orbital data centers → final mission: Orbital Superintelligence |

### Rules

- **Pitch** at least every 10s. Tapping fast builds **overclock** (more output, more heat). Waiting builds **charge**: once you have passive income, a late pitch pays out up to 0.6 × income × 8s.
- GPUs, clusters and superpods take **racks**, which come from sites: the stall, garages, data centers, campuses and orbitals. They burn energy into algorithms, and 20 algorithms compile into an LLM. Every LLM you hold earns licensing revenue.
- **Power plants** (generators, solar, and the power built into sites) supply energy continuously. Grid energy is bought in packs.
- **Promotion is a training run.** Compute and LLMs are thresholds, while energy and the fee are paid up front. The run takes 4 + 2×level seconds (30s for the final mission) and stalls if compute runs out of energy. Overheating mid-run fails it with a 50% refund.
- **Heat** (from level 5) drifts toward 100 × heat output / cooling. Hotter hardware produces more (up to +50%). The cooling dial (Off–Max) trades cooling for output. At 100% the hardware shuts down until it cools to 60%.
- **Hype**: each promotion makes pitches pay ×5 for 10s.
- **Events** come from a seed (the UTC date), so everyone gets the same run each day: investor frenzy, viral demo, GPU shortage, brownout, Senate hearing, export controls, heatwave, leaked weights. Each is announced 5s ahead.
- Inflation multiplies every price by `1 + 0.0013 × seconds elapsed`.

## Develop

```
index.html           page shell
src/game.js          all game rules and balance numbers (pure logic, no DOM; also runs in Node)
src/ui.js            DOM rendering, input and overlays
src/sound.js         WebAudio synth (no audio files)
src/style.css        Braun / Swiss-print styling
assets/levels/       one illustration per level (1-10.jpg) plus win.jpg
scripts/generate-art.py  regenerates the level art with Gemini
api/og.mjs           1200x630 share card (home, or one run via ?l=&t=&o=&d=)
api/share.mjs        /s?… link page: social meta tags, then redirects into the game
scripts/preview-cards.mjs  renders the share cards locally into .og-test/
scripts/simulate.js  headless greedy bot used to tune the balance
test/game.test.js    rule tests + a balance check
```

```sh
npm test             # node --test
node scripts/simulate.js 2 3 4 6 --seeds=24
```

All tunables live at the top of `src/game.js`. Rerun the simulator after changing them. Current results for the greedy bot over 24 seeds:

| Clicks/s | Wins | Median win time |
|---|---|---|
| 2 | 8/24 | 924s |
| 2.5 | 16/24 | 957s |
| 3 | 21/24 | 933s |
| 4 | 24/24 | 909s |
| 6 | 24/24 | 827s |

### Art

The level illustrations come from Gemini (`gemini-3-pro-image`). Every level has a comic character in the foreground: a recurring fictional hero for levels 1–6 and affectionate caricatures of the four CEOs for 7–10. Every prompt shares one Swiss-poster/Braun style preamble, kept in `scripts/generate-art.py`. Images are 3:2, resized to 960px wide JPEG. They appear in the career panel, the level-up card, and the intro and end screens. To regenerate:

```sh
python3 -m venv .venv && .venv/bin/pip install google-genai pillow
GEMINI_API_KEY=... .venv/bin/python scripts/generate-art.py 3 7 win   # specific levels; no args = missing ones
```

### Sharing

Links to the game unfurl as a large card on X, iMessage, WhatsApp, Slack, LinkedIn, Discord and Facebook. The Open Graph and Twitter tags are in `index.html`.

The end screen's **Share result** button shares a link like `/s?l=9&t=612.4&o=i&d=2026-11-08`:

- `l`: level reached
- `t`: time in seconds
- `o`: outcome (`w` won, `i` investors walked, `t` time ran out)
- `d`: the daily run date

That page serves per-run meta tags and sends people into the game. Its preview image is drawn by `api/og.mjs`: the character art, big level number, result and level ladder. It runs `@vercel/og` 0.8.6 on the Node runtime and outputs JPEG via `sharp`, which keeps cards around 75 KB, under WhatsApp's preview limit. The Vercel CDN caches each card. All URL params are clamped, so no free text from the URL reaches the card. Scores aren't verified, so anyone can craft a link.

When you change CSS or JS, bump the `?v=` query on the asset links in `index.html` so returning players get the new files. Bump `ART_V` in `src/ui.js` when you regenerate art.

---

## Game Concept

"1000 Seconds to AGI" is a clicker-style incremental game where the player's goal is to develop Artificial General Intelligence (AGI) within a 1000-second time limit. The game is set in a world where the ultimate objective is to create AGI to rule the world.
Core Mechanics

    Time Limit: Players have 1000 seconds to complete the game.
    Click Requirement: Players must click at least once every 10 seconds to keep the game active.
    Resource Generation: Clicking generates money, which is used to buy other resources.
    Progression: The game has 10 levels, each unveiling new game modes and challenges.

Resources

    Money: The primary resource, generated by clicking and used to purchase other resources.
    Energy: Purchased with money, used to power GPUs.
    GPUs: Purchased with money, used to create algorithms.
    Algorithms: Generated by GPUs, used to create LLMs.
    LLMs (Large Language Models): The final product, created from algorithms.
    Heat: Generated by GPUs (introduced at level 5).
    Coolers: Used to reduce heat (introduced at level 5).

Game Progression

    Level 1: Basic AI - Start of the journey
    Level 2: Automation - Unlock auto-clickers
    Level 3: Resource Management - Introduce generators for automatic energy production
    Level 4: Inventory System - Develop algorithms to create Language Models
    Level 5: Heat Management - Manage heat generated by GPUs and implement cooling systems
    Level 6: Advanced AI - Optimize GPU usage for faster algorithms
    Level 7: Machine Learning - Implement advanced machine learning techniques
    Level 8: Neural Networks - Create and train more sophisticated neural networks
    Level 9: Quantum Computing - Harness the power of quantum computing for AI
    Level 10: Artificial General Intelligence - Achieve the ultimate goal

Special Features

    Auto-clickers: Automatically generate money at regular intervals.
    Generators: Automatically produce energy at the cost of money.
    Heat Management: GPUs generate heat, which can halt production if it reaches 100%. Coolers help reduce heat.
    Inflation: Resource costs increase over time, adding an economic challenge.

Game Rules

    The game ends if the player doesn't click for 10 seconds or if the 1000-second timer runs out.
    Each level requires a certain amount of GPUs, energy, and LLMs to progress.
    GPUs consume energy to produce algorithms.
    Every 20 algorithms create a new LLM.
    At level 5, heat is introduced. If heat reaches 100%, GPU production stops until it's reduced.
    The game is won when the player reaches level 10 and achieves AGI.

User Interface Elements

    Progress Bar: Shows the remaining time out of 1000 seconds.
    Resource Display: Shows current amounts of money, energy, GPUs, algorithms, and LLMs.
    Heat Gauge: (From level 5) Displays current heat level.
    Buy Buttons: For purchasing energy, GPUs, auto-clickers, generators, and coolers.
    Level Display: Shows current level and requirements for the next level.

Strategies

    Balance resource allocation between different types (energy, GPUs, coolers).
    Manage heat levels to ensure continuous GPU operation.
    Invest in auto-clickers and generators for passive resource generation.
    Time level-ups strategically to take advantage of new features.

This game combines elements of resource management, strategic planning, and quick decision-making, all within a tight time constraint, creating an engaging and challenging experience for players aiming to develop AGI.
