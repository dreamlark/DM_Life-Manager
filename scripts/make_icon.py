import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"D:\software\WorkBuddy\workspace\2026-07-06-21-41-50\dm-life"
OUT = os.path.join(ROOT, "assets", "DMlife.ico")
SIZE = 256
PAD = 18  # 四周留白，让主体“悬空”


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(size, top, bottom):
    """竖向渐变 RGBA（带 alpha 255）"""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = lerp(top, bottom, t)
        for x in range(w):
            px[x, y] = (c[0], c[1], c[2], 255)
    return img


def soft_round_mask(size, inset, radius, feather=6):
    """羽化的圆角矩形遮罩（用于渐变背景柔和边缘）"""
    w, h = size
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [inset, inset, w - inset, h - inset], radius=radius, fill=255
    )
    return m.filter(ImageFilter.GaussianBlur(feather))


def super_sample(draw_fn, scale=4):
    """高分辨率离屏绘制后再缩回 SIZE，得到平滑（类矢量）边缘"""
    big = Image.new("RGBA", (SIZE * scale, SIZE * scale), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(big), scale)
    return big.resize((SIZE, SIZE), Image.LANTIAS if hasattr(Image, "LANTIAS") else Image.LANCZOS)


# ============ 1) 背景：圆角渐变 + 内描边 + 顶部柔光 ============
bg = vgrad((SIZE, SIZE), (124, 130, 255), (43, 39, 120))  # indigo 亮→深
bgmask = soft_round_mask((SIZE, SIZE), PAD, 54, feather=5)
base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
base.paste(bg, (0, 0), bgmask)
# 内描边（玻璃质感）
ImageDraw.Draw(base).rounded_rectangle(
    [PAD + 1, PAD + 1, SIZE - PAD - 1, SIZE - PAD - 1],
    radius=53, outline=(255, 255, 255, 60), width=2,
)
# 顶部柔光带
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([-40, -70, SIZE + 40, 120], fill=(255, 255, 255, 70))
glow = glow.filter(ImageFilter.GaussianBlur(22))
base = Image.alpha_composite(base, glow)

# ============ 2) 悬浮投影（让宝石“浮起”）============
SH_X, SH_Y, SH_BLUR = 0, 30, 14
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
cx, cy = SIZE // 2 + SH_X, int(SIZE * 0.62) + SH_Y
sd.ellipse([cx - 52, cy - 16, cx + 52, cy + 16], fill=(10, 8, 30, 120))
shadow = shadow.filter(ImageFilter.GaussianBlur(SH_BLUR))

# ============ 3) 主体：动漫彩绘风立体钻石宝石（DM）============
# 宝石几何：上半菱形（冠部）+ 下半梯形（亭部），cel-shading 多面
gem_cx = SIZE // 2
gem_cy = int(SIZE * 0.46)
W = 96   # 半宽
H_top = 58
H_bot = 78


