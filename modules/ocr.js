const fs = require("fs-extra");
const { execFile, spawn } = require('child_process');
const path = require('path');
const logger = require("./logger");
const russianDictionary = require("./russian_dict");
const sharp = require('sharp');

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

// --- Предобработка ---
async function preprocessWeak(inputPath, outputPath) {
  // Почти без изменений: только grayscale
  await sharp(inputPath).grayscale().toFile(outputPath);
}
async function preprocessMedium(inputPath, outputPath) {
  // Grayscale + автоконтраст
  await sharp(inputPath).grayscale().modulate({ brightness: 1.1 }).toFile(outputPath);
}
async function preprocessStrong(inputPath, outputPath) {
  // Grayscale + autocontrast + лёгкая binarization
  const img = sharp(inputPath).grayscale().modulate({ brightness: 1.15 });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const threshold = 180;
  const binarized = Buffer.from(data.map(v => (v > threshold ? 255 : 0)));
  await sharp(binarized, { raw: { width: info.width, height: info.height, channels: 1 } }).toFile(outputPath);
}

async function preprocessStrongV3(inputPath, outputPath) {
  // Более мягкая версия strong: меньшее усиление контраста, меньше размытия
  // Пример на sharp (или используйте аналогичный подход с вашим инструментом)
  return sharp(inputPath)
    .greyscale()
    .normalize() // выравнивание гистограммы
    .modulate({ brightness: 1.05, contrast: 1.25 }) // чуть усилить яркость и контраст, но не сильно
    .sharpen(1, 0.5, 0.5) // мягкое повышение резкости
    .toFile(outputPath);
}

async function preprocessStrongContrast(inputPath, outputPath) {
  return sharp(inputPath)
    .greyscale()
    .normalize()
    .modulate({ brightness: 1, contrast: 2 }) // сильный контраст
    .toFile(outputPath);
}

async function preprocessStrongDenoise(inputPath, outputPath) {
  return sharp(inputPath)
    .greyscale()
    .normalize()
    .median(3) // слабое шумоподавление
    .modulate({ brightness: 1.05, contrast: 1.25 })
    .toFile(outputPath);
}

async function preprocessStrongV4(inputPath, outputPath) {
  // Промежуточная сила: чуть сильнее, чем v3, но мягче чем v2
  return sharp(inputPath)
    .greyscale()
    .normalize()
    .modulate({ brightness: 1.1, contrast: 1.5 })
    .sharpen(1.5, 0.7, 0.7)
    .toFile(outputPath);
}

async function preprocessStrongClahe(inputPath, outputPath) {
  // CLAHE через python-скрипт (если sharp не поддерживает CLAHE)
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'clahe_preprocess.py'), inputPath, outputPath], (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

async function preprocessCropTextBlock(inputPath, outputPath) {
  // Обрезка области с текстом через crop_text_block.py
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'crop_text_block.py'), inputPath, outputPath], (err) => {
      if (err) return reject(err);
      resolve(outputPath);
    });
  });
}

const preMap = {
  weak: preprocessWeak,
  medium: preprocessMedium,
  strong: preprocessStrong,
  strongV3: preprocessStrongV3,
  strongContrast: preprocessStrongContrast,
  strongDenoise: preprocessStrongDenoise,
  strongV4: preprocessStrongV4,
  strongClahe: preprocessStrongClahe,
  cropTextBlock: preprocessCropTextBlock
};

const postMap = {
  weak: postprocessWeak,
  medium: postprocessMedium,
  strong: postprocessStrong
};

// --- Постобработка ---
const axios = require('axios');

