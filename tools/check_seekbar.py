#!/usr/bin/env python3
"""Check that every seekbar plugin in src/seekbar/<slug>/ follows the seekbar format v1 rules.

The rules mirror what the Kanaru app enforces at install time (strict, first problem wins,
the message names the key path). Lottie rules are unchanged from the first version.

  python3 -I tools/check_seekbar.py             check every sample
  python3 -I tools/check_seekbar.py --selftest  build hostile manifests in memory, each must be refused
"""
import io
import json
import pathlib
import re
import struct
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEEKBAR_DIR = ROOT / "src" / "seekbar"

MIB = 1024 * 1024
ROLES = {"primary", "secondary", "tertiary", "onSurface", "onSurfaceVariant"}
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
ASSET = re.compile(r"^assets/[A-Za-z0-9_.-]{1,64}\.(png|webp)$")
LOTTIE_ASSET = re.compile(r"^assets/[A-Za-z0-9_.-]{1,64}\.json$")

WAVE = {"density": {"loose", "mid", "dense"}, "color": {"solid", "grad", "height"}, "rest": {"dim", "outline", "hide"}}
KIND_KEYS = {
    **{k: WAVE for k in ("bars", "dots", "line", "mirror")},
    "squig": {"amplitude": {"low", "mid", "high"}, "wavelength": {"short", "mid", "long"},
              "motion": {"drift", "music", "still"}, "thumb": {"bar", "dot", "none"}},
    "flat": {"thickness": {"thin", "mid", "thick"}, "thumb": {"bar", "dot", "none"}, "color": {"solid", "grad"}},
}
TOP_KEYS = {"track", "colors", "baseline", "glow", "thumb", "emitter"}
SPRITE_KEYS = {"image", "frames", "fps", "size", "anchor", "tint", "paused"}
LOTTIE_KEYS = {"lottie", "size", "anchor", "recolor", "paused"}
EMITTER_KEYS = {"image", "tint", "size", "rate", "life", "velocity", "spin", "fade"}


class Problem(Exception):
    pass


def bad(path: str, why: str):
    raise Problem(f"{path}: {why}")


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def colour(path: str, v) -> None:
    if isinstance(v, str) and (v in ROLES or HEX.match(v)):
        return
    bad(path, f"{v!r}: a theme role ({', '.join(sorted(ROLES))}) or # plus 6 hex digits")


def pair(path: str, v, lo: float, hi: float, ints: bool = False):
    if not isinstance(v, list) or len(v) != 2 or not all(is_num(x) for x in v):
        bad(path, "must be [a, b] numbers")
    if not all(lo <= x <= hi for x in v):
        bad(path, f"values must be {lo}..{hi}")
    return v


def range_pair(path: str, v, lo: float, hi: float):
    pair(path, v, lo, hi)
    if v[0] > v[1]:
        bad(path, "min must be <= max")


# ---- images: header only, like the app --------------------------------------------------------

