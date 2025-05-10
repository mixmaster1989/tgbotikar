import sys
import cv2

if len(sys.argv) != 3:
    print("Usage: clahe_preprocess.py <input_path> <output_path>")
    sys.exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]

# Читаем изображение в градациях серого
img = cv2.imread(input_path, cv2.IMREAD_GRAYSCALE)
if img is None:
    print(f"Cannot open image: {input_path}")
    sys.exit(2)

# Применяем CLAHE (Contrast Limited Adaptive Histogram Equalization)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
cl1 = clahe.apply(img)

# Сохраняем результат
cv2.imwrite(output_path, cl1)
