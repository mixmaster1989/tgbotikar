import sys
import cv2

def gentle_enhance(input_path, output_path):
    image = cv2.imread(input_path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Просто лёгкое размытие и глобальный threshold
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, threshed = cv2.threshold(blur, 180, 255, cv2.THRESH_BINARY)
    cv2.imwrite(output_path, threshed)

if __name__ == '__main__':
    input_path, output_path = sys.argv[1], sys.argv[2]
    gentle_enhance(input_path, output_path)
