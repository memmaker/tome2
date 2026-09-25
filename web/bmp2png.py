# 16x16.bmp -> PNG; the X11 frontend treats the top-left pixel of tile row 6 as transparent
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
key = im.getpixel((0, 16 * 6))
im.putdata([(0, 0, 0, 0) if p == key else p for p in im.getdata()])
im.save(sys.argv[2], optimize=True)
