const { Telegraf, Markup, session } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const fuzzysort = require('fuzzysort');

function safeRequire(modulePath) {
  try { return require(modulePath); } catch (e) { console.error(`[FATAL] require('${modulePath}')`, e); throw e; }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Модули и сервисы
const { exportCacheToJsonFile, uploadCacheJsonToYadisk } = safeRequire("./modules/cache_export");
const ui = safeRequire("./modules/ui_messages");
const logger = safeRequire("./modules/logger");
const { recognizeText } = safeRequire("./modules/ocr");
const { convertDocxToPdf } = safeRequire("./modules/docx2pdf");
const { saveToCacheHistory, getAllCacheQuestions, fuzzyFindInCache } = safeRequire("./modules/cache");
const { postprocessLanguageTool, levenshtein } = require('./modules/ocr');
const { loadGarbage, addGarbage, filterGarbage } = require('./modules/ocr_garbage_manager');
const { getTemplates } = require('./modules/ocr/templates');
const { processOcrPipeline } = require('./modules/ocr/pipeline');
const { semanticOcrAssemble, humanReadableAssemble } = require('./modules/ocr/postprocess');
const { mergeOcrResultsNoDuplicates } = require('./modules/ocr/scoring');

require("dotenv").config();
const YaDiskService = require("./services/yadisk_service");

// Инициализация Яндекс.Диск сервиса
const YADISK_TOKEN = process.env.YADISK_TOKEN;
if (!YADISK_TOKEN) throw new Error("Не найден YADISK_TOKEN в .env");
const yadisk = new YaDiskService(YADISK_TOKEN);

// Пути и основные переменные
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");
const cachePath = path.join(__dirname, "cache");
const tempPath = path.join(__dirname, "temp");
const gpt4allPath = path.join(modelDir, modelName);
const gpt4allCachePath = path.join(gpt4allPath, "cache");

// Инициализация бота и Express
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));
fs.ensureDirSync(cachePath);

// SQLite база данных для кэша
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    logger.error("DB Error: " + err.message);
    process.exit(1);
  } else {
    try { initDatabase(); } catch (error) { logger.error("Ошибка инициализации БД: " + error.message); }
  }
});
function initDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS gpt_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT UNIQUE,
    response TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

// GPT4All модель (ленивая инициализация)
let gpt4allModel = null;
async function initGPT4AllModel() {
  const model = await gpt4all.loadModel(modelName);
  return {
    generate: async (prompt) => {
      const options = { maxTokens: 32, temp: 1.5, topK: 1, topP: 0.1, repeatPenalty: 1.0, batchSize: 1 };
      return (await model.generate(prompt, options)).text;
    },
  };
}

// Очередь задач на генерацию кэша
const cacheQueue = [];
let isCacheProcessing = false;

// Fuzzy-поиск по кэшу на Яндекс.Диске
async function fuzzyFindInYandexDisk(question) {
  try {
    const remotePath = "/bot_cache/dataset.json";
    const localPath = path.join(cachePath, "dataset.json");
    await yadisk.downloadFileByPath(remotePath, localPath);
    if (!fs.existsSync(localPath)) return null;
    const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
    if (!Array.isArray(data)) return null;
    const results = fuzzysort.go(question, data, { key: 'prompt', threshold: -1000 });
    if (results.length > 0 && results[0].score > -1000) return results[0].obj.response;
    return null;
  } catch (err) {
    logger.error(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    notifyAdmin(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    return null;
  }
}

// Уведомление администратора
const ADMIN_ID = process.env.ADMIN_ID;
function notifyAdmin(message) {
  if (ADMIN_ID) bot.telegram.sendMessage(ADMIN_ID, `[ADMIN LOG]\n${message}`);
  logger.info(`[ADMIN NOTIFY] ${message}`);
}

// Сообщение о прогрессе пользователю и админу
async function sendProgress(ctx, text) {
  try { await ctx.reply(text); } catch {}
  notifyAdmin(text);
}

// Разбивка длинного текста на части
function splitTextByLength(text, maxLength = 700) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.substring(i, i + maxLength));
    i += maxLength;
  }
  return parts;
}

