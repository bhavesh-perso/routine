#!/usr/bin/env python3
"""Generate the Routine app icons with Pillow. Re-run from the repo root:

    python3 icons/make-icons.py

The mark: a disc split by a horizontal gap. The top half is an Ember sun (the
morning block), the bottom half is an Indigo night half with a crescent moon cut
into it (the night block). Palette from styles/base.css. Everything is drawn at
4x and scaled down with Lanczos for clean edges. No transparency anywhere (iOS
fills transparent pixels with black on the home screen).
"""
from pathlib import Path
from PIL import Image, ImageDraw

INK = (0x11, 0x14, 0x1A)      # background
EMBER = (0xF0, 0xA5, 0x3A)    # sun / morning block
INDIGO = (0x26, 0x30, 0x5C)   # night block
INDIGO_HI = (0x5A, 0x6B, 0xC4)  # lighter indigo so the night half reads on Ink
BONE = (0xEC, 0xE9, 0xE2)     # moon

OUT = Path(__file__).resolve().parent
SS = 4  # supersampling factor


def draw_mark(size, scale):
    """Return an RGB image `size` px square with the mark filling `scale` of it.

    scale is the disc diameter as a fraction of the canvas. 0.62 for normal
    icons; smaller for the maskable icon so it stays inside the 80% safe zone.
    """
    S = size * SS
    img = Image.new("RGB", (S, S), INK)
    d = ImageDraw.Draw(img)

    cx = cy = S / 2
    r = S * scale / 2
    gap = S * 0.035  # horizon gap between the two halves

    # Top half: Ember sun (pieslice 180..360 = upper semicircle), shifted up.
    d.pieslice([cx - r, cy - r - gap / 2, cx + r, cy + r - gap / 2], 180, 360, fill=EMBER)

    # Bottom half: night sky, shifted down.
    top = cy + gap / 2
    d.pieslice([cx - r, top - r, cx + r, top + r], 0, 180, fill=INDIGO_HI)

    # Crescent moon inside the night half: a Bone disc with an offset
    # Indigo disc over it.
    mr = r * 0.26
    mx, my = cx + r * 0.08, top + r * 0.46
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=BONE)
    off = mr * 0.55
    d.ellipse([mx - mr + off, my - mr - off * 0.35, mx + mr + off, my + mr - off * 0.35], fill=INDIGO_HI)

    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = OUT / name
    img.save(path, "PNG", optimize=True)
    print(f"{name}: {img.size[0]}x{img.size[1]}, {path.stat().st_size} bytes")


if __name__ == "__main__":
    save(draw_mark(180, 0.62), "apple-touch-icon.png")
    save(draw_mark(192, 0.62), "icon-192.png")
    save(draw_mark(512, 0.62), "icon-512.png")
    # Maskable: full-bleed Ink, mark well inside the central 80% safe zone
    # (the safe zone is a circle of diameter 0.8; the mark is 0.50 wide).
    save(draw_mark(512, 0.50), "icon-maskable-512.png")
    # Favicon: slightly larger mark so it reads at 16-32 px.
    save(draw_mark(32, 0.80), "favicon-32.png")
