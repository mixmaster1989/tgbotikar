const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');
const Jimp = require("jimp");
const { createWorker } = require("tesseract.js"); // fallback, если easyocr не находит
let easyocr;
try {
  easyocr = require("easyocr");
} catch (e) {
  easyocr = null;
}

// Новая предобработка: через Python-скрипт с OpenCV
async function preprocessImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_preprocess.py'), inputPath, outputPath], (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

// OCR с помощью EasyOCR (или tesseract.js как fallback)
async function recognizeText(imagePath) {
  const processedPath = imagePath.replace(/(\.[^.]+)$/, "_processed$1");
  await preprocessImage(imagePath, processedPath);
  if (easyocr) {
    const reader = new easyocr.Reader(["ru", "en"]);
    const results = await reader.readtext(processedPath);
    return results.map(r => r[1]).join("\n");
  } else {
    // fallback на tesseract.js (v6+ API)
    const worker = await createWorker();
    const { data: { text } } = await worker.recognize(
      processedPath,
      'rus+eng',
      { tessdataDir: require('path').join(__dirname, '../node_modules/tesseract.js-core/tessdata') }
    );
    await worker.terminate();
    return text;
  }
}

module.exports = { preprocessImage, recognizeText };
