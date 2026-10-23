#!/usr/bin/env python3
"""把角色/表情贴图中烘焙进去的棋盘格背景抠成透明 PNG，并整理站点素材目录。"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage

SRC = Path('/workspace/textures')
DST = Path('/workspace/vegetable-town/assets')

def cutout(src_path: Path, dst_path: Path):
    img = Image.open(src_path).convert('RGBA')
    arr = np.array(img)
    rgb = arr[:, :, :3].astype(np.int16)
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    # 棋盘格是接近中性灰的浅色块（白 / 浅灰）
    candidate = (mn > 198) & ((mx - mn) < 26)

    labels, n = ndimage.label(candidate, structure=np.ones((3, 3)))
    if n == 0:
        img.save(dst_path)
        return
    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)
    bg_mask = np.isin(labels, list(border))

    # 边缘羽化：紧贴透明区的浅色像素也变透明，去掉残余白边
    grown = ndimage.binary_dilation(bg_mask, np.ones((3, 3)), iterations=1)
    soft = grown & candidate & ~bg_mask

    arr[:, :, 3] = np.where(bg_mask, 0, arr[:, :, 3])
    arr[:, :, 3] = np.where(soft, np.minimum(arr[:, :, 3], 90), arr[:, :, 3])

    out = Image.fromarray(arr, 'RGBA')
    bbox = out.getbbox()
    if bbox:
        pad = 6
        bbox = (max(bbox[0] - pad, 0), max(bbox[1] - pad, 0),
                min(bbox[2] + pad, out.width), min(bbox[3] + pad, out.height))
        out = out.crop(bbox)
    out.save(dst_path, optimize=True)
    print(f'  {src_path.name} -> {dst_path.name} {out.size}')

def main():
    (DST / 'characters').mkdir(parents=True, exist_ok=True)
    (DST / 'expressions').mkdir(parents=True, exist_ok=True)
    (DST / 'scenes').mkdir(parents=True, exist_ok=True)
    (DST / 'cards').mkdir(parents=True, exist_ok=True)

    print('角色透明化:')
    for p in sorted((SRC / 'characters').glob('*.jpg')):
        cutout(p, DST / 'characters' / (p.stem + '.png'))

    print('表情透明化:')
    for p in sorted((SRC / 'expressions').glob('*.jpg')):
        cutout(p, DST / 'expressions' / (p.stem + '.png'))

    print('场景复制:')
    for p in sorted((SRC / 'scenes').glob('*.jpg')):
        im = Image.open(p).convert('RGB')
        im.save(DST / 'scenes' / p.name, quality=88, optimize=True)
        print(f'  {p.name}')

    print('贺卡复制:')
    for p in sorted((SRC / 'cards').glob('*.jpg')):
        im = Image.open(p).convert('RGB')
        im.save(DST / 'cards' / p.name, quality=90, optimize=True)
        print(f'  {p.name}')

if __name__ == '__main__':
    main()
