"""Prepare storefront logo variants and icons (requires Pillow)."""
from pathlib import Path
import base64
import shutil
from collections import Counter
from PIL import Image


def remove_white_background(image):
    pixels = list(image.getdata())

    if any(pixel[3] == 0 for pixel in pixels):
        return image.copy()

    palette = [
        color for color, _ in Counter(
            (r, g, b) for r, g, b, a in pixels
            if a == 255 and min(r, g, b) < 200
        ).most_common(5)
    ]
    result = []

    width, height = image.size

    for index, (r, g, b, opacity) in enumerate(pixels):
        color = (r, g, b)

        if color == (255, 255, 255):
            result.append((0, 0, 0, 0))
            continue

        if opacity < 255 or color in palette or max(color) <= 32:
            result.append((r, g, b, opacity))
            continue

        # Recover edge coverage from the original flat colors and white matte.
        # Interior colors stay opaque; only matching antialias pixels change.
        candidates = []

        for foreground in palette:
            delta = [255 - value for value in foreground]
            coverage = sum((255 - value) * step for value, step in zip(color, delta)) / sum(
                step * step for step in delta
            )
            coverage = max(0, min(1, coverage))
            error = sum(
                (value - (255 - coverage * step)) ** 2
                for value, step in zip(color, delta)
            )
            candidates.append((error, coverage, foreground))

        error, coverage, foreground = min(candidates)

        if error <= 3 and coverage < 0.995:
            result.append((*foreground, round(opacity * coverage)))
        else:
            x, y = index % width, index // width
            touches_background = any(
                pixels[near_y * width + near_x][:3] == (255, 255, 255)
                for near_y in range(max(0, y - 2), min(height, y + 3))
                for near_x in range(max(0, x - 2), min(width, x + 3))
            )

            # Mixed colors at corners also contain white matte. Recover their
            # RGB from the measured coverage rather than snapping to a palette.
            if touches_background and coverage < 0.995:
                alpha = max(1, round(255 * coverage), max(255 - value for value in color))
                unmatted = tuple(
                    max(0, min(255, round((value - 255 + alpha) * 255 / alpha)))
                    for value in color
                )
                result.append((*unmatted, alpha))
            else:
                result.append((r, g, b, opacity))

    transparent = image.copy()
    transparent.putdata(result)

    return transparent


def reverse_wordmark(image, monochrome=False):
    reversed_image = image.copy()
    reversed_image.putdata([
        (255, 255, 255, a) if monochrome or max(r, g, b) - min(r, g, b) <= 8 else (r, g, b, a)
        for r, g, b, a in image.getdata()
    ])

    return reversed_image


ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web/almondyoung-storefront'
PUBLIC = WEB / 'public'
IMAGES = PUBLIC / 'images'
wordmark = remove_white_background(Image.open(IMAGES / 'almondyoung-logo.png').convert('RGBA'))
symbol = Image.open(IMAGES / 'almondyoung-symbol.png').convert('RGBA')

wordmark.save(IMAGES / 'almondyoung-logo.png')
wordmark.save(IMAGES / 'almondyoung-logo-on-light.png')
reverse_wordmark(wordmark).save(IMAGES / 'almondyoung-logo-on-dark.png')
reverse_wordmark(wordmark, monochrome=True).save(IMAGES / 'almondyoung-logo-white.png')

# Preserve legacy URLs also used by external brand settings and saved links.
for name in ['almond-logo.png', 'almond-logo-black.png']:
    shutil.copyfile(IMAGES / 'almondyoung-logo.png', IMAGES / name)
symbol.save(IMAGES / 'logo.webp', lossless=True)
symbol.save(IMAGES / 'logo-mark-white.png')
symbol_encoded = base64.b64encode((IMAGES / 'almondyoung-symbol.png').read_bytes()).decode()
(PUBLIC / 'icons/membership-logo.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
    f'<image width="512" height="512" href="data:image/png;base64,{symbol_encoded}"/></svg>\n'
)
encoded = base64.b64encode((IMAGES / 'almondyoung-logo-white.png').read_bytes()).decode()
(IMAGES / 'almond_white_logo.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="107" viewBox="0 0 512 107">'
    f'<image width="512" height="107" href="data:image/png;base64,{encoded}"/></svg>\n'
)

for size in [192, 512]:
    symbol.resize((size, size), Image.Resampling.LANCZOS).save(
        PUBLIC / f'android-chrome-{size}x{size}.png'
    )
symbol.save(WEB / 'src/app/icon.png')
symbol.resize((180, 180), Image.Resampling.LANCZOS).save(WEB / 'src/app/apple-icon.png')
symbol.save(WEB / 'src/app/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

# Keep the exact artwork and colors in a full-size social sharing card.
card = Image.new('RGB', (1200, 630), 'white')
logo = wordmark.resize((960, 201), Image.Resampling.LANCZOS)
card.paste(logo, (120, 214), logo)
card.save(PUBLIC / 'og-image.jpg', quality=95)
