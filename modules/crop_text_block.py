import sys
import cv2
import numpy as np

if len(sys.argv) != 3:
    print("Usage: crop_text_block.py <input_path> <output_path>")
    sys.exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]

img = cv2.imread(input_path)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5,5), 0)
thresh = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 15, 10)

# Находим контуры
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# Выбираем самый большой контур по площади (скорее всего, это блок текста)
max_area = 0
best_rect = None
for cnt in contours:
    x, y, w, h = cv2.boundingRect(cnt)
    area = w * h
    if area > max_area:
        max_area = area
        best_rect = (x, y, w, h)

if best_rect is not None:
    x, y, w, h = best_rect
    cropped = img[y:y+h, x:x+w]
    cv2.imwrite(output_path, cropped)
else:
    # Если не найдено — сохраняем исходник
    cv2.imwrite(output_path, img)