def image_info(path: str, data: bytes) -> tuple[int, int]:
    """Returns (width, height); refuses anything that is not a plain PNG / WebP."""
    ext = path.rsplit(".", 1)[-1]
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        kind = "png"
        if data[12:16] != b"IHDR" or len(data) < 24:
            bad(path, "PNG: IHDR missing")
        w, h = struct.unpack(">II", data[16:24])
        pos = 8
        while pos + 8 <= len(data):
            ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
            if typ == b"acTL":
                bad(path, "animated PNG is not allowed")
            if typ == b"IDAT":
                break
            pos += 12 + ln
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = "webp"
        fourcc = data[12:16]
        if fourcc == b"VP8 ":
            if data[23:26] != b"\x9d\x01\x2a":
                bad(path, "WebP: bad VP8 frame header")
            w, h = struct.unpack("<HH", data[26:30])
            w, h = w & 0x3FFF, h & 0x3FFF
        elif fourcc == b"VP8L":
            if data[20] != 0x2F:
                bad(path, "WebP: bad VP8L signature")
            bits = struct.unpack("<I", data[21:25])[0]
            w, h = (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        elif fourcc == b"VP8X":
            if data[20] & 0x02:
                bad(path, "animated WebP is not allowed")
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
        else:
            bad(path, "WebP: unknown chunk")
    else:
        bad(path, "not a PNG or WebP image")
    if kind != ext:
        bad(path, f"extension .{ext} does not match the {kind.upper()} data")
    if not (1 <= w <= 2048 and 1 <= h <= 2048):
        bad(path, f"{w}x{h}: each side must be 1..2048 px")
    return w, h


# ---- manifest ---------------------------------------------------------------------------------

def check_track(t) -> None:
    if not isinstance(t, dict):
        bad("seekbar.track", "must be an object")
    kind = t.get("kind")
    if kind not in KIND_KEYS:
        bad("seekbar.track.kind", f"must be one of {sorted(KIND_KEYS)}")
    allowed = KIND_KEYS[kind]
    for k, v in t.items():
        if k == "kind":
            continue
        if k not in allowed:
            bad(f"seekbar.track.{k}", f"not a key of kind {kind}")
        if v not in allowed[k]:
            bad(f"seekbar.track.{k}", f"must be one of {sorted(allowed[k])}")


def check_image_part(part: str, a: dict, files: dict, used: set, frames_ok: bool):
    """Checks `image` + `size` (+ `tint`); returns (width, height) of the image."""
    img = a.get("image")
    if not isinstance(img, str) or not ASSET.match(img):
        bad(f"seekbar.{part}.image", "assets/<A-Za-z0-9_.->.png or .webp (name 1-64 chars)")
    if img not in files:
        bad(f"seekbar.{part}.image", f"{img} is not in the package")
    used.add(img)
    data = files[img]
    if len(data) > 512 * 1024:
        bad(f"seekbar.{part}.image", "image file is larger than 512 KiB")
    return image_info(img, data)


def check_size_anchor(part: str, a: dict) -> None:
    if "size" not in a:
        bad(f"seekbar.{part}.size", "required")
    s = a["size"]
    if not isinstance(s, list) or len(s) != 2 or not all(is_num(x) for x in s):
        bad(f"seekbar.{part}.size", "must be [w, h] numbers")
    if not (4 <= s[0] <= 64 and 4 <= s[1] <= 56):
        bad(f"seekbar.{part}.size", "width 4-64, height 4-56 (the seek bar band is 56 high)")
    if "anchor" in a:
        pair(f"seekbar.{part}.anchor", a["anchor"], 0, 1)
    if "tint" in a:
        colour(f"seekbar.{part}.tint", a["tint"])


def check_thumb(th, files: dict, used: set) -> None:
    if not isinstance(th, dict):
        bad("seekbar.thumb", "must be an object")
    lottie = "lottie" in th
    if lottie == ("image" in th):
        bad("seekbar.thumb", "exactly one of image / lottie")
    for k in th:
        if k not in (LOTTIE_KEYS if lottie else SPRITE_KEYS):
            bad(f"seekbar.thumb.{k}", "unknown key")
    check_size_anchor("thumb", th)
    if lottie:
        src = th["lottie"]
        if not isinstance(src, str) or not LOTTIE_ASSET.match(src):
            bad("seekbar.thumb.lottie", "assets/<name>.json")
        if src not in files:
            bad("seekbar.thumb.lottie", f"{src} is not in the package")
        used.add(src)
        if len(files[src]) > 256 * 1024:
            bad("seekbar.thumb.lottie", "Lottie file is larger than 256 KiB")
        lot = json.loads(files[src].decode("utf-8"))
        if lot.get("assets") or any(l.get("ty") not in (3, 4) for l in lot.get("layers", [])):
            bad("seekbar.thumb.lottie", "only shape and null layers, no images, no expressions")
        if len(lot.get("layers", [])) > 20 or lot.get("op", 0) - lot.get("ip", 0) > 300:
            bad("seekbar.thumb.lottie", "at most 20 layers and 300 frames")
        if '"x":"' in json.dumps(lot):
            bad("seekbar.thumb.lottie", "expressions are not allowed")
        if "recolor" in th:
            if not isinstance(th["recolor"], dict):
                bad("seekbar.thumb.recolor", "must be an object")
            for k, v in th["recolor"].items():
                colour(f"seekbar.thumb.recolor.{k}", v)
        p = th.get("paused", 0)
        if p != "freeze" and not is_int(p):
            bad("seekbar.thumb.paused", 'a frame index or "freeze"')
        return
    w, _ = check_image_part("thumb", th, files, used, True)
    frames, fps = th.get("frames", 1), th.get("fps", 12)
    if not is_int(frames) or not 1 <= frames <= 64:
        bad("seekbar.thumb.frames", "integer 1..64")
    if not is_int(fps) or not 1 <= fps <= 30:
        bad("seekbar.thumb.fps", "integer 1..30")
    if w % frames:
        bad("seekbar.thumb.frames", f"image width {w} is not divisible by {frames}")
    p = th.get("paused", 0)
    if not is_int(p) or not 0 <= p <= frames - 1:
        bad("seekbar.thumb.paused", f"integer 0..{frames - 1}")


def check_emitter(em, files: dict, used: set) -> None:
    if not isinstance(em, dict):
        bad("seekbar.emitter", "must be an object")
    for k in em:
        if k not in EMITTER_KEYS:
            bad(f"seekbar.emitter.{k}", "unknown key")
    check_image_part("emitter", em, files, used, False)
    check_size_anchor("emitter", em)
    for k in ("rate", "life", "velocity"):
        if k not in em:
            bad(f"seekbar.emitter.{k}", "required")
    if not is_num(em["rate"]) or not 0 < em["rate"] <= 20:
        bad("seekbar.emitter.rate", "0 < rate <= 20 per second")
    range_pair("seekbar.emitter.life", em["life"], 0, 3)
    if em["life"][0] <= 0:
        bad("seekbar.emitter.life", "min must be > 0")
    v = em["velocity"]
    if not isinstance(v, dict) or set(v) != {"x", "y"}:
        bad("seekbar.emitter.velocity", "must be {x: [min, max], y: [min, max]}")
    for ax in ("x", "y"):
        range_pair(f"seekbar.emitter.velocity.{ax}", v[ax], -200, 200)
    if "spin" in em:
        range_pair("seekbar.emitter.spin", em["spin"], -720, 720)
    if "fade" in em and not isinstance(em["fade"], bool):
        bad("seekbar.emitter.fade", "must be true or false")


def validate(slug: str, p: dict, files: dict) -> None:
    """files: package path -> bytes, plugin.json included. Raises Problem."""
    m, s = p.get("metadata"), p.get("seekbar")
    if not isinstance(m, dict):
        bad("metadata", "missing")
    if m.get("apiVersion") != 1 or isinstance(m.get("apiVersion"), bool):
        bad("metadata.apiVersion", "must be 1")
    if m.get("type") != "seekbar":
        bad("metadata.type", "must be seekbar")
    if m.get("slug") and m["slug"] != slug:
        bad("metadata.slug", "must match the folder name")
    for k, lim in (("name", 80), ("author", 80)):
        if not isinstance(m.get(k), str) or not 1 <= len(m[k]) <= lim:
            bad(f"metadata.{k}", f"text 1..{lim} (author is required by this repo)")
    if not isinstance(m.get("version"), (int, str)) or isinstance(m.get("version"), bool):
        bad("metadata.version", "missing")
    if "description" in m and (not isinstance(m["description"], str) or len(m["description"]) > 500):
        bad("metadata.description", "text up to 500")
    if not isinstance(m.get("license"), str) or not 1 <= len(m["license"]) <= 64:
        bad("metadata.license", "required text 1..64")
    if m.get("hosts", []) != []:
        bad("metadata.hosts", "must be absent or []")
    if "script" in p:
        bad("script", "seekbar plugins carry no code")
    if p.get("config"):
        bad("config", "seekbar plugins have no options")
    if any(re.match(r"^src/.*\.js$", n) for n in files):
        bad("src", "seekbar plugins carry no code (src/*.js)")
    if not isinstance(s, dict):
        bad("seekbar", "missing")
    for k in s:
        if k not in TOP_KEYS:
            bad(f"seekbar.{k}", "unknown key")
    if "track" not in s:
        bad("seekbar.track", "required")
    check_track(s["track"])
    if "colors" in s:
        c = s["colors"]
        if not isinstance(c, dict):
            bad("seekbar.colors", "must be an object")
        for k, v in c.items():
            if k not in ("primary", "secondary"):
                bad(f"seekbar.colors.{k}", "unknown key")
            colour(f"seekbar.colors.{k}", v)
    if "baseline" in s and not (is_num(s["baseline"]) and 0.2 <= s["baseline"] <= 0.9):
        bad("seekbar.baseline", "number 0.2..0.9")
    if "glow" in s and not (is_num(s["glow"]) and 0 <= s["glow"] <= 16):
        bad("seekbar.glow", "number 0..16")
    used: set = set()
    if "thumb" in s:
        check_thumb(s["thumb"], files, used)
    if "emitter" in s:
        check_emitter(s["emitter"], files, used)
    for n in files:
        if n.startswith("assets/") and n not in used:
            bad(n, "not referenced by plugin.json (only referenced assets are stored)")
    unpacked = sum(len(b) for b in files.values())
    if unpacked > MIB:
        bad("package", "unpacked size is larger than 1 MiB")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)
    if buf.tell() > MIB:
        bad("package", "zip is larger than 1 MiB")


