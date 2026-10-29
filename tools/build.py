#!/usr/bin/env python3
"""Zip each plugin in src/ into dist/<slug>/plugin.zip and write plugins.json."""
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, DIST = ROOT / "src", ROOT / "dist"
CATALOG_META = {"name": "Kanaru plugins", "author": "kanaru313"}


def build_one(plugin_dir: pathlib.Path) -> dict:
    manifest = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))
    meta = manifest["metadata"]
    slug = plugin_dir.name
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
        "apiVersion": meta["apiVersion"],
        "type": meta["type"],
        "hosts": meta["hosts"],
        "path": f"dist/{slug}/plugin.zip",
    }
    for key in ("author", "description"):
        if key in meta:
            entry[key] = meta[key]
    if (plugin_dir / "icon.png").exists():
        (out / "icon.png").write_bytes((plugin_dir / "icon.png").read_bytes())
        entry["icon"] = f"dist/{slug}/icon.png"
    return entry


def main() -> None:
    data = [build_one(d) for d in sorted(SRC.iterdir()) if (d / "plugin.json").exists()] if SRC.exists() else []
    catalog = {"metadata": CATALOG_META, "data": data}
    (ROOT / "plugins.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data)} plugin(s) built")


if __name__ == "__main__":
    main()
