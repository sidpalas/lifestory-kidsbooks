# Writes pixel layers into a layered PSD without touching any other layer, for scripted fixes to an illustrator's file
# (a tighter hero cut, a new occluder, a repaired limb). Runs on the machine that has the art.
#
#   python3 -I fixtures/art-sources/psd-layers.py <in.psd> <out.psd> [--set "group/layer=image.png"]...
#       [--rename "group/old=new"]... [--show group]... [--photocraft <photocraft-cli>]
#
# --set replaces the layer's pixels with a full-canvas RGBA PNG, keeping its place, visibility, opacity and clipping;
#   a layer that doesn't exist yet is added at the bottom of the group. --rename renames a layer; --show makes a group
#   and its layers visible. <out.psd> may not be <in.psd>: back the file up and copy the result over it yourself.
# Needs psd-tools, pillow and numpy.
#
# Two psd-tools pitfalls this handles:
# - A layer made with PixelLayer.frompil in an RGB document loses its transparency (an empty layer comes out as an
#   opaque black pixel). Layers are built in a scratch RGBA document and their records moved across.
# - psd-tools writes a merged preview other programs show wrong. With --photocraft the result is re-saved through
#   PhotoCraft (`photocraft-cli convert`), which rewrites the preview; without it, re-save it in your editor.
# After writing, every layer not named in the arguments is checked to be pixel-identical, and each set layer to match
# its PNG.
import argparse, copy, hashlib, os, shutil, subprocess, sys, tempfile

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("out")
p.add_argument("--set", action="append", default=[], help='"group/layer=image.png"')
p.add_argument("--rename", action="append", default=[], help='"group/old=new"')
p.add_argument("--show", action="append", default=[], help="group to make visible")
p.add_argument("--photocraft")
args = p.parse_args()
if os.path.abspath(args.src) == os.path.abspath(args.out):
    sys.exit("write to another file, then copy it over the original once you've checked it")


def split(spec):
    left, right = spec.split("=", 1)
    group, layer = left.split("/", 1)
    return group, layer, right


psd = PSDImage.open(args.src)
scratch = PSDImage.new("RGBA", psd.size)
groups = {g.name: g for g in psd if g.is_group()}
sets = [split(s) for s in args.set]
renames = [split(s) for s in args.rename]
touched = {(g, l) for g, l, _ in sets}


def key(l):
    return (l.parent.name if l.parent is not psd else None, l.name)


def signature(doc):
    return sorted((key(l), l.visible, l.clipping, l.opacity, l.bbox,
                   hashlib.md5(np.asarray(l.topil()).tobytes()).hexdigest() if l.width > 0 else None)
                  for l in doc.descendants() if not l.is_group() and key(l) not in touched)


for g, old, new in renames:
    [l for l in groups[g] if l.name == old][0].name = new
before = signature(psd)  # after renaming, which changes no pixels
for g, name, png in sets:
    group = groups[g]
    im = Image.open(png).convert("RGBA")
    if im.size != psd.size:
        sys.exit(f"{png} is {im.size}, the document is {psd.size}: give a full-canvas PNG")
    bb = im.getchannel("A").getbbox()
    crop, left, top = (im.crop(bb), bb[0], bb[1]) if bb else (Image.new("RGBA", (1, 1), (0, 0, 0, 0)), 0, 0)
    t = PixelLayer.frompil(crop, scratch, name, top=top, left=left)
    layer = PixelLayer(group, copy.deepcopy(t._record), copy.deepcopy(t._channels))
    old = [l for l in group if l.name == name]
    if old:
        i = list(group).index(old[0])
        group.remove(old[0])
        group.insert(i, layer)
        layer.visible, layer.clipping, layer.opacity = old[0].visible, old[0].clipping, old[0].opacity
    else:
        group.insert(0, layer)
for g in args.show:
    groups[g].visible = True
    for l in groups[g]:
        l.visible = True
before = [(k, True if k[0] in args.show else vis, *rest) for k, vis, *rest in before]

with tempfile.TemporaryDirectory() as tmp:
    raw = os.path.join(tmp, "raw.psd")
    psd.save(raw)
    final = raw
    if args.photocraft:
        final = os.path.join(tmp, "out.psd")
        subprocess.run([args.photocraft, "convert", raw, final], check=True, capture_output=True)
    check = PSDImage.open(final)
    if signature(check) != before:
        sys.exit("another layer changed; nothing written")
    for g, name, png in sets:
        l = [x for x in check.descendants() if key(x) == (g, name)][0]
        ref = np.asarray(Image.open(png).convert("RGBA"))
        got = np.zeros_like(ref)
        if l.width > 0:
            got[l.top:l.bottom, l.left:l.right] = np.asarray(l.topil().convert("RGBA"))
        if np.abs(got[..., 3].astype(int) - ref[..., 3]).max() > 1:
            sys.exit(f"{g}/{name} doesn't match {png}; nothing written")
    shutil.copyfile(final, args.out)
print("wrote", args.out, "(re-saved through PhotoCraft)" if args.photocraft else "(re-save it in your editor)")