async function postprocessLanguageTool(text) {
  try {
    logger.info(`[LanguageTool] Запрос: ${text.slice(0, 200)}... (длина: ${text.length})`);
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('language', 'ru-RU');
    const response = await axios.post('http://localhost:8081/v2/check', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    logger.info(`[LanguageTool] Ответ: ${JSON.stringify(response.data).slice(0, 500)}...`);
    if (response.data && response.data.matches && response.data.matches.length > 0) {
      let result = text;
      // Применяем исправления в обратном порядке (чтобы не сбить индексы)
      const corrections = response.data.matches.map(m => ({ offset: m.offset, length: m.length, replacement: m.replacements[0]?.value || '' }));
      corrections.sort((a, b) => b.offset - a.offset);
      for (const c of corrections) {
        result = result.slice(0, c.offset) + c.replacement + result.slice(c.offset + c.length);
      }
      return result;
    }
    return text;
  } catch (err) {
    logger.error(`[LanguageTool] Ошибка: ${err.message}`);
    if (err.response) {
      logger.error(`[LanguageTool] Ответ сервера: ${JSON.stringify(err.response.data)}`);
      // Дополнительно бросаем подробности ошибки наружу
      throw new Error(`LanguageTool 500: ${err.response.status} ${JSON.stringify(err.response.data)}`);
    }
    throw err;
  }
}

function postprocessWeak(text) {
  // Только trim и удаление пустых строк
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0).join('\n');
}
function postprocessMedium(text) {
  // Trim, удаление пустых, автозамена латиницы на кириллицу
  const map = { 'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','X':'Х',
    'a':'а','e':'е','k':'к','m':'м','o':'о','p':'р','c':'с','t':'т','x':'х' };
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
    .map(line => line.replace(/[A-Za-z]/g, ch => map[ch] || ch)).join('\n');
}
function postprocessStrong(text) {
  // Всё из medium + фильтрация мусора и объединение коротких строк
  const map = { 'A':'А','B':'В','E':'Е','K':'К','M':'М','H':'Н','O':'О','P':'Р','C':'С','T':'Т','X':'Х',
    'a':'а','e':'е','k':'к','m':'м','o':'о','p':'р','c':'с','t':'т','x':'х' };
  let lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 1);
  lines = lines.map(line => line.replace(/[A-Za-z]/g, ch => map[ch] || ch));
  // Удаляем строки без букв
  lines = lines.filter(line => /[А-Яа-яЁё]/.test(line));
  // Объединяем короткие строки
  let out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length < 20 && i > 0) out[out.length-1] += ' ' + lines[i];
    else out.push(lines[i]);
  }
  return out.join('\n');
}

// --- Tesseract OCR ---
const Tesseract = require('tesseract.js');

async function recognizeTextTesseract(imagePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'rus', { logger: () => {} });
    return text;
  } catch (e) {
    logger.error(`[Tesseract] Ошибка: ${e.message}`);
    throw e;
  }
}

async function recognizeTextWithTemplateTesseract(imagePath, preType, postType) {
  const processedPath = imagePath.replace(/(\.[^.]+)$/, `_${preType}_${postType}$1`);
  logger.info(`[OCR] Шаблон: pre=${preType}, post=${postType} — старт`);
  try {
    // Таймаут на всю обработку (например, 60 секунд)
    const timeoutMs = 60000;
    const result = await Promise.race([
      (async () => {
        await preMap[preType](imagePath, processedPath);
        logger.info(`[OCR] preMap[${preType}] завершён`);
        let text = await recognizeTextTesseract(processedPath);
        logger.info(`[OCR] Tesseract завершён`);
        text = postMap[postType](text);
        logger.info(`[OCR] postMap[${postType}] завершён`);
        logger.info(`[OCR] Шаблон: pre=${preType}, post=${postType} — УСПЕХ`);
        return text;
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout for template pre=${preType}, post=${postType}`)), timeoutMs))
    ]);
    return result;
  } catch (e) {
    logger.error(`[OCR] Ошибка в шаблоне pre=${preType}, post=${postType}: ${e.message}`);
    return `Ошибка в шаблоне pre=${preType}, post=${postType}: ${e.message}`;
  }
}

// --- Автостарт LanguageTool-сервера ---
let ltServerStarted = false;
function restartLanguageToolServer() {
  const { execSync, spawn } = require('child_process');
  try {
    const pids = execSync("lsof -t -i :8081").toString().trim().split(/\s+/);
    for (const pid of pids) {
      if (pid) execSync(`kill -9 ${pid}`);
    }
    logger.info('[LT] Старые процессы на 8081 завершены');
  } catch (e) {
    logger.info('[LT] Нет старых процессов на 8081');
  }
  ltServerStarted = false;

  // Запускаем сервер и логируем stdout/stderr
  const jarPath = '/home/user1/.ssh/tgbotikar/LanguageTool-6.6/languagetool-server.jar';
  const java = spawn('java', ['-jar', jarPath, '--port', '8081']);
  java.stdout.on('data', (data) => {
    logger.info(`[LT-Server] ${data.toString().trim()}`);
  });
  java.stderr.on('data', (data) => {
    logger.error(`[LT-Server] ${data.toString().trim()}`);
  });
  java.on('close', (code) => {
    logger.error(`[LT-Server] Процесс завершён с кодом ${code}`);
  });
  ltServerStarted = true;
}

function startLanguageToolServer() {
  if (ltServerStarted) return;
  ltServerStarted = true;
  const jarPath = '/home/user1/.ssh/tgbotikar/LanguageTool-6.6/languagetool-server.jar';
  const java = spawn('java', ['-jar', jarPath, '--port', '8081'], {
    detached: true,
    stdio: 'ignore'
  });
  java.unref();
}

// Вместо старта — рестартуем сервер при инициализации модуля
restartLanguageToolServer();

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

module.exports = {
  preprocessImage,
  recognizeTextTesseract,
  recognizeTextWithTemplateTesseract,
  smartJoinAndCorrect,
  preMap,
  postMap,
  postprocessLanguageTool
};
