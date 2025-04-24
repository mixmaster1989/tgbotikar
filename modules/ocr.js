const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');

// Предобработка через Python-скрипт (OpenCV)
async function preprocessImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_preprocess.py'), inputPath, outputPath], (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

// OCR через PaddleOCR (Python)
async function recognizeText(imagePath) {
  const processedPath = imagePath.replace(/(\.[^.]+)$/, "_processed$1");
  await preprocessImage(imagePath, processedPath);
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'ocr_paddle.py'), processedPath], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err);
      resolve(stdout.trim());
    });
  });
}

module.exports = { preprocessImage, recognizeText };
