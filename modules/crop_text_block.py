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

contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# Фильтруем маленькие контуры
min_area = 0.05 * img.shape[0] * img.shape[1]  # 5% от площади
candidates = []
for cnt in contours:
    x, y, w, h = cv2.boundingRect(cnt)
    area = w * h
    if area > min_area:
        candidates.append((x, y, w, h))

if candidates:
    # Объединяем все кандидаты в один прямоугольник
    xs = [x for x,_,w,_ in candidates] + [x+w for x,_,w,_ in candidates]
    ys = [y for _,y,_,h in candidates] + [y+h for _,y,_,h in candidates]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    cropped = img[y1:y2, x1:x2]
    cv2.imwrite(output_path, cropped)
else:
    cv2.imwrite(output_path, img)