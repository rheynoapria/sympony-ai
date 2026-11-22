#!/usr/bin/env python3
"""Bake Sympony's app icon targets from a 1024x1024 RGBA master PNG.

Usage: make_icon.py <master.png> <out-dir> [--ui-copy <path>]
Writes icon-1024.png, icon.icns, icon.ico, and tightly cropped 192x192 icon-ui.png
(plus an optional byte-identical copy at --ui-copy).
"""
import argparse, os, shutil, subprocess, sys, tempfile
from PIL import Image

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def load_master(path):
    try:
        img = Image.open(path)
        img.load()
    except OSError as e:
        sys.exit(f'make_icon: cannot open {path}: {e}')
    if img.size != (1024, 1024):
        sys.exit(f'make_icon: expected 1024x1024 master, got {img.size[0]}x{img.size[1]}')
    if img.mode in ('P', 'LA'):
        img = img.convert('RGBA')
    elif img.mode != 'RGBA':
        sys.exit(f'make_icon: expected RGBA master, got {img.mode}')
    corners = [(0, 0), (1023, 0), (0, 1023), (1023, 1023)]
    if any(img.getpixel(p)[3] != 0 for p in corners):
        sys.exit('make_icon: master must have transparent corners (alpha 0 at all four corners)')
    if img.getchannel('A').getbbox() is None:
        sys.exit('make_icon: master is completely transparent')
    return img


def check(out):
    assert Image.open(f'{out}/icon-1024.png').size == (1024, 1024)
    assert sorted(Image.open(f'{out}/icon.ico').info['sizes']) == ICO_SIZES
    ui = Image.open(f'{out}/icon-ui.png')
    assert ui.size == (192, 192)
    l, t, r, b = ui.getchannel('A').getbbox()
    assert l <= 2 and t <= 2 and r >= 190 and b >= 190  # tight crop
    assert os.path.getsize(f'{out}/icon.icns') > 100_000


def main(master_path, out, ui_copy=None):
    master = load_master(master_path)
    os.makedirs(out, exist_ok=True)
    master.save(os.path.join(out, 'icon-1024.png'))
    master.save(os.path.join(out, 'icon.ico'), sizes=ICO_SIZES)
    ui_path = os.path.join(out, 'icon-ui.png')
    master.crop(master.getchannel('A').getbbox()).resize((192, 192), Image.LANCZOS).save(ui_path, optimize=True)
    if ui_copy:
        parent = os.path.dirname(ui_copy)
        if parent:
            os.makedirs(parent, exist_ok=True)
        shutil.copyfile(ui_path, ui_copy)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'icon.iconset')
        os.makedirs(iconset)
        for px in (16, 32, 128, 256, 512):
            master.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, f'icon_{px}x{px}.png'))
            master.resize((px * 2, px * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{px}x{px}@2x.png'))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(out, 'icon.icns')], check=True)
    check(out)
    print('icon:', out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Bake Sympony app icons from a 1024x1024 RGBA master PNG.')
    ap.add_argument('master', help='Path to 1024x1024 RGBA master PNG')
    ap.add_argument('out', help='Output directory (e.g. brand)')
    ap.add_argument('--ui-copy', dest='ui_copy', help='Optional path for a byte-identical copy of icon-ui.png')
    args = ap.parse_args()
    main(args.master, args.out, args.ui_copy)
