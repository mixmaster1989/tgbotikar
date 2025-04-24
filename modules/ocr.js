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
  let image;
  if (typeof Jimp.read === 'function') {
    image = await Jimp.read(inputPath);
  } else {
    image = await new Jimp(inputPath);
  }
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
    // fallback на tesseract.js
    const worker = await createWorker();
    await worker.loadLanguage("rus+eng");
    await worker.initialize("rus+eng");
    const { data: { text } } = await worker.recognize(processedPath);
    await worker.terminate();
    return text;
  }
}

module.exports = { preprocessImage, recognizeText };
