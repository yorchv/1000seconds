"""Generate the per-level artwork with Gemini (Nano Banana Pro): a comic character per level.

Usage:
  .venv/bin/python scripts/generate-art.py            # all missing images
  .venv/bin/python scripts/generate-art.py 3 7 win    # regenerate specific ones

Reads GEMINI_API_KEY from the environment or .env.local. Writes assets/levels/<key>.jpg
(1K, 3:2), then the build step below shrinks them for the web.
"""
import os
import sys
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "levels"
MODEL = "gemini-3-pro-image"

# One house style so the eleven scenes read as a set: Braun / Swiss print poster, with a comic
# caricature character in the foreground of every level scene.
STYLE = (
    "Flat editorial illustration in the style of a 1960s Swiss International Style poster crossed with "
    "Dieter Rams-era Braun product graphics. Strict limited palette: warm off-white paper (#ecebe6), "
    "charcoal black (#1d1d1b), warm greys, one signal orange accent (#f0601a), a touch of olive green (#5f8f3a). "
    "Clean geometric shapes, precise lines, fine risograph halftone dot texture, generous negative space. "
    "One comic caricature character stands large in the right half of the frame, waist-up or full body: oversized "
    "head, small body, big expressive eyes, bold exaggerated but affectionate features, drawn with the same flat "
    "geometric shapes and palette as the scene (like a New Yorker cover caricature). Face clearly readable even "
    "when the image is shown as a small thumbnail. The scene behind tells the story. "
    "Full-bleed composition: the artwork fills the entire canvas edge to edge, no border, no frame, no margin. "
    "Absolutely no text, letters, numbers, signage words or logos."
)

# The player for levels 1-6: one recurring fictional hustler who levels up.
HERO = (
    "The character is our recurring hero: a scrappy young Taiwanese woman engineer, about 25, with a chin-length "
    "messy black bob haircut with bangs, big round black glasses, a big grin and an orange hoodie"
)

SCENES = {
    "1": HERO + ", broke but hopeful, proudly holding up a used graphics card. Setting: a tiny back-alley "
         "electronics market stall in Taipei at night, folding table with three used graphics cards, tangle of "
         "extension cords, desk fan, hanging bare bulb, dense market alleys behind.",
    "2": HERO + ", sweaty and wired, a screwdriver behind one ear. Setting: a cramped New Taipei apartment turned "
         "into a mining den, open-frame rigs of graphics cards on metal shelves, box fans in the window, cables taped "
         "to the floor, a scooter helmet on a hook.",
    "3": HERO + ", now with a soldering iron and safety goggles pushed up on the forehead, confident. Setting: a "
         "garage lab in Hsinchu, roll-up door half open, two small server racks with green lights, whiteboard of "
         "diagrams, a parked scooter.",
    "4": HERO + ", hoodie under a cheap blazer, holding a coffee, startup founder swagger. Setting: a San Francisco "
         "loft office with one tall glowing GPU rack, long shared desk with laptops, window showing fog and a "
         "suspension bridge silhouette.",
    "5": HERO + ", in a crisp orange zip vest over the hoodie, arms crossed, unicorn-founder smug. Setting: a Mission "
         "District brick warehouse data hall, rows of server racks, big orange chillers on the roof, diesel generator "
         "yard outside.",
    "6": HERO + ", minimalist black turtleneck with a small orange accent, calm visionary pose, one hand on a sleek "
         "machine on a plinth. Setting: a clean white research lab, through the window a field of solar panels.",
    "7": "The character is an affectionate comic caricature of tech CEO Sam Altman: slim, boyish face, short tousled "
         "hair, earnest wide eyes, a plain sweater, a calm small smile, hands clasped. Setting: a historic brick "
         "office building in San Francisco at dusk with every window lit, a hyperscale data center campus on the "
         "horizon, power lines converging.",
    "8": "The character is an affectionate comic caricature of AI researcher and CEO Dario Amodei: curly dark hair, "
         "glasses, thoughtful earnest expression, gesturing while explaining, a simple sweater. Setting: a calm "
         "reading room with a long table, neat cabinets and a single red stop button under glass; through the window "
         "an orderly data center campus with cooling towers.",
    "9": "The character is an affectionate comic caricature of Nvidia CEO Jensen Huang: swept-back grey-black hair, "
         "huge confident grin, his signature black leather jacket, holding up a glowing chip like a trophy on a "
         "keynote stage. Setting: a towering wall of dense superpod compute racks glowing green behind him.",
    "10": "The character is an affectionate comic caricature of Elon Musk: big jaw, dark short hair, mischievous "
          "grin, black t-shirt, floating in orbit with a tiny helmet visor flipped up, giving a thumbs up. Setting: "
          "low Earth orbit, a constellation of orbital data centers with huge solar wings above a curved Earth, a "
          "reusable rocket climbing on a plume of fire.",
    "win": "No character in this one; it is a pure scene. A single radiant orbital megastructure ringed around the "
           "Earth, linking thousands of glowing data center modules into one mind, sunrise over the planet's limb, "
           "sense of awe and quiet triumph.",
}


def load_key():
    key = os.environ.get("GEMINI_API_KEY")
    env = ROOT / ".env.local"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("GEMINI_API_KEY not set (env or .env.local)")
    return key


def generate(client, name):
    prompt = f"{STYLE}\n\nScene: {SCENES[name]}"
    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model=MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio="3:2", image_size="1K"),
                ),
            )
            for part in resp.parts or []:
                if part.inline_data:
                    raw = OUT / f"{name}.raw.jpg"
                    part.as_image().save(str(raw))
                    final = OUT / f"{name}.jpg"
                    # Web size: 960px wide, ~80KB.
                    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "72",
                                    "--resampleWidth", "960", str(raw), "--out", str(final)],
                                   check=True, capture_output=True)
                    raw.unlink()
                    return f"{name}: ok ({final.stat().st_size // 1024} KB)"
            err = "no image in response"
        except Exception as e:  # network / safety / quota — retry a couple of times
            err = str(e)[:200]
    return f"{name}: FAILED {err}"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=load_key())
    wanted = sys.argv[1:] or [k for k in SCENES if not (OUT / f"{k}.jpg").exists()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for line in pool.map(lambda n: generate(client, n), wanted):
            print(line, flush=True)


if __name__ == "__main__":
    main()
