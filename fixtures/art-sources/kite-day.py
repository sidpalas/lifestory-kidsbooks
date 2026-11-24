# Writes fixtures/stories/kite-day: a book format 4 placeholder story (D56) for tests and the dev seed.
# Run from the repository root: python3 fixtures/art-sources/kite-day.py "$PWD"
import json, os, shutil, sys
root = sys.argv[1]
out = os.path.join(root, "fixtures/stories/kite-day")
# Everything but the fonts (Literata, OFL) is drawn here.
for name in ("pages", "sheets", "style"): shutil.rmtree(os.path.join(out, name), ignore_errors=True)
S = 875  # 8.75 in at 100 px/in, the page with bleed
def write(path, svg):
    os.makedirs(os.path.dirname(os.path.join(out, path)), exist_ok=True)
    open(os.path.join(out, path), "w").write(svg)
def svg(w, h, body): return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n{body}\n</svg>\n'
def figure(w, h, shirt, bald=True):
    # A standing figure filling its own box: head (bald or with hair), body, legs.
    hair = "" if bald else f'<path d="M{w*.28} {h*.16} Q{w/2} {h*-.02} {w*.72} {h*.16} L{w*.72} {h*.12} Q{w/2} {h*.0} {w*.28} {h*.12} Z" fill="#6b4226"/>'
    return svg(w, h, f'''<ellipse cx="{w/2}" cy="{h*.17}" rx="{w*.22}" ry="{h*.15}" fill="#e9c2a0" stroke="#3a2a20" stroke-width="3"/>
{hair}<circle cx="{w*.42}" cy="{h*.16}" r="{w*.02}" fill="#3a2a20"/><circle cx="{w*.58}" cy="{h*.16}" r="{w*.02}" fill="#3a2a20"/>
<rect x="{w*.18}" y="{h*.33}" width="{w*.64}" height="{h*.37}" rx="{w*.12}" fill="{shirt}" stroke="#3a2a20" stroke-width="3"/>
<rect x="{w*.28}" y="{h*.68}" width="{w*.16}" height="{h*.31}" fill="#4a5a7a"/><rect x="{w*.56}" y="{h*.68}" width="{w*.16}" height="{h*.31}" fill="#4a5a7a"/>''')
def window(box, page=1000):
    # The figure's box padded 16%, grown to 2:3 (portrait), clamped to the page (D56).
    x0,y0,x1,y1 = box; w,h = x1-x0, y1-y0
    w,h = w*1.32, h*1.32
    if w/h < 2/3: w = h*2/3
    else: h = w*1.5
    cx, cy = (x0+x1)/2, (y0+y1)/2
    r = [round(cx-w/2), round(cy-h/2), round(cx+w/2), round(cy+h/2)]
    return [max(0,r[0]), max(0,r[1]), min(page,r[2]), min(page,r[3])]
def head(box):
    x0,y0,x1,y1 = box; w,h = x1-x0, y1-y0
    return [round(x0+w*.26), y0, round(x1-w*.26), round(y0+h*.33)]
pages = [
  ("p01", "#bfe3f2", "#7fbf6a", [("hero", [520, 420, 700, 880], "#d9534f"), ("grownup", [120, 300, 360, 900], "#5b7fb0")],
   [{"style":"title","content":"The Kite Day"},{"style":"body","content":"{{hero.name}} and {{grownup.title}} carried the big red kite up the windy hill."}], "bottom"),
  ("p02", "#a9d8ee", "#6aa85a", [("hero", [380, 380, 600, 900], "#d9534f")],
   [{"style":"body","content":"The wind tugged. {{hero.They}} held on tight, and up it went!"}], "top"),
  ("p03", "#f4c98f", "#7fbf6a", [("grownup", [560, 300, 800, 900], "#5b7fb0"), ("hero", [200, 420, 380, 880], "#d9534f")],
   [{"style":"body","content":"\u201cSame time tomorrow?\u201d asked {{grownup.title}}. {{hero.name}} nodded, all smiles."}], "top"),
]
def frame(preset, paragraphs):
    if preset == "bottom": return {"frameId":"t1","box":{"xIn":0.5,"yIn":0.5,"widthIn":7.5,"heightIn":7.5},"valign":"bottom","panel":True,"paragraphs":paragraphs}
    return {"frameId":"t1","box":{"xIn":0.5,"yIn":0.5,"widthIn":7.5,"heightIn":7.5},"valign":"top","panel":True,"paragraphs":paragraphs}
