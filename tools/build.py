#!/usr/bin/env python3
"""Zip each plugin in src/<type>/<slug>/ into a flat build folder per slug, and write plugins.json."""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, DIST = ROOT / "src", ROOT / "dist"
CATALOG_META = {"name": "Kanaru plugins", "author": "kanaru313"}

KINDS = {"bars", "dots", "line", "mirror", "squig", "flat"}
TRACK_KEYS = {"kind", "density", "color", "rest", "amplitude", "wavelength", "motion", "thumb", "thickness"}
ROLES = {"primary", "secondary", "tertiary", "onSurface", "onSurfaceVariant"}


def _colour(slug: str, v: str) -> None:
    if v in ROLES or (isinstance(v, str) and len(v) == 7 and v[0] == "#"):
        return
    raise SystemExit(f"{slug}: colour {v!r}: theme role or #rrggbb")


def check_seekbar(plugin_dir: pathlib.Path, p: dict) -> None:
    slug = plugin_dir.name
    m, s = p.get("metadata", {}), p.get("seekbar")
    if m.get("type") != "seekbar":
        raise SystemExit(f"{slug}: metadata.type must be seekbar")
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


def build_one(plugin_dir: pathlib.Path) -> dict:
    manifest = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))
    meta = manifest["metadata"]
    slug = plugin_dir.name
    if meta.get("type") == "seekbar":
        check_seekbar(plugin_dir, manifest)
    out = DIST / slug
    out.mkdir(parents=True, exist_ok=True)
    zip_path = out / "plugin.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(plugin_dir.rglob("*")):
            if f.is_file():
                # Fixed timestamp so an unchanged plugin gives the same zip.
                info = zipfile.ZipInfo(f.relative_to(plugin_dir).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    entry = {
        "slug": slug,
        "name": meta["name"],
        "version": meta["version"],
        "apiVersion": meta.get("apiVersion", 1),
        "type": meta["type"],
        "hosts": meta.get("hosts", []),
        "path": f"dist/{slug}/plugin.zip",
    }
    for key in ("author", "description", "languages"):
        if key in meta:
            entry[key] = meta[key]
    if (plugin_dir / "icon.png").exists():
        (out / "icon.png").write_bytes((plugin_dir / "icon.png").read_bytes())
        entry["icon"] = f"dist/{slug}/icon.png"
    return entry


def plugin_dirs() -> list[pathlib.Path]:
    """Plugins sit in src/<type>/<slug>/; the type folder must match metadata.type."""
    found = []
    for type_dir in sorted(SRC.iterdir()) if SRC.exists() else []:
        if not type_dir.is_dir():
            continue
        for plugin_dir in sorted(type_dir.iterdir()):
            if (plugin_dir / "plugin.json").exists():
                meta = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))["metadata"]
                if meta["type"] != type_dir.name:
                    raise SystemExit(f"{plugin_dir}: type {meta['type']!r} is not its folder {type_dir.name!r}")
                found.append(plugin_dir)
    return sorted(found, key=lambda p: p.name)  # catalog order stays by slug


def main() -> None:
    data = [build_one(d) for d in plugin_dirs()]
    catalog = {"metadata": CATALOG_META, "data": data}
    (ROOT / "plugins.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data)} plugin(s) built")


if __name__ == "__main__":
    main()