// Генерация кэша по материалу с очередью и прогрессом
async function processCacheQueue() {
  if (isCacheProcessing || cacheQueue.length === 0) return;
  isCacheProcessing = true;
  const { ctx } = cacheQueue.shift();
  try {
    await sendProgress(ctx, ui.processingFile);
    const files = await yadisk.syncMaterials();
    if (!files.length) {
      await sendProgress(ctx, ui.error("Нет файлов для кэша."));
      isCacheProcessing = false;
      return;
    }
    const random = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(materialsPath, random);
    await sendProgress(ctx, ui.processingFile + `\n📄 Используется файл: ${random}`);
    const content = await parseDocxToText(filePath);
    const parts = splitTextByLength(content, 700);
    let allSummaries = [];
    for (let idx = 0; idx < parts.length; idx++) {
      await sendProgress(ctx, ui.generatingPrompt(idx + 1, parts.length));
      const prompt = `Ты профессиональный специалист по контрольно-кассовой технике, 1С и автоматизации бизнеса. 
Изучи материал ниже и выдели только те тезисы, которые будут полезны специалисту в этой области. Не перечисляй общеизвестные основы и базовые факты. Упоминай только новые, сложные или малоизвестные детали, которые могут быть интересны профессионалу. Каждый тезис — с новой строки.

${parts[idx]}`;
      if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
      await sendProgress(ctx, ui.promptSent);
      const summary = await gpt4allModel.generate(prompt);
      await sendProgress(ctx, ui.modelAnswerReceived);
      allSummaries.push(summary);
      const thesisList = summary
        .split(/\n+/).map(t => t.trim()).filter(Boolean)
        .map((t, i) => `📌 <b>${i + 1}.</b> ${escapeHTML(t)}`).join('\n\n');
      await ctx.replyWithHTML(`✅ <b>Тезисы по части ${idx + 1}:</b>\n\n${thesisList}`);
    }
    const finalSummary = allSummaries.join("\n---\n");
    await sendProgress(ctx, ui.savingToCache);
    saveToCacheAndSync(random, finalSummary, ctx);
    const thesisList = finalSummary
      .split(/\n+/).map(t => t.trim()).filter(Boolean)
      .map((t, i) => `📌 <b>${i + 1}.</b> ${escapeHTML(t)}`).join('\n\n');
    await ctx.replyWithHTML(`✅ <b>Краткое изложение (тезисы):</b>\n\n${thesisList}`);
    await sendProgress(ctx, ui.cacheSynced);
    notifyAdmin(`Кэш сгенерирован для файла: ${random}`);
  } catch (err) {
    await sendProgress(ctx, ui.error(err.message));
    notifyAdmin(`Ошибка генерации кэша: ${err.message}`);
    logger.error(`Ошибка генерации кэша: ${err.message}`);
  } finally {
    isCacheProcessing = false;
    if (cacheQueue.length > 0) processCacheQueue();
  }
}

// Генерация ответа ИИ (без стриминга)
async function streamAIResponse(prompt, ctx) {
  try {
    if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
    const result = await gpt4allModel.generate(prompt);
    await ctx.reply("✅ Результат:\n" + result);
  } catch (error) {
    await ctx.reply(ui.error(error.message));
    logger.error("Ошибка генерации ответа: " + error.message);
  }
}

// Извлечение текста из docx
async function parseDocxToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (error) {
    logger.error(`Ошибка при обработке файла ${filePath}: ${error.message}`);
    throw new Error("Не удалось извлечь текст из файла.");
  }
}

