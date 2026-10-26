# Draws the app icon (same design as public/icon.svg) as PNGs.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
for size in (192, 512):
    s = size / 512
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(112 * s), fill='#0f6b4f')
    w = max(2, int(36 * s))
    def line(x1, y1, x2, y2, c):
        d.line([x1 * s, y1 * s, x2 * s, y2 * s], fill=c, width=w)
        r = w / 2
        for x, y in ((x1, y1), (x2, y2)):
            d.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=c)
    line(136, 176, 232, 176, '#f2b705'); line(184, 128, 184, 224, '#f2b705')
    line(296, 176, 392, 176, '#ffffff')
    line(144, 304, 224, 384, '#ffffff'); line(224, 304, 144, 384, '#ffffff')
    line(296, 320, 392, 320, '#f2b705'); line(296, 376, 392, 376, '#f2b705')
    img.save(f'{out}/icon-{size}.png')
