const fs = require("fs-extra");
const Jimp = require("jimp");
const { createWorker } = require("tesseract.js"); // fallback, если easyocr не находит
let easyocr;
try {
  easyocr = require("easyocr");
} catch (e) {
  easyocr = null;
}

// Предобработка изображения (grayscale, увеличение контраста, binarize)
async function preprocessImage(inputPath, outputPath) {
  const image = await Jimp.read(inputPath);
  image
    .grayscale()
    .contrast(0.5)
    .normalize()
    .write(outputPath);
  return outputPath;
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
    await worker.recognize(processedPath, 'rus+eng');
    const { data: { text } } = await worker.getResult();
    await worker.terminate();
    return text;
  }
}

module.exports = { preprocessImage, recognizeText };