// Генерация тестового вопроса по тексту
async function generateAIQuestions(text) {
  try {
    const maxInputLength = 700;
    const truncatedText = text.length > maxInputLength ? text.substring(0, maxInputLength) + "..." : text;
    const prompt = `Сформулируй один короткий вопрос с 4 вариантами ответов по тексту ниже. Отметь правильный вариант.\nВОПРОС:\nА)\nБ)\nВ)\nГ)\nПРАВИЛЬНЫЙ:`;
    if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
    return await gpt4allModel.generate(`${prompt}\n\n${truncatedText}`);
  } catch (error) {
    logger.error("Ошибка при генерации вопросов: " + error.message);
    throw new Error("Не удалось сгенерировать вопросы.");
  }
}

// Парсинг ответа теста
function parseTestResponse(response) {
  const lines = response.split("\n");
  return {
    question: lines[0]?.replace("ВОПРОС:", "").trim(),
    answers: {
      А: lines[1]?.slice(3).trim(),
      Б: lines[2]?.slice(3).trim(),
      В: lines[3]?.slice(3).trim(),
      Г: lines[4]?.slice(3).trim(),
    },
    correct: lines[5]?.replace("ПРАВИЛЬНЫЙ:", "").trim(),
  };
}

// Логирование и отправка сообщения в бот
function logAndNotify(message, ctx = null) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  logger.info(logMessage);
  if (ctx) ctx.reply(message);
}

// Главное меню бота
function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📂 Материалы", "materials")],
    [Markup.button.callback("🤖 Задать вопрос ИИ", "ask_ai")],
    [Markup.button.callback("📊 Генерация Кэша", "generate_cache")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
    [Markup.button.callback("🔄 Резет", "reset")],
  ]);
}

// Состояния пользователей и история сообщений
const userStates = {};
const userContexts = {};

// Стартовое сообщение
bot.start((ctx) => ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard()));
bot.action("reset", async (ctx) => ctx.reply("История сброшена.", mainMenuKeyboard()));

// Список материалов
bot.action("materials", async (ctx) => {
  try {
    const files = await fs.readdir(materialsPath);
    const docxFiles = files.filter(f => f.endsWith(".docx"));
    if (!docxFiles.length) return ctx.reply("Нет доступных материалов.");
    const buttons = docxFiles.map(f => [Markup.button.callback(f, `material_${encodeURIComponent(f)}`)]);
    await ctx.reply("Выберите материал:", Markup.inlineKeyboard(buttons));
  } catch (err) {
    logger.error("Ошибка при получении списка материалов: " + err.message);
    await ctx.reply("Ошибка при получении списка материалов.");
  }
});

// Отправка PDF по выбранному материалу
bot.action(/material_(.+)/, async (ctx) => {
  const fileName = decodeURIComponent(ctx.match[1]);
  const docxPath = path.join(materialsPath, fileName);
  const pdfName = fileName.replace(/\.docx$/i, ".pdf");
  const pdfPath = path.join(cachePath, pdfName);
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(null);
    await ctx.reply(ui.processingFile);
    await convertDocxToPdf(docxPath, pdfPath);
    await ctx.replyWithDocument({ source: pdfPath, filename: pdfName });
    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  } catch (err) {
    logger.error("Ошибка при конвертации или отправке PDF: " + err.message);
    await ctx.reply(ui.error("Ошибка при конвертации или отправке PDF: " + err.message));
    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  }
});

// Ввод вопроса для ИИ
bot.action("ask_ai", async (ctx) => {
  userStates[ctx.from.id] = "awaiting_ai_prompt";
  if (!userContexts[ctx.from.id]) userContexts[ctx.from.id] = [];
  await ctx.reply("Введите ваш вопрос для ИИ:");
});

