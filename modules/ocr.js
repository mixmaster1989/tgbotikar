const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');
const logger = require("./logger");

// Мягкая предобработка через Python-скрипт (OpenCV)
async function preprocessImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_preprocess.py'), inputPath, outputPath], (err) => {
      if (err) {
        logger.error(`[OCR] Ошибка предобработки: ${err}`);
        return reject(err);
      }
      logger.info(`[OCR] Мягкая предобработка: ${inputPath} -> ${outputPath}`);
      resolve(outputPath);
    });
  });
}

// OCR через PaddleOCR (Python) с фильтрацией результата
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
      // Фильтруем строки: только те, где есть >=2 кириллических символа
      const lines = stdout.trim().split(/\r?\n/).filter(line => (line.match(/[А-Яа-яЁё]/g) || []).length >= 2);
      const filtered = lines.join("\n");
      logger.info(`[OCR] PaddleOCR отфильтрованный результат: ${filtered.slice(0,200)}...`);
      resolve(filtered);
    });
  });
}

module.exports = { preprocessImage, recognizeText };