def draw_gem(d, s):
    sc = s  # scale factor
    cx = gem_cx * sc
    cy = gem_cy * sc
    w = W * sc
    htop = H_top * sc
    hbot = H_bot * sc
    table_y = cy - int(htop * 0.45)      # 顶部台面
    crown_y = cy - htop                  # 冠尖
    girdle_y = cy + int(hbot * 0.12)     # 腰线
    tip_y = cy + hbot                    # 底尖

    # 整体轮廓（用于裁剪各面颜色）
    outline = [
        (cx - w, girdle_y),
        (cx - w * 0.46, crown_y),
        (cx + w * 0.46, crown_y),
        (cx + w, girdle_y),
        (cx + w * 0.34, tip_y),
        (cx - w * 0.34, tip_y),
    ]

    # —— 各刻面（cel-shading：亮/中/暗三档 + 描边）——
    # 左冠面（亮）
    d.polygon([(cx - w, girdle_y), (cx - w * 0.46, crown_y), (cx, table_y), (cx, girdle_y)],
              fill=(150, 200, 255, 255))
    # 右冠面（中）
    d.polygon([(cx + w, girdle_y), (cx + w * 0.46, crown_y), (cx, table_y), (cx, girdle_y)],
              fill=(110, 150, 245, 255))
    # 中冠面（最亮，朝向光）
    d.polygon([(cx - w * 0.46, crown_y), (cx + w * 0.46, crown_y), (cx, table_y)],
              fill=(200, 230, 255, 255))
    # 左亭面（暗）
    d.polygon([(cx - w, girdle_y), (cx, girdle_y), (cx, tip_y), (cx - w * 0.34, tip_y)],
              fill=(70, 95, 200, 255))
    # 右亭面（中暗）
    d.polygon([(cx + w, girdle_y), (cx, girdle_y), (cx, tip_y), (cx + w * 0.34, tip_y)],
              fill=(92, 120, 220, 255))
    # 底尖高光面（窄亮条）
    d.polygon([(cx - w * 0.34, tip_y), (cx + w * 0.34, tip_y), (cx, tip_y - 10 * sc)],
              fill=(175, 210, 255, 255))

    # 描边（动漫线稿感）
    d.line(outline + [outline[0]], fill=(255, 255, 255, 150), width=max(2, int(2 * sc)))
    # 腰线
    d.line([(cx - w, girdle_y), (cx + w, girdle_y)], fill=(255, 255, 255, 120), width=max(2, int(2 * sc)))

    # 镜面高光（左上）
    d.ellipse([cx - w * 0.62, crown_y - 6 * sc, cx - w * 0.18, crown_y + htop * 0.5],
              fill=(255, 255, 255, 180))
    # 小星光点
    sx, sy = cx + w * 0.3, crown_y + htop * 0.2
    d.ellipse([sx - 5 * sc, sy - 5 * sc, sx + 5 * sc, sy + 5 * sc], fill=(255, 255, 255, 220))


gem_layer = super_sample(draw_gem, scale=4)
gem_layer = gem_layer.filter(ImageFilter.GaussianBlur(0.4))  # 极轻微抗锯齿

# ============ 4) 合成分层：背景 → 投影 → 外发光 → 宝石 ============
# 宝石外发光（让悬浮更明显）
bloom = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gb = ImageDraw.Draw(bloom)
gb.ellipse([gem_cx - W - 18, gem_cy - H_top - 18, gem_cx + W + 18, gem_cy + H_bot + 6],
           fill=(120, 170, 255, 80))
bloom = bloom.filter(ImageFilter.GaussianBlur(18))

# 由底向上合成：渐变背景 → 悬浮投影 → 外发光 → 立体宝石
canvas = base
canvas = Image.alpha_composite(canvas, shadow)
canvas = Image.alpha_composite(canvas, bloom)
canvas = Image.alpha_composite(canvas, gem_layer)

# ============ 5) 下方 “DM” 字标（动漫圆体，带描边投影）============
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]
font = None
for fp in FONT_CANDIDATES:
    if os.path.exists(fp):
        try:
            font = ImageFont.truetype(fp, 52)
            break
        except Exception:
            continue
if font is None:
    font = ImageFont.load_default()

txt = "DM"
d = ImageDraw.Draw(canvas)
bbox = d.textbbox((0, 0), txt, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
tx = (SIZE - tw) / 2 - bbox[0]
ty = int(SIZE * 0.74) - bbox[1]
# 描边
for ox in (-1, 1):
    for oy in (-1, 1):
        d.text((tx + ox, ty + oy), txt, font=font, fill=(20, 24, 60, 230))
d.text((tx, ty), txt, font=font, fill=(255, 255, 255, 255))

# ============ 6) 导出多分辨率 ICO ============
canvas = canvas.convert("RGBA")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
canvas.save(
    OUT,
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icon written:", OUT, "size(KB)=%.1f" % (os.path.getsize(OUT) / 1024.0))
