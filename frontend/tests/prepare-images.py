"""Download licensed source photographs and produce the local editorial image set.

Source pages and licensing are documented in public/images/faultline/ASSET_PROVENANCE.md.
Originals stay in ignored outputs; only dimensioned, optimized derivatives are published.
"""
from pathlib import Path
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps, ImageEnhance, ImageDraw

root = Path(__file__).resolve().parents[1]
sources = root / 'outputs' / 'image-sources'
destination = root / 'public' / 'images' / 'faultline'
sources.mkdir(parents=True, exist_ok=True)
destination.mkdir(parents=True, exist_ok=True)
photos = [
    ('monument', '15845380', 'jpeg'),
    ('boundary', '2792602', 'jpeg'),
    ('fracture', '12956025', 'jpeg'),
    ('passage', '16083060', 'jpeg'),
    ('alloy', '7568430', 'jpeg'),
    ('receipts', '9850121', 'jpeg'),
    ('inspection', '17500068', 'jpeg'),
    ('precision', '17937673', 'jpeg'),
    ('aperture', '8761851', 'jpeg'),
    ('infrastructure', '9968352', 'jpeg'),
    ('closing', '34994362', 'png'),
    ('aggregate', '9990211', 'jpeg'),
]

def prepare(photo):
    name, identity, extension = photo
    original = sources / f'{name}.{extension}'
    if not original.exists():
        request = Request(f'https://images.pexels.com/photos/{identity}/pexels-photo-{identity}.{extension}', headers={'User-Agent': 'Faultline editorial asset preparation'})
        with urlopen(request, timeout=90) as response:
            original.write_bytes(response.read())
    with Image.open(original) as image:
        image = ImageOps.exif_transpose(image)
        image = ImageOps.grayscale(image)
        image = ImageOps.autocontrast(image, cutoff=0.5)
        image = ImageEnhance.Contrast(image).enhance(1.08)
        image = image.convert('RGB')
        # Preserve full photographic composition; responsive object-position is art-directed in CSS.
        for width in (640, 960, 1280, 1920):
            resized = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
            resized.save(destination / f'{name}-{width}.webp', 'WEBP', quality=68 if width < 1920 else 72, method=6)
        preview = ImageOps.fit(image, (380, 260))
        return name, preview, image.size

results = list(ThreadPoolExecutor(max_workers=4).map(prepare, photos))
sheet = Image.new('RGB', (4*400, 3*300), '#161616')
draw = ImageDraw.Draw(sheet)
for index, (name, preview, size) in enumerate(results):
    x, y = (index % 4)*400, (index//4)*300
    sheet.paste(preview, (x+10, y+10))
    draw.text((x+10, y+275), f'{name} / {size[0]} x {size[1]}', fill='white')
    print(name, size)
sheet.save(root / 'outputs' / 'image-contact-sheet.jpg', quality=90)
