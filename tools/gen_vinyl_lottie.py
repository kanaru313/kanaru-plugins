#!/usr/bin/env python3
"""Writes src/seekbar/vinyl/assets/vinyl.json: a Lottie (bodymovin 5.7) record that turns once every 2 s at 30 fps.
The label group is named "label" so a plugin can recolour it with the theme ("recolor": {"label": "primary"}).
Run from repo root or tools: python3 tools/gen_vinyl_lottie.py"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "seekbar" / "vinyl" / "assets" / "vinyl.json"

S = lambda v: {"a": 0, "k": v}


def tr():
    return {"ty": "tr", "p": S([0, 0]), "a": S([0, 0]), "s": S([100, 100]), "r": S(0), "o": S(100), "sk": S(0), "sa": S(0), "nm": "t"}


def ell(size, fill=None, stroke=None, w=1, nm="e", pos=(0, 0)):
    it = [{"ty": "el", "p": S(list(pos)), "s": S([size, size]), "d": 1, "nm": "p"}]
    if stroke:
        it.append({"ty": "st", "c": S(stroke), "o": S(100), "w": S(w), "lc": 2, "lj": 2, "ml": 4, "nm": "s"})
    if fill:
        it.append({"ty": "fl", "c": S(fill), "o": S(100), "r": 1, "nm": "f"})
    it.append(tr())
    return {"ty": "gr", "nm": nm, "it": it}


def rect(w, h, fill, nm, pos=(0, 0), o=100):
    return {"ty": "gr", "nm": nm, "it": [{"ty": "rc", "p": S(list(pos)), "s": S([w, h]), "r": S(h / 2), "d": 1, "nm": "p"},
                                         {"ty": "fl", "c": S(fill), "o": S(o), "r": 1, "nm": "f"}, tr()]}


black, groove, white = [0.07, 0.07, 0.08, 1], [0.32, 0.32, 0.34, 1], [1, 1, 1, 1]
shapes = [
    ell(4, fill=white, nm="hole"),
    rect(9, 2.4, [0.2, 0.1, 0.05, 1], "stripe", pos=(5.5, 0), o=70),
    ell(22, fill=[0.85, 0.45, 0.2, 1], nm="label"),
    rect(26, 3, white, "shine", pos=(0, -21), o=22),
    ell(50, stroke=groove, w=0.8, nm="groove1"),
    ell(40, stroke=groove, w=0.8, nm="groove2"),
    ell(31, stroke=groove, w=0.8, nm="groove3"),
    ell(60, fill=black, nm="disc"),
]
rot = {"a": 1, "k": [{"t": 0, "s": [0], "i": {"x": [1], "y": [1]}, "o": {"x": [0], "y": [0]}}, {"t": 60, "s": [360]}]}
anim = {"v": "5.7.4", "fr": 30, "ip": 0, "op": 60, "w": 64, "h": 64, "nm": "vinyl", "ddd": 0, "assets": [],
        "layers": [{"ddd": 0, "ind": 1, "ty": 4, "nm": "record", "sr": 1, "ao": 0, "ip": 0, "op": 60, "st": 0, "bm": 0,
                    "ks": {"o": S(100), "r": rot, "p": S([32, 32, 0]), "a": S([0, 0, 0]), "s": S([100, 100, 100])},
                    "shapes": shapes}]}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(anim, f, separators=(",", ":"))
    print("ok: wrote vinyl/assets/vinyl.json")


if __name__ == "__main__":
    main()
