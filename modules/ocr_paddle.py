import sys
from paddleocr import PaddleOCR
from PIL import Image

def recognize_paddle(image_path):
    ocr = PaddleOCR(lang='ru', use_angle_cls=True, show_log=False)
    result = ocr.ocr(image_path)
    lines = []
    if result is not None:
        for block in result:
            if block:
                for line in block:
                    lines.append(line[1][0])
    else:
        print(f"PaddleOCR не вернул результат для файла: {image_path}", file=sys.stderr)
        return ""
    return '\n'.join(lines)

if __name__ == '__main__':
    image_path = sys.argv[1]
    text = recognize_paddle(image_path)
    print(text)
