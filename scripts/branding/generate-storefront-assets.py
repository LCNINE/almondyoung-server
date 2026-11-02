"""Resize the original winner artwork for storefront assets (requires Pillow)."""
from pathlib import Path
import base64
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web/almondyoung-storefront'
PUBLIC = WEB / 'public'
IMAGES = PUBLIC / 'images'
wordmark = Image.open(IMAGES / 'almondyoung-logo.png').convert('RGBA')
symbol = Image.open(IMAGES / 'almondyoung-symbol.png').convert('RGBA')

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
encoded = base64.b64encode((IMAGES / 'almondyoung-logo.png').read_bytes()).decode()
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