// Обработка текстовых сообщений (поиск в кэше, Я.Диске, генерация)
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  if (userStates[userId] === "awaiting_ai_prompt" || userStates[userId] === "chatting_ai") {
    userStates[userId] = "chatting_ai";
    if (!userContexts[userId]) userContexts[userId] = [];
    userContexts[userId].push({ role: "user", content: ctx.message.text });
    logger.info(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);
    notifyAdmin(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);
    await ctx.reply(ui.searchingLocalCache);
    getAllCacheQuestions((err, rows) => {
      if (err) {
        logger.error(`[CACHE] Ошибка получения кэша: ${err.message}`);
        notifyAdmin(`[CACHE] Ошибка получения кэша: ${err.message}`);
        ctx.reply(ui.error("Ошибка поиска в кэше."));
        return;
      }
      logger.info(`[CACHE] В кэше ${rows.length} записей. Начинаем fuzzy поиск...`);
      notifyAdmin(`[CACHE] В кэше ${rows.length} записей. Начинаем fuzzy поиск...`);
      const results = fuzzysort.go(ctx.message.text, rows, { key: 'prompt', threshold: -1000 });
      if (results.length > 0) {
        logger.info(`[CACHE] Лучший результат: "${results[0].obj.prompt}" (score: ${results[0].score})`);
        notifyAdmin(`[CACHE] Лучший результат: "${results[0].obj.prompt}" (score: ${results[0].score})`);
      } else {
        logger.info(`[CACHE] Совпадений не найдено.`);
        notifyAdmin(`[CACHE] Совпадений не найдено.`);
      }
      if (results.length > 0 && results[0].score > -1000) {
        ctx.reply("🔎 Ответ из кэша (поиск по похожести):\n" + results[0].obj.response);
        logger.info(`[CACHE] Ответ отправлен из кэша.`);
        notifyAdmin(`[CACHE] Ответ отправлен из кэша.`);
        return;
      }
      (async () => {
        await ctx.reply(ui.searchingYadisk);
        const yadiskAnswer = await fuzzyFindInYandexDisk(ctx.message.text);
        if (yadiskAnswer) {
          ctx.reply("🔎 Ответ из кэша на Яндекс.Диске:\n" + yadiskAnswer);
          logger.info(`[YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          notifyAdmin(`[YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          return;
        }
        try {
          logger.info(`[AI] Ответа в кэше нет, обращаемся к модели...`);
          notifyAdmin(`[AI] Ответа в кэше нет, обращаемся к модели...`);
          if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
          const contextWindow = 10;
          const context = userContexts[userId].slice(-contextWindow);
          const prompt = context.map(m => (m.role === "user" ? `Пользователь: ${m.content}` : `ИИ: ${m.content}`)).join('\n') + "\nИИ:";
          await ctx.reply(ui.promptSent);
          const result = await gpt4allModel.generate(prompt);
          userContexts[userId].push({ role: "assistant", content: result });
          await ctx.reply(ui.answerSaved);
          saveToCacheAndSync(ctx.message.text, result, ctx);
          ctx.reply(result || "Пустой ответ от модели.");
          logger.info(`[AI] Ответ модели отправлен и сохранён в кэш.`);
          notifyAdmin(`[AI] Ответ модели отправлен и сохранён в кэш.`);
        } catch (error) {
          ctx.reply(ui.error(error.message));
          logger.error(`[AI] Ошибка генерации: ${error.message}`);
          notifyAdmin(`[AI] Ошибка генерации: ${error.message}`);
        }
      })();
    });
  }
});

// Клавиатура для OCR шаблонов
const ocrTemplatesKeyboard = [[{ text: 'Распознать всеми шаблонами', callback_data: 'ocr_all_templates' }]];

// Обработка фото для OCR
bot.on(["photo"], async (ctx) => {
  const userId = ctx.from.id;
  if (userStates[userId] === 'awaiting_original') {
    userStates[userId] = undefined;
    userLastOcr[userId] = undefined;
  }
  const photo = ctx.message.photo.pop();
  const fileId = photo.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(tempPath, `${userId}_${Date.now()}.jpg`);
  await fs.ensureDir(tempPath);
  const res = await fetch(fileLink.href);
  const buffer = await res.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  if (!ctx.session) ctx.session = {};
  ctx.session.lastPhotoPath = filePath;
  await ctx.reply("Выберите способ обработки OCR:", Markup.inlineKeyboard(ocrTemplatesKeyboard));
});

