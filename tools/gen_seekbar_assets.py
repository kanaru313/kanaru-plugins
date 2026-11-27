#!/usr/bin/env python3
"""Draws the PNG assets of seek bar plugins at 3x the size set in plugin.json.
Run from repo root or tools: python3 tools/gen_seekbar_assets.py"""
import math
import os
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEEKBAR_DIR = ROOT / "src" / "seekbar"

S = 4  # supersampling
SCALE = 3  # files are drawn at 3x the plugin.json size (dp), so they stay sharp on dense screens


def save(img: Image.Image, path: pathlib.Path, size: tuple[int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size[0] * SCALE, size[1] * SCALE), Image.LANCZOS).save(path)


def runner() -> None:
    n, w = 8, 32
    sheet = Image.new("RGBA", (n * w * S, w * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    lw = int(2.6 * S)
    for f in range(n):
        ph = 2 * math.pi * f / n
        ox = f * w * S
        P = lambda x, y: (ox + x * S, y * S)
        bob = 1.2 * abs(math.sin(ph))
        hip = (16, 17 - bob)
        neck = (17.5, 9.5 - bob)
        d.ellipse([P(15.5, 2.5 - bob), P(21.5, 8.5 - bob)], fill="black")
        d.line([P(*hip), P(*neck)], fill="black", width=lw)
        for side in (0, 1):
            a = ph + side * math.pi
            th = 0.75 * math.sin(a)
            kn = 0.9 * max(0.0, math.sin(a + 1.3)) + 0.25
            knee = (hip[0] + 6 * math.sin(th), hip[1] + 6 * math.cos(th))
            foot = (knee[0] + 6.5 * math.sin(th - kn), knee[1] + 6.5 * math.cos(th - kn))
            d.line([P(*hip), P(*knee), P(*foot)], fill="black", width=lw, joint="curve")
            ar = -0.8 * math.sin(a)
            elbow = (neck[0] + 4.5 * math.sin(ar), neck[1] + 1 + 4.5 * math.cos(ar))
            hand = (elbow[0] + 4 * math.sin(ar + 1.6), elbow[1] + 4 * math.cos(ar + 1.6))
            d.line([P(*neck), P(*elbow), P(*hand)], fill="black", width=lw, joint="curve")
    save(sheet, SEEKBAR_DIR / "runner" / "assets" / "runner.png", (n * w, w))


def snail() -> None:
    n, W, H = 2, 32, 24
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        P = lambda x, y: (ox + x * S, y * S)
        d.rounded_rectangle([P(3, 16), P(30, 22)], radius=3 * S, fill="#9ccf8c")
        tilt = 1.5 if f else 0
        for ex in (24, 27):
            d.line([P(ex, 17), P(ex + 1 + tilt, 8)], fill="#7fb36e", width=int(1.6 * S))
            d.ellipse([P(ex + tilt, 6.5), P(ex + 2.6 + tilt, 9.1)], fill="#2b2b2b")
        d.ellipse([P(5, 4), P(21, 20)], fill="#d9893d", outline="#9a5420", width=int(1.4 * S))
        for r in (5.5, 3, 1.2):
            d.arc([P(13 - r, 12 - r), P(13 + r, 12 + r)], 200, 520, fill="#9a5420", width=int(1.2 * S))
    save(sheet, SEEKBAR_DIR / "snail" / "assets" / "snail.png", (n * W, H))


def note() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.ellipse([P(2, 10), P(8, 15)], fill="black")
    d.rectangle([P(6.6, 2), P(8, 12.5)], fill="black")
    d.polygon([P(8, 2), P(13, 5), P(13, 7.5), P(8, 4.8)], fill="black")
    save(img, SEEKBAR_DIR / "notes" / "assets" / "note.png", (16, 16))


def cat() -> None:
    n, W, H = 8, 32, 28
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        P = lambda x, y: (ox + x * S, y * S)
        if f == 0:
            d.ellipse([P(8, 12), P(22, 23)], fill="black")
            d.ellipse([P(18, 7), P(27, 16)], fill="black")
            d.polygon([P(19, 9), P(20.5, 3.5), P(22.5, 8.5)], fill="black")
            d.polygon([P(23, 8.5), P(25, 3.5), P(26.5, 9)], fill="black")
            d.arc([P(5, 15), P(15, 24)], 90, 270, fill="black", width=int(1.8 * S))
            d.ellipse([P(14, 21), P(19, 24.5)], fill="black")
            d.ellipse([P(19, 21), P(24, 24.5)], fill="black")
        else:
            ph = 2 * math.pi * (f - 1) / 7
            bob = 0.8 * math.sin(2 * ph)
            by = 12 - bob
            d.rounded_rectangle([P(9, by), P(23, by + 9)], radius=int(3.5 * S), fill="black")
            d.ellipse([P(20, by - 5), P(28, by + 4)], fill="black")
            d.polygon([P(21, by - 3), P(22.5, by - 8.5), P(24.5, by - 3.5)], fill="black")
            d.polygon([P(25, by - 3.5), P(27, by - 8.5), P(28.5, by - 3)], fill="black")
            tail_tip = (6 + 2 * math.sin(ph), by - 4 + 2 * math.cos(ph))
            d.line([P(9, by + 3), P(*tail_tip)], fill="black", width=int(1.8 * S), joint="curve")
            lw = int(1.8 * S)
            sw1 = math.sin(ph)
            sw2 = math.sin(ph + math.pi)
            d.line([P(11, by + 7), P(11 + 3.5 * sw1, 24)], fill="black", width=lw)
            d.line([P(13, by + 7), P(13 + 3.5 * sw2, 24)], fill="black", width=lw)
            d.line([P(19, by + 7), P(19 + 3.5 * sw2, 24)], fill="black", width=lw)
            d.line([P(21, by + 7), P(21 + 3.5 * sw1, 24)], fill="black", width=lw)
    save(sheet, SEEKBAR_DIR / "cat" / "assets" / "cat.png", (n * W, H))


def star() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = 8 * S, 8 * S
    pts = []
    for i in range(10):
        r = (7 * S) if i % 2 == 0 else (2.8 * S)
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill="black")
    save(img, SEEKBAR_DIR / "starfall" / "assets" / "star.png", (16, 16))


def heart() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.ellipse([P(2, 2), P(9, 9)], fill="black")
    d.ellipse([P(7, 2), P(14, 9)], fill="black")
    d.polygon([P(2.2, 6.5), P(13.8, 6.5), P(8, 14.5)], fill="black")
    save(img, SEEKBAR_DIR / "heartbeat" / "assets" / "heart.png", (16, 16))


def bubble() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.ellipse([P(1.5, 1.5), P(14.5, 14.5)], outline="black", width=int(1.2 * S))
    d.arc([P(3.5, 3.5), P(12.5, 12.5)], 200, 260, fill="black", width=int(1.6 * S))
    save(img, SEEKBAR_DIR / "bubble" / "assets" / "bubble.png", (16, 16))


def firefly() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.ellipse([P(2, 2), P(14, 14)], fill=(0, 0, 0, 80))
    d.ellipse([P(4, 4), P(12, 12)], fill=(0, 0, 0, 180))
    d.ellipse([P(6, 6), P(10, 10)], fill="black")
    save(img, SEEKBAR_DIR / "firefly" / "assets" / "firefly.png", (16, 16))


def sakura() -> None:
    img = Image.new("RGBA", (14 * S, 14 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    pts = [P(7, 13), P(2, 6), P(4, 2), P(7, 4), P(10, 2), P(12, 6)]
    d.polygon(pts, fill="black")
    save(img, SEEKBAR_DIR / "sakura" / "assets" / "petal.png", (14, 14))


def cassette() -> None:
    n, W, H = 6, 32, 22
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        p = lambda x, y: (ox + x * S, y * S)
        d.rounded_rectangle([p(2, 2), p(30, 20)], radius=int(2.5 * S), fill="black")
        d.rounded_rectangle([p(7, 6), p(25, 16)], radius=int(1.5 * S), fill=(255, 255, 255, 230))
        ang = 2 * math.pi * f / n if f > 0 else 0
        for cx in (12, 20):
            d.ellipse([p(cx - 3, 8), p(cx + 3, 14)], fill="black")
            d.ellipse([p(cx - 1.2, 9.8), p(cx + 1.2, 12.2)], fill="white")
            for a in (ang, ang + math.pi / 2, ang + math.pi, ang + 3 * math.pi / 2):
                d.line([p(cx + 1.2 * math.cos(a), 11 + 1.2 * math.sin(a)),
                        p(cx + 2.8 * math.cos(a), 11 + 2.8 * math.sin(a))], fill="white", width=int(1.0 * S))
    save(sheet, SEEKBAR_DIR / "cassette" / "assets" / "cassette.png", (n * W, H))


def matrix() -> None:
    img = Image.new("RGBA", (12 * S, 12 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.rounded_rectangle([P(2, 2), P(10, 10)], radius=int(1.5 * S), fill="black")
    d.rectangle([P(4, 4), P(8, 8)], fill=(0, 0, 0, 0))
    d.rectangle([P(5, 5), P(7, 7)], fill="black")
    save(img, SEEKBAR_DIR / "matrix" / "assets" / "code.png", (12, 12))


def rocket() -> None:
    n, W, H = 4, 32, 24
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        p = lambda x, y: (ox + x * S, y * S)
        d.polygon([p(26, 12), p(12, 6), p(8, 7), p(8, 17), p(12, 18)], fill="black")
        d.polygon([p(12, 6), p(6, 3), p(8, 8)], fill="black")
        d.polygon([p(12, 18), p(6, 21), p(8, 16)], fill="black")
        d.ellipse([p(16, 10), p(20, 14)], fill=(255, 255, 255, 200))
        if f > 0:
            fl_len = 6 + (f % 2) * 2.5
            d.polygon([p(8, 9), p(8 - fl_len, 12), p(8, 15)], fill="black")
    save(sheet, SEEKBAR_DIR / "rocket" / "assets" / "rocket.png", (n * W, H))

    # flame smoke particle
    s_img = Image.new("RGBA", (12 * S, 12 * S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(s_img)
    P = lambda x, y: (x * S, y * S)
    sd.ellipse([P(2, 2), P(10, 10)], fill="black")
    save(s_img, SEEKBAR_DIR / "rocket" / "assets" / "smoke.png", (12, 12))


def flame() -> None:
    img = Image.new("RGBA", (12 * S, 12 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.polygon([P(6, 1), P(10, 6), P(6, 11), P(2, 6)], fill="black")
    save(img, SEEKBAR_DIR / "flame" / "assets" / "ember.png", (12, 12))


def ghost() -> None:
    n, W, H = 6, 28, 26
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        p = lambda x, y: (ox + x * S, y * S)
        bob = 1.2 * math.sin(2 * math.pi * f / n) if f > 0 else 0
        by = 5 - bob
        d.ellipse([p(6, by), p(22, by + 16)], fill="black")
        d.rectangle([p(6, by + 8), p(22, by + 17)], fill="black")
        w_off = math.sin(2 * math.pi * f / n) * 1.5 if f > 0 else 0
        d.polygon([p(6, by + 17), p(10, by + 20 + w_off), p(14, by + 17), p(18, by + 20 - w_off), p(22, by + 17), p(6, by + 17)], fill="black")
        d.ellipse([p(10, by + 6), p(13, by + 10)], fill=(255, 255, 255, 220))
        d.ellipse([p(16, by + 6), p(19, by + 10)], fill=(255, 255, 255, 220))
    save(sheet, SEEKBAR_DIR / "ghost" / "assets" / "ghost.png", (n * W, H))


def coffee() -> None:
    img = Image.new("RGBA", (26 * S, 24 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    d.rounded_rectangle([P(4, 7), P(18, 21)], radius=int(3 * S), fill="black")
    d.arc([P(15, 9), P(23, 19)], -90, 90, fill="black", width=int(1.8 * S))
    save(img, SEEKBAR_DIR / "coffee" / "assets" / "cup.png", (26, 24))

    st_img = Image.new("RGBA", (12 * S, 12 * S), (0, 0, 0, 0))
    std = ImageDraw.Draw(st_img)
    std.arc([P(3, 2), P(9, 6)], 90, 270, fill="black", width=int(1.5 * S))
    std.arc([P(3, 6), P(9, 10)], -90, 90, fill="black", width=int(1.5 * S))
    save(st_img, SEEKBAR_DIR / "coffee" / "assets" / "steam.png", (12, 12))


def fish() -> None:
    n, W, H = 6, 32, 20
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        p = lambda x, y: (ox + x * S, y * S)
        sw = math.sin(2 * math.pi * f / n) * 3 if f > 0 else 0
        d.ellipse([p(12, 4), p(28, 16)], fill="black")
        d.polygon([p(14, 10), p(4, 5 + sw), p(6, 10), p(3, 15 + sw)], fill="black")
        d.polygon([p(18, 4), p(22, 1), p(24, 4)], fill="black")
        d.ellipse([p(23, 7), p(25.5, 9.5)], fill=(255, 255, 255, 220))
    save(sheet, SEEKBAR_DIR / "fish" / "assets" / "fish.png", (n * W, H))


def autumn() -> None:
    img = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda x, y: (x * S, y * S)
    pts = [P(8, 1), P(10, 5), P(14, 4), P(12, 8), P(15, 11), P(10, 11), P(8, 15), P(6, 11), P(1, 11), P(4, 8), P(2, 4), P(6, 5)]
    d.polygon(pts, fill="black")
    save(img, SEEKBAR_DIR / "autumn" / "assets" / "leaf.png", (16, 16))


def car() -> None:
    n, W, H = 4, 36, 22
    sheet = Image.new("RGBA", (n * W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheet)
    for f in range(n):
        ox = f * W * S
        p = lambda x, y: (ox + x * S, y * S)
        vib = (0.5 if f % 2 else 0) if f > 0 else 0
        d.rounded_rectangle([p(4, 8 - vib), p(32, 16 - vib)], radius=int(3 * S), fill="black")
        d.polygon([p(12, 8 - vib), p(16, 3 - vib), p(23, 3 - vib), p(26, 8 - vib)], fill="black")
        ang = 2 * math.pi * f / n if f > 0 else 0
        for cx in (10, 26):
            d.ellipse([p(cx - 3.5, 14), p(cx + 3.5, 21)], fill="black")
            d.ellipse([p(cx - 1.5, 16), p(cx + 1.5, 19)], fill=(255, 255, 255, 220))
            d.line([p(cx + 1.5 * math.cos(ang), 17.5 + 1.5 * math.sin(ang)),
                    p(cx - 1.5 * math.cos(ang), 17.5 - 1.5 * math.sin(ang))], fill="black", width=int(1.0 * S))
    save(sheet, SEEKBAR_DIR / "car" / "assets" / "car.png", (n * W, H))


def generate_all() -> None:
    runner()
    snail()
    note()
    cat()
    star()
    heart()
    bubble()
    firefly()
    sakura()
    cassette()
    matrix()
    rocket()
    flame()
    ghost()
    coffee()
    fish()
    autumn()
    car()
    print("ok: generated assets for all 22 seekbar plugins")


if __name__ == "__main__":
    generate_all()
