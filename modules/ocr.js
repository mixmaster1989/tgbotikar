const fs = require("fs-extra");
const { execFile } = require('child_process');
const path = require('path');
const logger = require("./logger");
const russianDictionary = require("./russian_dict");

// --- Левенштейн-дистанция ---
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) === a.charAt(j-1)) matrix[i][j] = matrix[i-1][j-1];
      else matrix[i][j] = Math.min(
        matrix[i-1][j-1] + 1,
        matrix[i][j-1] + 1,
        matrix[i-1][j] + 1
      );
    }
  }
  return matrix[b.length][a.length];
}

// --- Замена латиницы на кириллицу ---
const latinToCyrillic = {
  'A': 'А', 'B': 'В', 'E': 'Е', 'K': 'К', 'M': 'М', 'H': 'Н', 'O': 'О', 'P': 'Р', 'C': 'С', 'T': 'Т', 'X': 'Х',
  'a': 'а', 'b': 'в', 'e': 'е', 'k': 'к', 'm': 'м', 'h': 'н', 'o': 'о', 'p': 'р', 'c': 'с', 't': 'т', 'x': 'х'
};
function fixLatinCyrillic(str) {
  return str.replace(/[A-Za-z]/g, ch => latinToCyrillic[ch] || ch);
}

// --- Коррекция слова с учётом регистра ---
function correctWord(word, needUpper) {
  word = fixLatinCyrillic(word); // сначала заменяем латиницу
  const lower = word.toLowerCase();
  if (russianDictionary.includes(lower)) {
    return needUpper ? (lower.charAt(0).toUpperCase() + lower.slice(1)) : lower;
  }
  for (const dictWord of russianDictionary) {
    if (levenshtein(lower, dictWord) === 1) {
      return needUpper ? (dictWord.charAt(0).toUpperCase() + dictWord.slice(1)) : dictWord;
    }
  }
  return needUpper ? (word.charAt(0).toUpperCase() + word.slice(1)) : word;
}

// --- Склейка строк, коррекция и авто-капитализация ---
function smartJoinAndCorrect(text) {
  let lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let result = [];
  for (let i = 0; i < lines.length; ++i) {
    if (i > 0 && result[result.length-1] && !/[.!?…]$/.test(result[result.length-1])) {
      result[result.length-1] += ' ' + lines[i];
    } else {
      result.push(lines[i]);
    }
  }
  // Коррекция и авто-капитализация
  result = result.map((line, idx) => {
    const words = line.split(/\s+/);
    return words.map((w, i) => correctWord(w, i === 0)).join(' ');
  });
  // Первая строка с большой буквы
  if (result.length && result[0].length) {
    result[0] = result[0][0].toUpperCase() + result[0].slice(1);
  }
  return result.join('\n');
}

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

// OCR через PaddleOCR (Python) с фильтрацией и автокоррекцией
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
      const postprocessed = smartJoinAndCorrect(filtered);
      logger.info(`[OCR] PaddleOCR постобработка: ${postprocessed.slice(0,200)}...`);
      resolve(postprocessed);
    });
  });
}

module.exports = { preprocessImage, recognizeText, smartJoinAndCorrect };