// OCR всеми шаблонами
bot.action('ocr_all_templates', async (ctx) => {
  try {
    const filePath = ctx.session && ctx.session.lastPhotoPath;
    if (!filePath || !fs.existsSync(filePath)) {
      await ctx.reply('Нет последнего фото для распознавания.');
      return;
    }
    await ctx.reply('Начинаю распознавание всеми шаблонами...');
    const templates = getTemplates();
    const allResults = [];
    for (let i = 0; i < templates.length; ++i) {
      const tpl = templates[i];
      logger.info(`[BOT] Старт шаблона ${i+1}: ${tpl.name}`);
      await ctx.reply(`Использую шаблон ${i+1}: ${tpl.name}`);
      let tesseractText = '';
      try {
        const { recognizeTextWithTemplateTesseract } = require("./modules/ocr");
        tesseractText = await recognizeTextWithTemplateTesseract(filePath, tpl.pre, tpl.post);
        logger.info(`[BOT] Результат шаблона ${i+1}: ${tpl.name}: ${tesseractText}`);
      } catch (e) {
        tesseractText = `Ошибка Tesseract: ${e.message}`;
        logger.error(`[BOT] Ошибка шаблона ${i+1}: ${tpl.name}: ${e.message}`);
      }
      allResults.push({ tplName: tpl.name, text: tesseractText });
      try {
        await ctx.replyWithHTML(
          `<b>Шаблон ${i+1}: ${escapeHTML(tpl.name)}</b>\n\n<b>Tesseract:</b>\n<pre>${escapeHTML(tesseractText)}</pre>`
        );
        logger.info(`[BOT] Ответ отправлен по шаблону ${i+1}: ${tpl.name}`);
      } catch (err) {
        logger.error(`[BOT] Ошибка отправки ответа по шаблону ${i+1}: ${tpl.name}: ${err.message}`);
      }
    }
    const mergedText = mergeOcrResultsNoDuplicates(allResults);
    await ctx.replyWithHTML(
      `<b>📋 Итоговый текст (без дублей, без потерь):</b>\n\n<pre>${escapeHTML(mergedText)}</pre>`
    );
  } catch (e) {
    logger.error(`[BOT] Глобальная ошибка в ocr_all_templates: ${e.message}`);
    await ctx.reply('Ошибка при распознавании: ' + e.message);
  }
});

// Генерация теста (пример)
bot.action("generate_test", async (ctx) => {
  try {
    await streamAIResponse("Скажи привет", ctx);
  } catch (err) {
    logger.error("Ошибка при генерации теста: " + err.message);
    await ctx.reply(ui.error("Ошибка при генерации теста: " + err.message));
  }
});

// Кнопка "Генерация Кэша"
bot.action("generate_cache", async (ctx) => {
  cacheQueue.push({ ctx });
  await ctx.answerCbQuery("⏳ Задача поставлена в очередь.");
  await sendProgress(ctx, `Ваша задача на генерацию кэша добавлена в очередь. Позиция: ${cacheQueue.length}`);
  processCacheQueue();
});

// Загрузка файла на Яндекс.Диск
async function uploadToYandexDisk(localFilePath, remoteFilePath, ctx) {
  try {
    await yadisk.uploadFile(localFilePath, remoteFilePath);
    logAndNotify(`Файл загружен на Я.Диск: ${remoteFilePath}`, ctx);
  } catch (error) {
    logger.error("Ошибка загрузки на Я.Диск: " + error.message);
    logAndNotify(ui.error("Ошибка загрузки на Я.Диск: " + error.message), ctx);
    throw new Error("Не удалось загрузить файл на Яндекс.Диск.");
  }
}