manifest_pages = []
for pid, sky, grass, figs, text, preset in pages:
    write(f"pages/{pid}/plate.svg", svg(S, S, f'<rect width="{S}" height="{S}" fill="{sky}"/><rect y="{S*.72}" width="{S}" height="{S*.28}" fill="{grass}"/><circle cx="{S*.85}" cy="{S*.15}" r="{S*.06}" fill="#fff3b0"/>'))
    layers = [{"kind":"art","asset":f"pages/{pid}/plate.svg"}]
    for slot, box, shirt in figs:
        bw, bh = (box[2]-box[0])*S//1000, (box[3]-box[1])*S//1000
        write(f"pages/{pid}/{slot}/reference.svg", figure(bw, bh, shirt))
        win = window(box)
        ww, wh = (win[2]-win[0])*S//1000, (win[3]-win[1])*S//1000
        ox, oy = (box[0]-win[0])*S//1000, (box[1]-win[1])*S//1000
        inner = figure(bw, bh, shirt, bald=False).split("\n",1)[1].rsplit("</svg>",1)[0]
        write(f"pages/{pid}/{slot}/stock.svg", svg(ww, wh, f'<g transform="translate({ox} {oy})">{inner}</g>'))
        layers.append({"kind":"photoFigure","slotId":slot,"reference":f"pages/{pid}/{slot}/reference.svg","box":box,"window":win,"head":head(box),"stock":f"pages/{pid}/{slot}/stock.svg"})
    manifest_pages.append({"pageId":pid,"art":"full-bleed","frames":[frame(preset,text)],"illustration":{"layers":layers}})
for slot, shirt in [("hero","#d9534f"),("grownup","#5b7fb0")]:
    one = figure(200, 400, shirt, bald=False).split("\n",1)[1].rsplit("</svg>",1)[0]
    write(f"sheets/{slot}.svg", svg(1536, 1024, '<rect width="1536" height="1024" fill="#fbf6ec"/>' + "".join(f'<g transform="translate({120+i*480} 300)">{one}</g>' for i in range(3))))
write("style/reference.svg", svg(600, 600, '<rect width="600" height="600" fill="#bfe3f2"/><rect y="430" width="600" height="170" fill="#7fbf6a"/>'))
fonts = json.load(open(out + "/manifest.json"))["fonts"]
m = {
  "formatVersion": 4,
  "trim": {"widthIn": 8.5, "heightIn": 8.5, "bleedIn": 0.125, "safeMarginIn": 0.5},
  "fonts": fonts,
  "textStyles": {"title":{"fontFamily":"Literata","sizePt":30,"lineHeight":1.15,"weight":700,"align":"center"},
                 "body":{"fontFamily":"Literata","sizePt":17,"lineHeight":1.45,"weight":450,"align":"left"}},
  "characterSlots": [
    {"slotId":"hero","label":"The child","description":"A child about 5 years old, the main character","ages":["young-child","older-child"],
     "example":{"name":"Mia","pronouns":"she/her"},"outfit":"a red long-sleeved top and blue trousers","stockSheet":"sheets/hero.svg"},
    {"slotId":"grownup","label":"A grown-up","description":"A parent or grandparent who comes along","ages":["adult","older-adult"],
     "example":{"name":"Joe","title":"Grandpa","pronouns":"he/him"},"outfit":"a blue jumper and grey trousers","stockSheet":"sheets/grownup.svg"},
  ],
  "photo": {"styleReference":"style/reference.svg","styleWords":"flat placeholder shapes with a dark outline","promptVersion":"photo-hero-v1"},
  "pages": manifest_pages,
}
json.dump(m, open(out + "/manifest.json","w"), indent=2, ensure_ascii=False)
json.dump({"id":"story_kite_day","slug":"the-kite-day","title":"The Kite Day","summary":"A child and a grown-up fly a kite on a windy hill. Sample photo story with placeholder art.","version":1,"publishedAt":"2026-11-24T12:00:00Z"}, open(out+"/story.json","w"), indent=2)
print("ok", out)
