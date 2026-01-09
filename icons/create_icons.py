from PIL import Image, ImageDraw

def create_icon(size, filename):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Background circle
    padding = size // 8
    draw.ellipse([padding, padding, size - padding, size - padding], fill='#0e639c')
    
    # Simple "copy" icon - two overlapping rectangles
    rect_size = size // 3
    offset = size // 6
    
    # Back rectangle
    x1, y1 = size // 3, size // 4
    draw.rectangle([x1, y1, x1 + rect_size, y1 + rect_size], outline='white', width=max(1, size // 16))
    
    # Front rectangle
    x2, y2 = size // 4, size // 3
    draw.rectangle([x2, y2, x2 + rect_size, y2 + rect_size], fill='#0e639c', outline='white', width=max(1, size // 16))
    
    img.save(filename)

create_icon(16, 'icon16.png')
create_icon(48, 'icon48.png')
create_icon(128, 'icon128.png')
print("Icons created!")
