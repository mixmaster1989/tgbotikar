const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');
const logger = require("./logger");

// Предобработка отключена, просто копируем файл для PaddleOCR
async function preprocessImage(inputPath, outputPath) {
  await fs.copy(inputPath, outputPath);
  logger.info(`[OCR] Предобработка отключена, файл скопирован: ${inputPath} -> ${outputPath}`);
  return outputPath;
}

// OCR через PaddleOCR (Python)
async function recognizeText(imagePath) {
  const processedPath = imagePath.replace(/(\.[^.]+)$/, "_processed$1");
  await preprocessImage(imagePath, processedPath);
  logger.info(`[OCR] Передан в PaddleOCR: ${processedPath}`);
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_paddle.py'), processedPath], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.error(`[OCR] PaddleOCR ошибка: ${stderr || err}`);
        return reject(stderr || err);
      }
      logger.info(`[OCR] PaddleOCR результат: ${stdout.trim().slice(0, 200)}...`);
      resolve(stdout.trim());
    });
  });
}

module.exports = { preprocessImage, recognizeText };
