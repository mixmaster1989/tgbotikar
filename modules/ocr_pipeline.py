import cv2
from doctr.io import DocumentFile
from doctr.models import ocr_predictor
import logging
import sys

# Настройка winston-like логирования через logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger("ocr_pipeline")

def preprocess_image(input_path, output_path):
    logger.info(f"Чтение изображения: {input_path}")
    img = cv2.imread(input_path)
    if img is None:
        logger.error(f"Не удалось открыть изображение: {input_path}")
        raise RuntimeError(f"Не удалось открыть изображение: {input_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cv2.imwrite(output_path, gray)
    logger.info(f"Изображение сохранено после grayscale: {output_path}")

def run_ocr(image_path):
    logger.info(f"Запуск DocTR OCR для: {image_path}")
    doc = DocumentFile.from_images(image_path)
    model = ocr_predictor('db_resnet50', 'crnn_vgg16_bn', pretrained=True, assume_straight_pages=True)
    result = model(doc)
    text = result.render()
    logger.info("OCR завершён успешно")
    return text

if __name__ == "__main__":
    if len(sys.argv) < 2:
        logger.error("Не указан путь к изображению!")
        sys.exit(1)
    input_img = sys.argv[1]
    preproc_img = "preprocessed.png"
    preprocess_image(input_img, preproc_img)
    ocr_text = run_ocr(preproc_img)
    print("--- RAW OCR TEXT ---")
    print(ocr_text)
