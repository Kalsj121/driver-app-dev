#!/usr/bin/env python3
"""
LCA Transfert v1.35.1 — Générateur d'icônes PWA
Génère 2 sets d'icônes :
- icons/*.png              — driver (fond bleu #4da9be)
- icons/bureau/*.png       — bureau (fond BLANC, pour distinguer visuellement)

Prérequis :
    pip3 install Pillow

Usage :
    python3 generate_pwa_icons.py

Puis :
    git add icons/
    git commit -m "regen icons"
    git push
"""

from PIL import Image
import os
import sys

# --- CONFIG ---
LOGO_URL_OR_PATH = 'logo.png'   # si absent, tentera le téléchargement URL en fallback
FALLBACK_URL     = 'https://lca.hevra.app/assets/img/logo.png'
BG_DRIVER = (77, 169, 190, 255)   # #4da9be (couleur thème LCA)
BG_BUREAU = (255, 255, 255, 255)  # blanc pur pour l'app bureau
OUTPUT_DIR = 'icons'
BUREAU_SUBDIR = 'bureau'

def load_logo():
    """Charge le logo depuis fichier local, sinon URL en fallback."""
    if os.path.exists(LOGO_URL_OR_PATH):
        print(f"📥 Chargement du logo local ({LOGO_URL_OR_PATH})…")
        return Image.open(LOGO_URL_OR_PATH).convert('RGBA')
    print(f"📥 Fichier local absent, tentative téléchargement {FALLBACK_URL}…")
    try:
        import urllib.request
        req = urllib.request.Request(FALLBACK_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            import io
            return Image.open(io.BytesIO(resp.read())).convert('RGBA')
    except Exception as e:
        print(f"❌ Impossible de charger le logo : {e}")
        print(f"   → Télécharge {FALLBACK_URL} manuellement dans le dossier courant sous 'logo.png'")
        sys.exit(1)

def make_icon(logo, size, safe_zone_ratio=0.85, bg=None):
    canvas = Image.new('RGBA', (size, size), bg if bg else (0, 0, 0, 0))
    max_dim = int(size * safe_zone_ratio)
    lw, lh = logo.size
    ratio = min(max_dim / lw, max_dim / lh)
    new_size = (int(lw * ratio), int(lh * ratio))
    logo_scaled = logo.resize(new_size, Image.LANCZOS)
    x = (size - new_size[0]) // 2
    y = (size - new_size[1]) // 2
    canvas.paste(logo_scaled, (x, y), logo_scaled)
    return canvas

def generate_set(logo, base_dir, bg, label):
    """Génère un set complet d'icônes dans base_dir avec la couleur de fond bg."""
    os.makedirs(base_dir, exist_ok=True)
    for size in [192, 512]:
        icon = make_icon(logo, size, safe_zone_ratio=0.85, bg=bg)
        path = f"{base_dir}/icon-{size}.png"
        icon.save(path, optimize=True)
        print(f"✓ {path} ({label}, any)")
    for size in [192, 512]:
        icon = make_icon(logo, size, safe_zone_ratio=0.60, bg=bg)
        path = f"{base_dir}/icon-{size}-maskable.png"
        icon.save(path, optimize=True)
        print(f"✓ {path} ({label}, maskable)")
    apple = make_icon(logo, 180, safe_zone_ratio=0.80, bg=bg)
    apple.save(f"{base_dir}/apple-touch-icon.png", optimize=True)
    print(f"✓ {base_dir}/apple-touch-icon.png ({label}, iOS)")
    fav = make_icon(logo, 32, safe_zone_ratio=0.80, bg=bg)
    fav.save(f"{base_dir}/favicon-32.png", optimize=True)
    print(f"✓ {base_dir}/favicon-32.png ({label}, favicon)")

def main():
    logo = load_logo()
    print(f"   Logo : {logo.size[0]}×{logo.size[1]}, mode={logo.mode}\n")

    print("🚛 Génération icônes DRIVER (fond bleu)…")
    generate_set(logo, OUTPUT_DIR, BG_DRIVER, 'driver')

    print("\n👥 Génération icônes BUREAU (fond blanc)…")
    generate_set(logo, f"{OUTPUT_DIR}/{BUREAU_SUBDIR}", BG_BUREAU, 'bureau')

    print("\n🎉 Terminé. 12 fichiers générés (6 driver + 6 bureau).")
    print(f"   {OUTPUT_DIR}/*.png            → app chauffeur (bleu)")
    print(f"   {OUTPUT_DIR}/{BUREAU_SUBDIR}/*.png     → app bureau (blanc)")
    print("\nÉtapes suivantes :")
    print("  1. git add icons/")
    print("  2. git commit -m 'v1.35.1 : icônes bureau fond blanc'")
    print("  3. git push")
    print("  4. Sur téléphone : supprime les 2 anciennes PWA, réinstalle depuis Safari/Chrome")

if __name__ == '__main__':
    main()
