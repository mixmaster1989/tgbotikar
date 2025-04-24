import sys
import easyocr
import cv2

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python easyocr_pipeline.py <image_path>")
        sys.exit(1)
    image_path = sys.argv[1]
    # EasyOCR требует BGR, поэтому просто читаем через cv2
    img = cv2.imread(image_path)
    if img is None:
        print("Ошибка: не удалось открыть изображение", file=sys.stderr)
        sys.exit(2)
    reader = easyocr.Reader(['ru', 'en'], gpu=False)
    result = reader.readtext(img, detail=0, paragraph=True)
    print("--- RAW OCR TEXT ---")
    print("\n".join(result))