def check_plugin(plugin_dir: pathlib.Path) -> None:
    slug = plugin_dir.name
    pj = plugin_dir / "plugin.json"
    if not pj.is_file():
        raise SystemExit(f"{slug}: plugin.json not found")
    files = {f.relative_to(plugin_dir).as_posix(): f.read_bytes() for f in sorted(plugin_dir.rglob("*")) if f.is_file()}
    try:
        validate(slug, json.loads(pj.read_text(encoding="utf-8")), files)
    except Problem as e:
        raise SystemExit(f"{slug}: {e}")
    print(f"ok {slug}")


# ---- self-test --------------------------------------------------------------------------------

def _png(w=8, h=8, extra=b"") -> bytes:
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + b"\0\0\0\0"
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + extra + chunk(b"IDAT", b"")


def selftest() -> None:
    def base():
        return {
            "metadata": {"apiVersion": 1, "type": "seekbar", "name": "T", "version": 1, "author": "a", "license": "CC0-1.0"},
            "seekbar": {"track": {"kind": "flat"}},
        }

    def with_thumb(**kw):
        p = base()
        p["seekbar"]["thumb"] = {"image": "assets/t.png", "size": [16, 16], **kw}
        return p

    def emitter(**kw):
        p = base()
        e = {"image": "assets/t.png", "size": [8, 8], "rate": 2, "life": [1, 2], "velocity": {"x": [0, 1], "y": [-5, 0]}}
        e.update(kw)
        p["seekbar"]["emitter"] = e
        return p

    def edit(fn):
        p = base()
        fn(p)
        return p

    img = {"assets/t.png": _png()}
    cases = [  # (name, manifest, files, expected key path in the message)
        ("apiVersion", edit(lambda p: p["metadata"].update(apiVersion=2)), {}, "metadata.apiVersion"),
        ("type", edit(lambda p: p["metadata"].update(type="lyrics")), {}, "metadata.type"),
        ("no license", edit(lambda p: p["metadata"].pop("license")), {}, "metadata.license"),
        ("long license", edit(lambda p: p["metadata"].update(license="x" * 65)), {}, "metadata.license"),
        ("hosts", edit(lambda p: p["metadata"].update(hosts=["a.com"])), {}, "metadata.hosts"),
        ("script", edit(lambda p: p.update(script={"x": "y"})), {}, "script"),
        ("config", edit(lambda p: p.update(config=[{"key": "k"}])), {}, "config"),
        ("src js", base(), {"src/a.js": b"1"}, "src"),
        ("unknown top key", edit(lambda p: p["seekbar"].update(feedback=1)), {}, "seekbar.feedback"),
        ("no track", edit(lambda p: p["seekbar"].pop("track")), {}, "seekbar.track"),
        ("bad kind", edit(lambda p: p["seekbar"].update(track={"kind": "x"})), {}, "seekbar.track.kind"),
        ("amplitude on bars", edit(lambda p: p["seekbar"].update(track={"kind": "bars", "amplitude": "low"})), {}, "seekbar.track.amplitude"),
        ("bad density", edit(lambda p: p["seekbar"].update(track={"kind": "bars", "density": "x"})), {}, "seekbar.track.density"),
        ("height on flat", edit(lambda p: p["seekbar"].update(track={"kind": "flat", "color": "height"})), {}, "seekbar.track.color"),
        ("rest on squig", edit(lambda p: p["seekbar"].update(track={"kind": "squig", "rest": "dim"})), {}, "seekbar.track.rest"),
        ("short hex", edit(lambda p: p["seekbar"].update(colors={"primary": "#fff"})), {}, "seekbar.colors.primary"),
        ("bad role", edit(lambda p: p["seekbar"].update(colors={"secondary": "red"})), {}, "seekbar.colors.secondary"),
        ("baseline", edit(lambda p: p["seekbar"].update(baseline=0.95)), {}, "seekbar.baseline"),
        ("glow", edit(lambda p: p["seekbar"].update(glow=17)), {}, "seekbar.glow"),
        ("thumb missing file", with_thumb(), {}, "seekbar.thumb.image"),
        ("thumb bad name", with_thumb(image="assets/../x.png"), img, "seekbar.thumb.image"),
        ("thumb gif ext", with_thumb(image="assets/t.gif"), img, "seekbar.thumb.image"),
        ("frames 0", with_thumb(frames=0), img, "seekbar.thumb.frames"),
        ("frames 65", with_thumb(frames=65), {"assets/t.png": _png(65, 8)}, "seekbar.thumb.frames"),
        ("width % frames", with_thumb(frames=3), img, "seekbar.thumb.frames"),
        ("fps 31", with_thumb(fps=31), img, "seekbar.thumb.fps"),
        ("size small", with_thumb(size=[3, 16]), img, "seekbar.thumb.size"),
        ("size tall", with_thumb(size=[16, 57]), img, "seekbar.thumb.size"),
        ("anchor", with_thumb(anchor=[1.5, 0]), img, "seekbar.thumb.anchor"),
        ("paused", with_thumb(frames=2, paused=2), {"assets/t.png": _png(8, 8)}, "seekbar.thumb.paused"),
        ("thumb unknown key", with_thumb(rate=1), img, "seekbar.thumb.rate"),
        ("thumb tint", with_thumb(tint="#12345"), img, "seekbar.thumb.tint"),
        ("emitter rate 0", emitter(rate=0), img, "seekbar.emitter.rate"),
        ("emitter rate 21", emitter(rate=21), img, "seekbar.emitter.rate"),
        ("emitter life 0", emitter(life=[0, 1]), img, "seekbar.emitter.life"),
        ("emitter life 4", emitter(life=[1, 4]), img, "seekbar.emitter.life"),
        ("emitter life order", emitter(life=[2, 1]), img, "seekbar.emitter.life"),
        ("velocity cap", emitter(velocity={"x": [0, 201], "y": [0, 1]}), img, "seekbar.emitter.velocity.x"),
        ("velocity order", emitter(velocity={"x": [0, 1], "y": [5, 1]}), img, "seekbar.emitter.velocity.y"),
        ("spin cap", emitter(spin=[0, 721]), img, "seekbar.emitter.spin"),
        ("fade", emitter(fade=1), img, "seekbar.emitter.fade"),
        ("apng", with_thumb(), {"assets/t.png": _png(extra=struct.pack(">I", 8) + b"acTL" + b"\0" * 12)}, "animated PNG"),
        ("not an image", with_thumb(), {"assets/t.png": b"hello"}, "not a PNG or WebP"),
        ("png as webp", with_thumb(image="assets/t.webp"), {"assets/t.webp": _png()}, "does not match"),
        ("webp as png", with_thumb(), {"assets/t.png": b"RIFF\0\0\0\0WEBPVP8L\0\0\0\0\x2f\x07\xc0\x01\0" + b"\0" * 8}, "does not match"),
        ("animated webp", with_thumb(image="assets/t.webp"),
         {"assets/t.webp": b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\x02" + b"\0" * 20}, "animated WebP"),
        ("2049 px", with_thumb(), {"assets/t.png": _png(2049, 8)}, "1..2048"),
        ("image 512 KiB", with_thumb(), {"assets/t.png": _png() + b"\0" * (512 * 1024)}, "512 KiB"),
        ("unreferenced asset", base(), {"assets/x.png": _png()}, "not referenced"),
        ("unpacked 1 MiB", with_thumb(), {"assets/t.png": _png(), "plugin.json": b"\0" * (MIB + 1)}, "1 MiB"),
    ]
    failed = []
    for name, manifest, files, want in cases:
        try:
            validate("t", manifest, dict(files))
            failed.append(f"{name}: accepted")
        except Problem as e:
            if want not in str(e):
                failed.append(f"{name}: refused with {e}, wanted {want!r}")
    try:  # a valid thumb must pass, so the cases above fail for their own reason only
        validate("t", with_thumb(frames=2), {"assets/t.png": _png(8, 8)})
        validate("t", emitter(), dict(img))
    except Problem as e:
        failed.append(f"valid manifest refused: {e}")
    if failed:
        raise SystemExit("selftest failed:\n  " + "\n  ".join(failed))
    print(f"selftest ok: {len(cases)} hostile cases refused")


def main() -> None:
    if "--selftest" in sys.argv:
        selftest()
        return
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
