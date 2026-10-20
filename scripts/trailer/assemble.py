"""Montage de la bande-annonce à partir des images capturées par capture.cjs.

Usage : python3 assemble.py <dossier-images> <sortie.mp4>
Chaque image finale est composée ici (noms de villes du globe, légendes, titres, fondus),
puis encodée en une passe par ffmpeg (H.264 + AAC) avec la musique de music.py.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 30
FONT_DIR = '/usr/share/fonts/opentype/inter'
HERE = os.path.dirname(os.path.abspath(__file__))


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONT_DIR, f'Inter-{weight}.otf'), size)


F_LABEL = font('Medium', 12)
F_LABEL_CAP = font('SemiBold', 12)
F_CAPTION = font('Bold', 34)
F_SUB = font('Medium', 20)
F_TITLE = font('Black', 92)
F_TAG = font('Medium', 28)

# (type, source, durée, légende, sous-légende)
TIMELINE = [
    ('title', 'g1-intro', None, 'CREATE YOUR CITY', 'Un monde persistant. De vraies frontières.'),
    ('clip', 'g2-europe', None, 'La vraie carte du monde', 'Chaque ville réelle peut appartenir à un joueur'),
    ('clip', 'g3-war', None, 'Alliances, fronts et sièges', 'La géopolitique est jouée par les humains, sans IA'),
    ('clip', 'c1-paris', None, 'Bâtissez votre ville en 3D', 'Placement libre, grille facultative'),
    ('clip', 'c2-avenue', None, 'Routes, avenues, ronds-points', 'Tracés courbes, trottoirs et éclairage'),
    ('clip', 'c3-transit', None, 'Transports en commun', 'Bus, tram, métro, train : la part modale se calcule'),
    ('clip', 'c4-night', None, 'Le temps passe, même hors ligne', 'Simulation en temps réel à vitesse fixe'),
    ('clip', 'c5-traffic', None, 'Trafic simulé', 'Chaque trajet emprunte le plus court chemin'),
    ('clip', 'c6-coverage', None, 'Couverture des services', 'Santé, sécurité, éducation, loisirs'),
    ('clip', 'c7-build', None, 'Partez de zéro', 'Revendiquez une ville vide et faites-la grandir'),
    ('still', 'ui/1-build.png', 3.0, 'Des dizaines de bâtiments', 'Logement, emploi, services, énergie, transports'),
    ('still', 'ui/2-advisors.png', 3.0, 'Des conseillers clairs', 'Des règles fixes, lisibles, sans IA'),
    ('still', 'ui/3-stats.png', 3.0, 'Statistiques et historique', 'Population, finances, bonheur au fil du temps'),
    ('still', 'ui/6-nation.png', 3.2, 'Pas de chef sans élection', 'Les propriétaires de villes votent : lois, impôts, projets'),
    ('still', 'ui/4-diplomacy.png', 3.0, 'Diplomatie et organisations', 'Pactes, alliances militaires, unions commerciales'),
    ('still', 'ui/5-army.png', 3.0, 'Armées de terre, de mer et de l’air', 'Logistique, batailles, retraites'),
    ('still', 'ui/7-trade.png', 3.0, 'Commerce entre villes', 'Contrats, routes, droits de douane'),
    ('outro', 'g9-outro', None, 'CREATE YOUR CITY', 'Bâtissez une ville. Façonnez une nation.'),
]

FADE = 8  # images de fondu au noir entre deux plans


def shadow_text(base: Image.Image, xy, text, fnt, fill=(255, 255, 255, 255), blur=3, anchor='la', alpha=1.0):
    """Texte avec ombre portée douce, opacité globale `alpha`."""
    if alpha <= 0:
        return
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((xy[0] + 1, xy[1] + 2), text, font=fnt, fill=(0, 0, 0, 200), anchor=anchor)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    d = ImageDraw.Draw(layer)
    d.text(xy, text, font=fnt, fill=fill, anchor=anchor)
    if alpha < 1:
        layer.putalpha(layer.getchannel('A').point(lambda v: int(v * alpha)))
    base.alpha_composite(layer)


LABEL_COLORS = {
    'sel': (255, 255, 255, 255), 'mine': (251, 191, 36, 255), 'ally': (52, 211, 153, 255),
    'enemy': (248, 113, 113, 255), 'other': (167, 139, 250, 255),
}


def draw_labels(img: Image.Image, labels):
    """Reproduit les étiquettes HTML du globe (coin haut-gauche à la position exportée)."""
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    items = []
    for lab in labels:
        cls = lab.get('c', '')
        fnt = F_LABEL_CAP if cls else F_LABEL
        color = LABEL_COLORS.get(cls, (219, 229, 241, 255))
        items.append((lab['x'], lab['y'] + 1, lab['t'], fnt, color))
        d.text((lab['x'], lab['y'] + 2), lab['t'], font=fnt, fill=(0, 0, 0, 255))
    layer = layer.filter(ImageFilter.GaussianBlur(2.2))
    d = ImageDraw.Draw(layer)
    for x, y, text, fnt, color in items:
        d.text((x, y), text, font=fnt, fill=color)
    img.alpha_composite(layer)


def ramp(i, n, start, length):
    """0→1 entre start et start+length, puis 1→0 sur les `length` dernières images."""
    a = min(1.0, max(0.0, (i - start) / length))
    b = min(1.0, max(0.0, (n - FADE - i) / length))
    return min(a, b)


def caption(img: Image.Image, i, n, title, sub, right=False):
    """Légende en bas ; à droite sur les plans d'interface pour laisser le panneau lisible."""
    a = ramp(i, n, 6, 10)
    if a <= 0:
        return
    slide = int((1 - a) * 30) * (-1 if right else 1)
    # Bandeau dégradé sombre en bas pour la lisibilité.
    grad = Image.new('L', (1, 220))
    for y in range(220):
        grad.putpixel((0, y), int(170 * (y / 219) ** 1.6 * a))
    shade = Image.new('RGBA', (W, 220), (6, 10, 18, 255))
    shade.putalpha(grad.resize((W, 220)))
    img.alpha_composite(shade, (0, H - 220))
    accent = Image.new('RGBA', (6, 76), (255, 196, 70, int(255 * a)))
    if right:
        img.alpha_composite(accent, (W - 62 + slide, H - 132))
        shadow_text(img, (W - 78 + slide, H - 134), title, F_CAPTION, anchor='ra', alpha=a)
        shadow_text(img, (W - 80 + slide, H - 88), sub, F_SUB, fill=(214, 224, 238, 255), anchor='ra', alpha=a)
    else:
        img.alpha_composite(accent, (56 - slide, H - 132))
        shadow_text(img, (78 - slide, H - 134), title, F_CAPTION, alpha=a)
        shadow_text(img, (80 - slide, H - 88), sub, F_SUB, fill=(214, 224, 238, 255), alpha=a)


