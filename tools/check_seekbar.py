#!/usr/bin/env python3
"""Check that every seekbar plugin in src/seekbar/<slug>/ follows the v1 schema and rules.
Run from repo root or tools: python3 tools/check_seekbar.py"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEEKBAR_DIR = ROOT / "src" / "seekbar"

KINDS = {"bars", "dots", "line", "mirror", "squig", "flat"}
TRACK_KEYS = {"kind", "density", "color", "rest", "amplitude", "wavelength", "motion", "thumb", "thickness"}
ROLES = {"primary", "secondary", "tertiary", "onSurface", "onSurfaceVariant"}


def _colour(slug: str, v: str) -> None:
    if v in ROLES or (isinstance(v, str) and len(v) == 7 and v[0] == "#"):
        return
    raise SystemExit(f"{slug}: colour {v!r}: theme role or #rrggbb")


def check_plugin(plugin_dir: pathlib.Path) -> None:
    slug = plugin_dir.name
    pj = plugin_dir / "plugin.json"
    if not pj.is_file():
        raise SystemExit(f"{slug}: plugin.json not found")
    p = json.loads(pj.read_text(encoding="utf-8"))
    m, s = p.get("metadata", {}), p.get("seekbar")
    if m.get("type") != "seekbar":
        raise SystemExit(f"{slug}: metadata.type must be seekbar")
    if m.get("slug") and m.get("slug") != slug:
        raise SystemExit(f"{slug}: metadata.slug must match folder name")
    for k in ("name", "version", "author", "license"):
        if k not in m:
            raise SystemExit(f"{slug}: metadata.{k} missing")
    if not isinstance(s, dict) or "track" not in s:
        raise SystemExit(f"{slug}: seekbar.track missing")
    t = s["track"]
    if t.get("kind") not in KINDS:
        raise SystemExit(f"{slug}: track.kind must be one of {sorted(KINDS)}")
    if set(t) - TRACK_KEYS:
        raise SystemExit(f"{slug}: unknown track keys {sorted(set(t) - TRACK_KEYS)}")
    for v in s.get("colors", {}).values():
        _colour(slug, v)
    if not 0.2 <= s.get("baseline", 0.5) <= 0.9:
        raise SystemExit(f"{slug}: baseline 0.2–0.9")
    if not 0 <= s.get("glow", 0) <= 16:
        raise SystemExit(f"{slug}: glow 0–16")
    for part in ("thumb", "emitter"):
        a = s.get(part)
        if not a:
            continue
        src = a.get("image") or (a.get("lottie") if part == "thumb" else None)
        if not src or ("image" in a and "lottie" in a):
            raise SystemExit(f"{slug}: {part}: exactly one of image / lottie (lottie only for thumb)")
        if not (plugin_dir / src).is_file():
            raise SystemExit(f"{slug}: {part} file {src} not found")
        if "lottie" in a:
            lot = json.loads((plugin_dir / src).read_text(encoding="utf-8"))
            if lot.get("assets") or any(l.get("ty") not in (3, 4) for l in lot.get("layers", [])):
                raise SystemExit(f"{slug}: lottie: only shape and null layers, no images, no expressions")
            if len(lot.get("layers", [])) > 20 or lot.get("op", 0) - lot.get("ip", 0) > 300:
                raise SystemExit(f"{slug}: lottie: at most 20 layers and 300 frames")
            if '"x":"' in json.dumps(lot):
                raise SystemExit(f"{slug}: lottie: expressions are not allowed")
            for v in a.get("recolor", {}).values():
                _colour(slug, v)
        w, h = a["size"]
        if not (4 <= w <= 64 and 4 <= h <= 56):
            raise SystemExit(f"{slug}: {part}.size: width 4–64 px, height 4–56 px (the seek bar band is 56 high)")
        if "tint" in a:
            _colour(slug, a["tint"])
    th = s.get("thumb")
    if th and th.get("paused", 0) != "freeze" and not isinstance(th.get("paused", 0), int):
        raise SystemExit(f"{slug}: thumb.paused: a frame index or \"freeze\"")
    if th and not (1 <= th.get("frames", 1) <= 64 and 1 <= th.get("fps", 12) <= 30):
        raise SystemExit(f"{slug}: thumb.frames 1–64, thumb.fps 1–30")
    em = s.get("emitter")
    if em and not (0 < em["rate"] <= 20 and max(em["life"]) <= 3):
        raise SystemExit(f"{slug}: emitter.rate ≤ 20 per second, emitter.life ≤ 3 s")
    size = sum(f.stat().st_size for f in plugin_dir.rglob("*") if f.is_file())
    if size > 1024 * 1024:
        raise SystemExit(f"{slug}: the skin is larger than 1 MB")
    print(f"✓ {slug}: valid")


def main() -> None:
    if not SEEKBAR_DIR.exists():
        raise SystemExit("No src/seekbar directory found")
    dirs = [d for d in sorted(SEEKBAR_DIR.iterdir()) if d.is_dir() and (d / "plugin.json").exists()]
    if not dirs:
        raise SystemExit("No seekbar plugins found in src/seekbar")
    for d in dirs:
        check_plugin(d)
    print(f"\nAll {len(dirs)} seekbar plugin(s) passed validation.")


if __name__ == "__main__":
    main()
