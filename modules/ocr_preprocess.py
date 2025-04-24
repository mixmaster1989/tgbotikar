import sys
import cv2
import numpy as np
from PIL import Image

def gentle_enhance(input_path, output_path):
    img = cv2.imread(input_path)
    if img is None:
        raise RuntimeError(f"Не удалось открыть изображение: {input_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mean = np.mean(gray)
    std = np.std(gray)
    # CLAHE только если тёмное или низкоконтрастное
    if mean < 120 or std < 40:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)
    else:
        enhanced = gray
    # Adaptive threshold только если очень низкий контраст
    if std < 30:
        threshed = cv2.adaptiveThreshold(
            enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 11, 2)
    else:
        threshed = enhanced
    # Deskew (выравнивание наклона)
    coords = np.column_stack(np.where(threshed > 0))
    if len(coords) > 0:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        (h, w) = threshed.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        deskewed = cv2.warpAffine(threshed, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    else:
        deskewed = threshed
    cv2.imwrite(output_path, deskewed)

if __name__ == "__main__":
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    gentle_enhance(input_path, output_path)