def title_card(img: Image.Image, i, n, title, sub, start=12):
    a = ramp(i, n, start, 18)
    if a <= 0:
        return
    veil = Image.new('RGBA', (W, H), (4, 8, 16, int(110 * a)))
    img.alpha_composite(veil)
    scale_y = int((1 - a) * 18)
    shadow_text(img, (W // 2, H // 2 - 20 + scale_y), title, F_TITLE, anchor='ms', blur=6, alpha=a)
    line = Image.new('RGBA', (int(260 * a), 4), (255, 196, 70, int(255 * a)))
    img.alpha_composite(line, ((W - line.width) // 2, H // 2 + 6))
    shadow_text(img, (W // 2, H // 2 + 62), sub, F_TAG, fill=(220, 230, 244, 255), anchor='ms', alpha=a)


def fade(img: Image.Image, i, n):
    k = min(1.0, (i + 1) / FADE, (n - i) / FADE)
    if k >= 1:
        return img
    return Image.blend(Image.new('RGBA', img.size, (0, 0, 0, 255)), img, k)


def fix_status(img: Image.Image) -> Image.Image:
    """L'horloge figée de la capture fait afficher « Hors ligne » ou « Connexion… » : on rétablit « Connecté »."""
    for x in range(960, 1195):
        r, g, b, _ = img.getpixel((x, 68))
        if max(r, g, b) - min(r, g, b) > 90:
            break
    else:
        return img
    if g > r:  # pastille déjà verte
        return img
    d = ImageDraw.Draw(img)
    d.rectangle((x - 4, 59, 1201, 78), fill=img.getpixel((x - 10, 68)))
    d.ellipse((x, 64, x + 8, 72), fill=(52, 211, 153, 255))
    d.text((x + 13, 68), 'Connecté', font=font('Medium', 12), fill=(226, 232, 240, 255), anchor='lm')
    return img


def ken_burns(src: Image.Image, i, n):
    """Lent zoom avant (1.0 → 1.08) centré légèrement à droite, sur les panneaux."""
    t = i / max(1, n - 1)
    z = 1.0 + 0.08 * t
    cw, ch = W / z, H / z
    x0 = (W - cw) * 0.62
    y0 = (H - ch) * 0.45
    return src.crop((x0, y0, x0 + cw, y0 + ch)).resize((W, H), Image.LANCZOS)


def main(frames_dir: str, out: str):
    work = tempfile.mkdtemp(prefix='trailer-')
    seq = os.path.join(work, 'seq')
    os.makedirs(seq)
    k = 0
    for kind, src, dur, title, sub in TIMELINE:
        if not os.path.exists(os.path.join(frames_dir, src)):
            print(f'{src}: absent, ignoré', flush=True)
            continue
        if kind == 'still':
            base = fix_status(Image.open(os.path.join(frames_dir, src)).convert('RGBA').resize((W, H)))
            n = int(dur * FPS)
            frames = [None] * n
            labels = None
        else:
            d = os.path.join(frames_dir, src)
            frames = sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
            n = len(frames)
            lp = os.path.join(d, 'labels.json')
            labels = json.load(open(lp)) if os.path.exists(lp) else None
        for i in range(n):
            if kind == 'still':
                img = ken_burns(base, i, n)
            else:
                img = Image.open(os.path.join(frames_dir, src, frames[i])).convert('RGBA')
                if labels:
                    draw_labels(img, labels[i])
            if kind == 'title':
                title_card(img, i, n, title, sub)
            elif kind == 'outro':
                title_card(img, i, n, title, sub, start=40)
            else:
                caption(img, i, n, title, sub, right=kind == 'still')
            img = fade(img, i, n)
            img.convert('RGB').save(os.path.join(seq, f'{k:05d}.jpg'), quality=94)
            k += 1
        print(f'{src}: {n} images', flush=True)
    seconds = k / FPS
    wav = os.path.join(work, 'music.wav')
    subprocess.run([sys.executable, os.path.join(HERE, 'music.py'), f'{seconds:.3f}', wav], check=True)
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(seq, '%05d.jpg'), '-i', wav,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', out,
    ], check=True)
    print(f'{out}: {seconds:.1f} s', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
