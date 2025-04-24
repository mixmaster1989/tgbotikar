import sys
import cv2
import numpy as np
from PIL import Image

def gentle_enhance(input_path, output_path):
    img = cv2.imread(input_path)
    if img is None:
        raise RuntimeError(f"Не удалось открыть изображение: {input_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Мягкое автоконтрастирование
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    cv2.imwrite(output_path, enhanced)

if __name__ == "__main__":
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    gentle_enhance(input_path, output_path)
