"""Review chapter start/middle/end frames together; requires test:motion outputs."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
root = Path(__file__).resolve().parents[1] / 'outputs' / 'cinema'
chapters = ['failure', 'gate', 'outcomes', 'verifiers', 'evidence', 'architecture', 'product', 'limitations', 'closing']
for width in (1440, 390):
    size = (432, 270) if width == 1440 else (195, 422)
    sheet = Image.new('RGB', (3*size[0], len(chapters)*(size[1]+24)), '#171717')
    draw = ImageDraw.Draw(sheet)
    for row, chapter in enumerate(chapters):
        for col, frame in enumerate(['start','middle','end']):
            with Image.open(root / f'{chapter}-{width}-{frame}.png') as image:
                thumb = ImageOps.contain(image, size)
                x, y = col*size[0], row*(size[1]+24)
                draw.text((x+5,y+5), f'{chapter} / {frame}', fill='white')
                sheet.paste(thumb,(x,y+24))
    sheet.save(root / f'chapter-contact-{width}.jpg', quality=90)
