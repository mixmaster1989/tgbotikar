const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');
let easyocr;
try {
  easyocr = require("easyocr");
} catch (e) {
  easyocr = null;
}

// Предобработка через Python-скрипт (OpenCV)
async function preprocessImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_preprocess.py'), inputPath, outputPath], (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

// OCR только через EasyOCR (или выбросить ошибку)
async function recognizeText(imagePath) {
  const processedPath = imagePath.replace(/(\.[^.]+)$/, "_processed$1");
  await preprocessImage(imagePath, processedPath);
  if (easyocr) {
    const reader = new easyocr.Reader(["ru", "en"]);
    const results = await reader.readtext(processedPath);
    return results.map(r => r[1]).join("\n");
  } else {
    throw new Error('EasyOCR не установлен. Установите easyocr или используйте PaddleOCR.');
  }
}

module.exports = { preprocessImage, recognizeText };
