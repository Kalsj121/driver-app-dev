#!/usr/bin/env python3
"""
LCA Transfert v1.33 — Générateur d'icônes PWA
Crée les icônes correctement paddées pour iOS et Android depuis le logo LCA.

Prérequis :
    pip3 install Pillow

Usage :
    python3 generate_pwa_icons.py

Sortie :
    icons/icon-192.png            (Android, purpose 'any')
    icons/icon-512.png            (Android, purpose 'any')
    icons/icon-192-maskable.png   (Android, purpose 'maskable' — safe zone 80%)
    icons/icon-512-maskable.png   (Android, purpose 'maskable' — safe zone 80%)
    icons/apple-touch-icon.png    (iOS 180x180, padding ~10%)

Puis :
    - Copie le dossier `icons/` à la racine de driver-app-dev
    - Le manifest.json et index.html (déjà livrés v1.33) référencent ces fichiers
    - Push → sur iPhone, désinstalle la PWA et réinstalle depuis Safari
"""

from PIL import Image
import os
import sys

# --- CONFIG ---
LOGO_URL_OR_PATH = 'logo.png'
BG_COLOR = (77, 169, 190, 255)   # var(--header) = #4da9be, opaque
OUTPUT_DIR = 'icons'

def load_logo():
    """Charge le logo depuis URL ou fichier local."""
    if os.path.exists(LOGO_URL_OR_PATH):
        return Image.open(LOGO_URL_OR_PATH).convert('RGBA')
    # Tentative téléchargement
    try:
        import urllib.request
        req = urllib.request.Request(LOGO_URL_OR_PATH, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            import io
            return Image.open(io.BytesIO(resp.read())).convert('RGBA')
    except Exception as e:
        print(f"❌ Impossible de charger le logo : {e}")
        print(f"   → Télécharge {LOGO_URL_OR_PATH} manuellement dans le dossier courant")
        print(f"     puis relance ce script avec LOGO_URL_OR_PATH = 'logo.png'")
        sys.exit(1)

def make_icon(logo, size, safe_zone_ratio=0.85, bg=None):
    """
    Crée une icône carrée size×size avec le logo centré dans la safe zone.
    safe_zone_ratio = 0.85 pour purpose='any' (10% marge visible)
    safe_zone_ratio = 0.60 pour purpose='maskable' (safe zone 60% centre pour compenser le crop Android)
    bg = None → fond transparent, sinon tuple RGBA
    """
    canvas = Image.new('RGBA', (size, size), bg if bg else (0, 0, 0, 0))
    # Redimensionner le logo dans la safe zone en gardant les proportions
    max_dim = int(size * safe_zone_ratio)
    lw, lh = logo.size
    ratio = min(max_dim / lw, max_dim / lh)
    new_size = (int(lw * ratio), int(lh * ratio))
    logo_scaled = logo.resize(new_size, Image.LANCZOS)
    # Centrer
    x = (size - new_size[0]) // 2
    y = (size - new_size[1]) // 2
    canvas.paste(logo_scaled, (x, y), logo_scaled)
    return canvas

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"📥 Chargement du logo…")
    logo = load_logo()
    print(f"   Logo : {logo.size[0]}×{logo.size[1]}, mode={logo.mode}")

    # 1) Android — purpose 'any' : fond bleu + logo centré safe zone 85%
    for size in [192, 512]:
        icon = make_icon(logo, size, safe_zone_ratio=0.85, bg=BG_COLOR)
        path = f"{OUTPUT_DIR}/icon-{size}.png"
        icon.save(path, optimize=True)
        print(f"✓ {path} ({size}×{size}, purpose='any')")

    # 2) Android — purpose 'maskable' : fond bleu + logo dans safe zone 60%
    # (Android crop les bords, donc on garantit que le logo est visible)
    for size in [192, 512]:
        icon = make_icon(logo, size, safe_zone_ratio=0.60, bg=BG_COLOR)
        path = f"{OUTPUT_DIR}/icon-{size}-maskable.png"
        icon.save(path, optimize=True)
        print(f"✓ {path} ({size}×{size}, purpose='maskable' safe zone 60%)")

    # 3) iOS — apple-touch-icon 180×180 : fond bleu + logo padding ~10%
    # iOS applique lui-même les coins arrondis, donc icône simple carrée suffit
    apple = make_icon(logo, 180, safe_zone_ratio=0.80, bg=BG_COLOR)
    path = f"{OUTPUT_DIR}/apple-touch-icon.png"
    apple.save(path, optimize=True)
    print(f"✓ {path} (180×180, iOS)")

    # 4) Favicon 32×32 pour navigateurs
    fav = make_icon(logo, 32, safe_zone_ratio=0.80, bg=BG_COLOR)
    path = f"{OUTPUT_DIR}/favicon-32.png"
    fav.save(path, optimize=True)
    print(f"✓ {path} (32×32, favicon)")

    print("\n🎉 Icônes générées avec succès.")
    print(f"   Dossier : ./{OUTPUT_DIR}/")
    print("\nÉtapes suivantes :")
    print(f"  1. Copie le dossier `{OUTPUT_DIR}/` à la racine de driver-app-dev/")
    print(f"  2. Vérifie que manifest.json et index.html référencent bien ces fichiers")
    print(f"  3. Push sur git")
    print(f"  4. Sur iPhone/Android : désinstalle l'ancienne PWA, réinstalle depuis Safari/Chrome")

if __name__ == '__main__':
    main()