// Сохранение в кэш и синхронизация с Яндекс.Диском
function saveToCacheAndSync(question, answer, ctx = null) {
  saveToCacheHistory(question, answer);
  const localPath = path.join(cachePath, "dataset.json");
  const remotePath = "/bot_cache/dataset.json";
  exportCacheToJsonFile(localPath, async (err) => {
    if (!err) {
      try {
        await uploadCacheJsonToYadisk(yadisk, localPath, remotePath);
        if (ctx) await ctx.reply(ui.cacheSynced);
        notifyAdmin(ui.cacheSynced);
        logger.info("Кэш успешно обновлён и синхронизирован!");
      } catch (e) {
        if (ctx) await ctx.reply(ui.error(e.message));
        notifyAdmin(ui.error(e.message));
        logger.error("Ошибка загрузки кэша на Яндекс.Диск: " + e.message);
      }
    } else {
      if (ctx) await ctx.reply(ui.error(err.message));
      notifyAdmin(ui.error(err.message));
      logger.error("Ошибка экспорта кэша в JSON: " + err.message);
    }
  });
}

// Скачивание файла Telegram во временную папку
async function downloadFile(file, userId) {
  const tempPath = path.join(__dirname, 'temp');
  await fs.ensureDir(tempPath);
  const ext = path.extname(file.file_path || '.jpg');
  const fileName = `${userId}_${Date.now()}${ext}`;
  const dest = path.join(tempPath, fileName);
  const fileLink = await bot.telegram.getFileLink(file.file_id);
  const res = await fetch(fileLink.href);
  if (!res.ok) throw new Error(`Ошибка загрузки файла: ${res.statusText}`);
  let buffer;
  if (typeof res.arrayBuffer === 'function') {
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    buffer = await res.buffer();
  }
  await fs.writeFile(dest, buffer);
  return dest;
}

// Оценка качества OCR-результата
function evalHumanReadableScoreV2(text) {
  if (!text || typeof text !== 'string') return 0;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const totalChars = text.length;
  const ruChars = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const ruRatio = ruChars / (totalChars || 1);
  const uniqLines = new Set(lines).size;
  const bonusWords = [
    "АКТИВИРУЙТЕ", "СКАЧАЙТЕ", "ПРИЛОЖЕНИЕ", "МАГАЗИН", "СЕРВИСЫ", "ЭВОТОР",
    "ИНН", "ОГРН", "АДРЕС", "КОНТАКТ", "ТЕЛЕФОН", "EMAIL", "E-MAIL",
    "КЛЮЧ", "ЕГАИС", "ТОРГОВЛИ", "БУХГАЛТЕРИЯ", "ФИО", "ООО", "ИП", "ОАО"
  ];
  let bonus = 0, phoneCount = 0, emailCount = 0, innCount = 0, addressCount = 0;
  const phoneRegex = /\+?\d[\d\s\-()]{7,}/g;
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const innRegex = /\b\d{10,12}\b/;
  const addressRegex = /(г\.|ул\.|просп\.|пер\.|д\.|офис|корпус|кв\.|пл\.|обл\.|район|р-н|поселок|микрорайон)/i;
  lines.forEach(line => {
    if (phoneRegex.test(line)) phoneCount++;
    if (emailRegex.test(line)) emailCount++;
    if (innRegex.test(line)) innCount++;
    if (addressRegex.test(line)) addressCount++;
    for (const w of bonusWords) if (line.toUpperCase().includes(w)) bonus += 0.1;
  });
  const noisyLines = lines.filter(l => l.length < 5 || (l.replace(/[А-Яа-яЁё0-9]/gi, '').length / l.length) > 0.5).length;
  const diversityBonus = uniqLines >= 3 ? 0.5 : 0;
  let score = (
    ruRatio * 2 +
    Math.min(lines.length / 10, 1) +
    Math.min(uniqLines / lines.length, 1) +
    bonus +
    diversityBonus +
    phoneCount * 0.7 +
    emailCount * 0.7 +
    innCount * 0.5 +
    addressCount * 0.5 -
    noisyLines * 0.2
  );
  if (lines.length === 1 && lines[0].length < 10) score -= 0.5;
  return score;
}

