#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère precache-manifest.js à partir du registre apps.js et du contenu
des dossiers apps/<slug>/.

- Embarque le shell + tous les fichiers des apps déclarées offline:true.
- Exclut volontairement les apps offline:false (ex. meteo-hydro).
- Ajoute les CDN critiques listés dans CDN (non détectables par scan de dossier).
- Horodate PRECACHE_VERSION pour forcer la bascule de cache au déploiement.

Usage :  python build_sw_assets.py
Aucune dépendance externe (stdlib uniquement).
"""

import re
import sys
import json
import pathlib
import datetime

ROOT    = pathlib.Path(__file__).parent
APPS_JS = ROOT / "apps.js"
OUT     = ROOT / "precache-manifest.js"

# Fichiers du shell toujours pré-cachés
SHELL = [
    "./", "./index.html", "./apps.js", "./manifest.json",
    "./shared/tokens.css", "./icon.svg", "./icon-192.png", "./icon-512.png",
]

# Dépendances CDN indispensables en mode hors-ligne.
# (Le scan de dossier ne peut pas les deviner : à maintenir ici.)
CDN = [
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",  # SheetJS — export Excel CARHYCE
]

# Extensions embarquées lors du scan des dossiers d'apps
EXT = {
    ".html", ".css", ".js", ".json", ".webmanifest",
    ".svg", ".png", ".jpg", ".jpeg", ".ico", ".webp",
    ".pdf", ".csv", ".woff", ".woff2",
}


def parse_apps(js_text):
    """Extrait (slug, offline) de chaque bloc {...} du registre apps.js."""
    apps = []
    for block in re.findall(r"\{[^{}]*\}", js_text, re.S):
        m_slug = re.search(r"slug\s*:\s*['\"]([^'\"]+)['\"]", block)
        m_off  = re.search(r"offline\s*:\s*(true|false)", block)
        if m_slug:
            apps.append((m_slug.group(1), bool(m_off and m_off.group(1) == "true")))
    return apps


def main():
    if not APPS_JS.exists():
        sys.exit("Erreur : apps.js introuvable à côté du script.")

    apps = parse_apps(APPS_JS.read_text(encoding="utf-8"))
    if not apps:
        sys.exit("Erreur : aucun app détecté dans apps.js.")

    offline = [slug for slug, off in apps if off]
    online  = [slug for slug, off in apps if not off]

    assets = list(SHELL)

    for slug in offline:
        app_dir = ROOT / "apps" / slug
        if not app_dir.is_dir():
            print(f"  \u26a0  dossier manquant : apps/{slug}  (ignoré — déplace l'app puis relance)")
            continue
        for f in sorted(app_dir.rglob("*")):
            if f.is_file() and f.suffix.lower() in EXT:
                rel = f.relative_to(ROOT).as_posix()
                assets.append("./" + rel)

    assets += CDN

    # Dédoublonnage en conservant l'ordre
    seen, uniq = set(), []
    for a in assets:
        if a not in seen:
            seen.add(a)
            uniq.append(a)

    version = "turbo-" + datetime.datetime.now().strftime("%Y%m%d-%H%M")

    body = (
        "// ============================================================\n"
        "// FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.\n"
        "// Régénérer avec :  python build_sw_assets.py\n"
        "// ============================================================\n"
        f"self.PRECACHE_VERSION = {json.dumps(version)};\n"
        f"self.PRECACHE = {json.dumps(uniq, ensure_ascii=False, indent=2)};\n"
    )
    OUT.write_text(body, encoding="utf-8")

    print(f"\u2713 {OUT.name} généré — {len(uniq)} ressources — version {version}")
    print(f"  Apps hors-ligne (précachées) : {', '.join(offline) or '(aucune)'}")
    print(f"  Apps en ligne (exclues)      : {', '.join(online) or '(aucune)'}")


if __name__ == "__main__":
    main()
