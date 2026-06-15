#!/usr/bin/env python3
"""Extract SinkSub's sprites from the original 16-bit Windows executable.

SINKSUB.EXE (1993, Anders Wihlborg) is an NE-format Windows 3.x program; its
graphics are stored as standard Windows BITMAP resources, using the classic
mask + color pairing for transparency. This script pulls each resource out with
`wrestool` (icoutils), decodes the 1/4-bit DIBs with Pillow, and bakes the mask
bitmaps into PNG alpha — producing the transparent sprites in public/sprites/.

Requirements: icoutils (`brew install icoutils`) and Pillow (`pip install pillow`).
Run from the repo root:  python3 tools/extract-assets.py
"""
import os, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = os.path.join(ROOT, 'original', 'SINKSUB.EXE')
RAW = os.path.join(ROOT, 'tools', '_raw')
OUT = os.path.join(ROOT, 'public', 'sprites')

# Resource name -> output sprite. Pairs are (color_bitmap, mask_bitmap); a None
# mask means key out pure black instead. Single ints with a key color use that.
PAIRS = {
    'boat': (101, 102),
    'boat_die0': (131, 132), 'boat_die1': (133, 134),
    'boat_die2': (135, None), 'boat_die3': (137, 138),
    'sub_l': (103, 104), 'sub_r': (111, 112), 'sub_dive': (107, 108),
    'sub2_l': (109, 110), 'sub2_r': (105, 106),
    'bomb0': (113, 114), 'bomb1': (115, 116), 'bomb2': (117, 118),
    'mine': (129, 130),
    'boom0': (121, 122), 'boom1': (123, 124), 'debris': (125, 126),
    'bubble0': (151, 152), 'bubble1': (153, 154), 'bubble2': (155, 156),
    'plane0': (141, 142), 'plane1': (143, 144), 'plane2': (145, 146),
    'icon_bomb': (2, 3), 'text_pause': (93, 94),
}
BLACKKEY = {'text_over': 95, 'text_ready': 97}           # key pure black
WHITEKEY = {'digits': 99}                                # red digits on white
OPAQUE = {'bg': 100}


def extract_bmp(name):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f'{name}.bmp')
    with open(path, 'wb') as f:
        subprocess.run(['wrestool', '-x', '-t2', f'-n{name}', EXE], stdout=f, check=True)
    return Image.open(path).convert('RGBA')


def bake_mask(color_n, mask_n):
    c = extract_bmp(color_n)
    px = c.load()
    if mask_n is None:
        for y in range(c.height):
            for x in range(c.width):
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0 if r < 20 and g < 20 and b < 20 else 255)
        return c
    m = extract_bmp(mask_n).convert('L').resize(c.size)
    mp = m.load()
    for y in range(c.height):
        for x in range(c.width):
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0 if mp[x, y] >= 128 else 255)
    return c


def key(color_n, white):
    c = extract_bmp(color_n)
    px = c.load()
    for y in range(c.height):
        for x in range(c.width):
            r, g, b, _ = px[x, y]
            keyed = (r > 200 and g > 200 and b > 200) if white else (r < 20 and g < 20 and b < 20)
            px[x, y] = (r, g, b, 0 if keyed else 255)
    return c


def main():
    if not os.path.exists(EXE):
        sys.exit(f'missing {EXE}')
    os.makedirs(OUT, exist_ok=True)
    for name, (cn, mn) in PAIRS.items():
        bake_mask(cn, mn).save(os.path.join(OUT, f'{name}.png'))
    for name, n in BLACKKEY.items():
        key(n, white=False).save(os.path.join(OUT, f'{name}.png'))
    for name, n in WHITEKEY.items():
        key(n, white=True).save(os.path.join(OUT, f'{name}.png'))
    for name, n in OPAQUE.items():
        extract_bmp(n).save(os.path.join(OUT, f'{name}.png'))
    # program icon -> public/icon.png
    subprocess.run(['wrestool', '-x', '-t14', '-n101', EXE, '-o', f'{RAW}/app.ico'], check=True)
    subprocess.run(['icotool', '-x', f'{RAW}/app.ico', '-o', RAW], check=True)
    for f in os.listdir(RAW):
        if f.startswith('app_') and f.endswith('.png'):
            Image.open(os.path.join(RAW, f)).save(os.path.join(ROOT, 'public', 'icon.png'))
            break
    print('extracted sprites ->', OUT)


if __name__ == '__main__':
    main()