// Выбор лучшего OCR-результата
function selectBestOcrResultV2(allResults, semanticResult, cleanedSemantic, humanResult) {
  const candidates = [];
  allResults.forEach((r, i) => candidates.push({
    text: r,
    label: `Шаблон ${i + 1}`,
    score: evalHumanReadableScoreV2(r)
  }));
  candidates.push({ text: semanticResult, label: 'Семантическая сборка', score: evalHumanReadableScoreV2(semanticResult) });
  candidates.push({ text: cleanedSemantic, label: 'После LanguageTool', score: evalHumanReadableScoreV2(cleanedSemantic) });
  candidates.push({ text: humanResult, label: 'Финальный (humanReadableAssemble)', score: evalHumanReadableScoreV2(humanResult) });
  candidates.sort((a, b) => b.score - a.score);
  logger.info('[BOT] --- Сравнение вариантов OCR ---');
  candidates.forEach(c => {
    logger.info(`[BOT] ${c.label}: score=${c.score.toFixed(2)}\n${c.text}\n---`);
  });
  logger.info(`[BOT] Лучший результат: ${candidates[0].label} (оценка: ${candidates[0].score.toFixed(2)})`);
  logger.info(`[BOT] Лучший текст:\n${candidates[0].text}`);
  return candidates[0].text;
}

// Отправка лучшего OCR-результата пользователю
async function sendBestOcrResult(ctx, allResults, semanticResult, cleanedSemantic, humanResult) {
  let bestResult = selectBestOcrResultV2(allResults.map(r => r.text), semanticResult, cleanedSemantic, humanResult);
  let lines = bestResult.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  lines = await filterGarbage(lines);
  const importantWords = ['активируйте', 'скачайте', 'приложение', 'магазин', 'сервис', 'эво', 'касовые', 'подробнее', 'адрес', 'телефон', 'инн'];
  let garbageCandidates = [];
  const filtered = lines.filter(line => {
    const clean = line.replace(/[«»@*%_"'\-]/g, '').trim();
    if (clean.length < 8 && !importantWords.some(w => clean.toLowerCase().includes(w))) {
      garbageCandidates.push(line);
      return false;
    }
    if ((clean.match(/[А-Яа-яЁё]/g) || []).length < 3 && !importantWords.some(w => clean.toLowerCase().includes(w))) {
      garbageCandidates.push(line);
      return false;
    }
    return true;
  });
  await addGarbage(garbageCandidates);
  const finalText = filtered.join('\n');
  await ctx.replyWithHTML(
    `<b>📋 Итоговый текст с фото (максимально близко к оригиналу)</b>\n\n<pre>${escapeHTML(finalText)}</pre>`
  );
  logger.info(`[BOT] Все шаблоны завершены. Итоговая сборка для пользователя завершена.`);
  userStates[ctx.from.id] = 'awaiting_original';
  userLastOcr[ctx.from.id] = finalText;
  await ctx.reply('Если у вас есть оригинальный текст, отправьте его сюда для сравнения и улучшения качества распознавания.');
}

// Сравнение OCR-результата с оригиналом пользователя
const userLastOcr = {};
bot.on('text', async ctx => {
  const userId = ctx.from.id;
  if (userStates[userId] === 'awaiting_original' && userLastOcr[userId]) {
    const ocrText = userLastOcr[userId];
    const origText = ctx.message.text;
    const lev = levenshtein(ocrText.replace(/\s+/g, ''), origText.replace(/\s+/g, ''));
    const maxLen = Math.max(ocrText.length, origText.length);
    const similarity = maxLen > 0 ? (1 - lev / maxLen) : 0;
    await ctx.reply(`Сравнение завершено! Совпадение: ${(similarity * 100).toFixed(1)}%. Спасибо, ваш пример поможет улучшить распознавание.`);
    userStates[userId] = undefined;
    userLastOcr[userId] = undefined;
    return;
  }
  // ... (остальные обработчики текста)
});

module.exports = {
  app,
  bot,
  mainMenuKeyboard,
  parseDocxToText,
  splitTextByLength,
  saveToCacheAndSync,
  fuzzyFindInYandexDisk,
  gpt4allModel
};
