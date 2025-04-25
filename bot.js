const { Telegraf, Markup, session } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const fuzzysort = require('fuzzysort'); // Добавлено
const languageToolApi = require('languagetool-api');

// --- Логирование ошибок при require ---
function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (e) {
    console.error(`[FATAL] Ошибка при require('${modulePath}'):`, e);
    throw e;
  }
}

const { exportCacheToJsonFile, uploadCacheJsonToYadisk } = safeRequire("./modules/cache_export");
const ui = safeRequire("./modules/ui_messages"); // Новый модуль UI-сообщений
const logger = safeRequire("./modules/logger"); // <-- добавлен winston logger
const { recognizeText } = safeRequire("./modules/ocr"); // OCR-модуль
const { convertDocxToPdf } = safeRequire("./modules/docx2pdf");
const { saveToCacheHistory, getAllCacheQuestions, fuzzyFindInCache } = safeRequire("./modules/cache");
const { postprocessLanguageTool } = require('./modules/ocr'); // Импорт локальной постобработки LanguageTool

require("dotenv").config();

const YaDiskService = require("./services/yadisk_service");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");
const cachePath = path.join(__dirname, "cache");
const tempPath = path.join(__dirname, "temp");
const gpt4allPath = path.join(modelDir, modelName);
const gpt4allCachePath = path.join(gpt4allPath, "cache");
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));

// Убедитесь, что папка cache существует
fs.ensureDirSync(cachePath);

// Улучшенная обработка ошибок при инициализации базы данных
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    logger.error("DB Error: " + err.message);
    process.exit(1); // Завершаем процесс, если база данных не инициализируется
  } else {
    try {
      initDatabase();
    } catch (error) {
      logger.error("Ошибка при инициализации базы данных: " + error.message);
    }
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

let gpt4allModel = null;
async function initGPT4AllModel() {
  const model = await gpt4all.loadModel(modelName);
  return {
    generate: async (prompt) => {
      const options = {
        maxTokens: 32,
        temp: 1.5,
        topK: 1,
        topP: 0.1,
        repeatPenalty: 1.0,
        batchSize: 1,
      };
      return (await model.generate(prompt, options)).text;
    },
  };
}

// Асинхронная очередь задач для генерации кэша
const cacheQueue = [];
let isCacheProcessing = false;

// Fuzzy поиск по кэшу на Яндекс.Диске
async function fuzzyFindInYandexDisk(question) {
  try {
    // Скачиваем файл кэша с Я.Диска (например, cache/dataset.json)
    const remotePath = "/bot_cache/dataset.json";
    const localPath = path.join(cachePath, "dataset.json");
    await yadisk.downloadFileByPath(remotePath, localPath);

    if (!fs.existsSync(localPath)) return null;
    const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
    if (!Array.isArray(data)) return null;

    // data: [{ prompt, response }, ...]
    const results = fuzzysort.go(question, data, { key: 'prompt', threshold: -1000 });
    if (results.length > 0 && results[0].score > -1000) {
      return results[0].obj.response;
    }
    return null;
  } catch (err) {
    logger.error(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    notifyAdmin(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    return null;
  }
}

// Логирование ошибок и отчётов для администратора (через ADMIN_ID)
const ADMIN_ID = process.env.ADMIN_ID;
function notifyAdmin(message) {
  if (ADMIN_ID) bot.telegram.sendMessage(ADMIN_ID, `[ADMIN LOG]\n${message}`);
  logger.info(`[ADMIN NOTIFY] ${message}`);
}

// Прогресс и статус
async function sendProgress(ctx, text) {
  try { await ctx.reply(text); } catch {}
  notifyAdmin(text);
}

// Обработка длинных материалов (разбивка на части)
function splitTextByLength(text, maxLength = 700) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.substring(i, i + maxLength));
    i += maxLength;
  }
  return parts;
}

// Новая функция генерации кэша с очередью и прогрессом
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

    // Разбиваем материал на части
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

      // Показываем тезисы пользователю сразу после обработки блока
      const thesisList = summary
        .split(/\n+/)
        .map(t => t.trim())
        .filter(Boolean)
        .map((t, i) => `📌 <b>${i + 1}.</b> ${t}`)
        .join('\n\n');
      await ctx.replyWithHTML(
        `✅ <b>Тезисы по части ${idx + 1}:</b>\n\n${thesisList}`
      );
    }
    const finalSummary = allSummaries.join("\n---\n");

    // Сохраняем историю генераций (каждый запуск — новая запись)
    await sendProgress(ctx, ui.savingToCache);
    saveToCacheAndSync(random, finalSummary, ctx);

    // Красиво оформляем тезисы для вывода в бот
    const thesisList = finalSummary
      .split(/\n+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map((t, i) => `📌 <b>${i + 1}.</b> ${t}`)
      .join('\n\n');

    await ctx.replyWithHTML(
      `✅ <b>Краткое изложение (тезисы):</b>\n\n${thesisList}`
    );

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

// Старый вариант: обычный асинхронный промпт-запрос без стриминга
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

// Обработка ошибок при работе с файлами
async function parseDocxToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (error) {
    logger.error(`Ошибка при обработке файла ${filePath}: ${error.message}`);
    throw new Error("Не удалось извлечь текст из файла.");
  }
}

// Обработка ошибок при генерации вопросов
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

// Логирование в консоль и в бот
function logAndNotify(message, ctx = null) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  logger.info(logMessage); // Логируем в консоль
  if (ctx) ctx.reply(message); // Отправляем в бот
}

// Основное меню
function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📂 Материалы", "materials")],
    [Markup.button.callback("🤖 Задать вопрос ИИ", "ask_ai")],
    [Markup.button.callback("📊 Генерация Кэша", "generate_cache")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
    [Markup.button.callback("🔄 Резет", "reset")],
  ]);
}

// Храним историю сообщений для каждого пользователя
const userStates = {};
const userContexts = {}; // userId: [ {role: "user"/"assistant", content: "..."} ]

bot.start((ctx) => ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard()));
bot.action("reset", async (ctx) => ctx.reply("История сброшена.", mainMenuKeyboard()));

// Кнопка "Материалы" — выводит список файлов
bot.action("materials", async (ctx) => {
  try {
    const files = await fs.readdir(materialsPath);
    const docxFiles = files.filter(f => f.endsWith(".docx"));
    if (!docxFiles.length) {
      return ctx.reply("Нет доступных материалов.");
    }
    const buttons = docxFiles.map(f =>
      [Markup.button.callback(f, `material_${encodeURIComponent(f)}`)]
    );
    await ctx.reply("Выберите материал:", Markup.inlineKeyboard(buttons));
  } catch (err) {
    logger.error("Ошибка при получении списка материалов: " + err.message);
    await ctx.reply("Ошибка при получении списка материалов.");
  }
});

// Обработка нажатия на конкретный материал
bot.action(/material_(.+)/, async (ctx) => {
  const fileName = decodeURIComponent(ctx.match[1]);
  const docxPath = path.join(materialsPath, fileName);
  const pdfName = fileName.replace(/\.docx$/i, ".pdf");
  const pdfPath = path.join(cachePath, pdfName);

  try {
    await ctx.answerCbQuery(); // Подтверждаем получение callback
    await ctx.editMessageReplyMarkup(null); // Удаляем клавиатуру
    await ctx.reply(ui.processingFile);
    
    await convertDocxToPdf(docxPath, pdfPath);
    await ctx.replyWithDocument({ source: pdfPath, filename: pdfName });
    
    // Показываем главное меню после отправки файла
    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  } catch (err) {
    logger.error("Ошибка при конвертации или отправке PDF: " + err.message);
    await ctx.reply(ui.error("Ошибка при конвертации или отправке PDF: " + err.message));
    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  }
});

// Кнопка "Задать вопрос ИИ"
bot.action("ask_ai", async (ctx) => {
  userStates[ctx.from.id] = "awaiting_ai_prompt";
  if (!userContexts[ctx.from.id]) userContexts[ctx.from.id] = [];
  await ctx.reply("Введите ваш вопрос для ИИ:");
});

// Подробное логирование процесса сверки при отправке запроса в кэш и на Я.Диск
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  if (userStates[userId] === "awaiting_ai_prompt" || userStates[userId] === "chatting_ai") {
    userStates[userId] = "chatting_ai";
    if (!userContexts[userId]) userContexts[userId] = [];
    userContexts[userId].push({ role: "user", content: ctx.message.text });

    logger.info(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);
    notifyAdmin(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);

    // 1. Fuzzy поиск в локальном кэше
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

      // 2. Fuzzy поиск на Яндекс.Диске
      (async () => {
        await ctx.reply(ui.searchingYadisk);
        const yadiskAnswer = await fuzzyFindInYandexDisk(ctx.message.text);
        if (yadiskAnswer) {
          ctx.reply("🔎 Ответ из кэша на Яндекс.Диске:\n" + yadiskAnswer);
          logger.info(`[YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          notifyAdmin(`[YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          return;
        }

        // 3. Если нет ни в одном кэше — спрашиваем модель
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

// --- OCR шаблоны: топ-10 лучших ---
const ocrTemplates = [
  { pre: 'cropTextBlock', post: 'strong', name: 'cropTextBlock+strong' },
  { pre: 'cropTextBlock', post: 'medium', name: 'cropTextBlock+medium' },
  { pre: 'cropTextBlock', post: 'weak', name: 'cropTextBlock+weak' },
  { pre: 'strong', post: 'medium', name: 'strong+medium' },
  { pre: 'strong', post: 'strong', name: 'strong+strong' },
  { pre: 'strong', post: 'weak', name: 'strong+weak' },
  { pre: 'medium', post: 'strong', name: 'medium+strong' },
  { pre: 'medium', post: 'medium', name: 'medium+medium' },
  { pre: 'medium', post: 'weak', name: 'medium+weak' },
  { pre: 'strongV3', post: 'strong', name: 'strongV3+strong' }
];

// --- Единая кнопка для запуска всех шаблонов ---
const ocrTemplatesKeyboard = [[{ text: 'Распознать всеми шаблонами', callback_data: 'ocr_all_templates' }]];

// При получении фото сохраняем путь и предлагаем кнопку
bot.on(["photo"], async (ctx) => {
  const userId = ctx.from.id;
  if (userStates[userId] === "awaiting_ai_prompt" || userStates[userId] === "chatting_ai") {
    userStates[userId] = "chatting_ai";
    const photo = ctx.message.photo.pop();
    const fileId = photo.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const filePath = path.join(tempPath, `${userId}_${Date.now()}.jpg`);
    await fs.ensureDir(tempPath);
    const res = await fetch(fileLink.href);
    const buffer = await res.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
    // Сохраняем путь к фото в сессию
    if (!ctx.session) ctx.session = {};
    ctx.session.lastPhotoPath = filePath;
    // Генерируем клавиатуру из 1 кнопки
    await ctx.reply("Выберите способ обработки OCR:", Markup.inlineKeyboard(ocrTemplatesKeyboard));
  }
});

// Обработка кнопки "Распознать всеми шаблонами"
bot.action('ocr_all_templates', async (ctx) => {
  try {
    const filePath = ctx.session && ctx.session.lastPhotoPath;
    if (!filePath || !fs.existsSync(filePath)) {
      await ctx.reply('Нет последнего фото для распознавания.');
      return;
    }
    await ctx.reply('Начинаю распознавание всеми шаблонами...');
    const allResults = [];
    for (let i = 0; i < ocrTemplates.length; ++i) {
      const tpl = ocrTemplates[i];
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
          `<b>Шаблон ${i+1}: ${tpl.name}</b>\n\n<b>Tesseract:</b>\n<pre>${escapeHTML(tesseractText)}</pre>`
        );
        logger.info(`[BOT] Ответ отправлен по шаблону ${i+1}: ${tpl.name}`);
      } catch (err) {
        logger.error(`[BOT] Ошибка отправки ответа по шаблону ${i+1}: ${tpl.name}: ${err.message}`);
      }
    }
    // --- Новый этап: "семантическая сборка" из всех шаблонов ---
    const semanticResult = semanticOcrAssemble(allResults);
    logger.info(`[BOT] Итоговый результат семантической сборки: ${semanticResult}`);
    // --- Очистка через локальный LanguageTool ---
    const cleanedSemantic = await postprocessLanguageTool(semanticResult);
    logger.info(`[BOT] Итоговый результат после LanguageTool: ${cleanedSemantic}`);
    // --- Финальная сборка для Telegram ---
    const humanResult = humanReadableAssemble(cleanedSemantic);
    logger.info(`[BOT] Итоговый результат для Telegram: ${humanResult}`);
    // --- Оценка человекочитаемости результата OCR ---
    function evalHumanReadableScore(text) {
      if (!text || typeof text !== 'string') return 0;
      // Количество строк и средняя длина
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) return 0;
      const avgLen = lines.reduce((a, b) => a + b.length, 0) / lines.length;
      // Доля русских букв
      const totalChars = text.length;
      const ruChars = (text.match(/[А-Яа-яЁё]/g) || []).length;
      const ruRatio = ruChars / (totalChars || 1);
      // Количество "мусорных" строк (очень коротких, с большим количеством спецсимволов)
      const noisyLines = lines.filter(l => l.length < 5 || (l.replace(/[А-Яа-яЁё0-9]/gi, '').length / l.length) > 0.5).length;
      // Количество уникальных строк
      const uniqLines = new Set(lines).size;
      // Бонус за наличие типичных слов (например, "активируйте", "скачайте", "приложение", "магазин")
      const bonusWords = ["АКТИВИРУЙТЕ", "СКАЧАЙТЕ", "ПРИЛОЖЕНИЕ", "МАГАЗИН", "СЕРВИСЫ", "ЭВОТОР"];
      let bonus = 0;
      for (const w of bonusWords) if (text.toUpperCase().includes(w)) bonus += 0.1;
      // Итоговая формула: больше русских букв, меньше мусора, больше строк, больше уникальности, бонус за ключевые слова
      return (
        ruRatio * 2 +
        Math.min(avgLen / 20, 1) +
        Math.min(lines.length / 10, 1) +
        Math.min(uniqLines / lines.length, 1) +
        bonus -
        noisyLines * 0.2
      );
    }

    // --- Выбор лучшего результата OCR ---
    function selectBestOcrResult(allResults, semanticResult, cleanedSemantic, humanResult) {
      // Оцениваем все варианты
      const candidates = [];
      allResults.forEach((r, i) => candidates.push({
        text: r,
        label: `Шаблон ${i + 1}`,
        score: evalHumanReadableScore(r)
      }));
      candidates.push({ text: semanticResult, label: 'Семантическая сборка', score: evalHumanReadableScore(semanticResult) });
      candidates.push({ text: cleanedSemantic, label: 'После LanguageTool', score: evalHumanReadableScore(cleanedSemantic) });
      candidates.push({ text: humanResult, label: 'Финальный (humanReadableAssemble)', score: evalHumanReadableScore(humanResult) });
      // Выбираем с максимальным score
      candidates.sort((a, b) => b.score - a.score);
      logger.info(`[BOT] Лучший результат: ${candidates[0].label} (оценка: ${candidates[0].score.toFixed(2)})`);
      logger.info(`[BOT] Лучший текст:\n${candidates[0].text}`);
      return candidates[0].text;
    }

    const bestResult = selectBestOcrResult(allResults.map(r => r.text), semanticResult, cleanedSemantic, humanResult);
    sendBestOcrResult(ctx, bestResult);
  } catch (e) {
    logger.error(`[BOT] Глобальная ошибка в ocr_all_templates: ${e.message}`);
    await ctx.reply('Ошибка при распознавании: ' + e.message);
  }
});

// --- Умная семантическая сборка: разбивка, фильтрация, сортировка ---
function semanticOcrAssemble(results) {
  // 1. Разбиваем длинные строки на смысловые блоки
  function splitToBlocks(text) {
    return text
      .split(/[\n\r\f\v\u2028\u2029\u0085]+/)
      .flatMap(line =>
        line
          .split(/\s{2,}|\||:|—|–|—|\.|,|;/) // делим по двойным пробелам, |, :, тире, точкам, запятым, точкам с запятой
          .map(x => x.trim())
      )
      .filter(Boolean);
  }
  // 2. Фильтруем: только строки с >=2 русскими словами длиной >=4, доля букв >0.6
  function isClean(line) {
    const words = (line.match(/[а-яА-ЯёЁ]{4,}/g) || []);
    const letterFrac = (line.replace(/[^а-яА-ЯёЁ]/g, '').length / (line.length || 1));
    return words.length >= 2 && letterFrac > 0.6;
  }
  // 3. Собираем все блоки
  let allBlocks = [];
  results.forEach(r => {
    allBlocks = allBlocks.concat(splitToBlocks(r.text));
  });
  // 4. Фильтруем мусор
  allBlocks = allBlocks.filter(isClean);
  // 5. Считаем частоту
  const freq = {};
  allBlocks.forEach(line => { freq[line] = (freq[line] || 0) + 1; });
  // 6. Сортируем по частоте и длине
  allBlocks = [...new Set(allBlocks)];
  allBlocks.sort((a, b) => freq[b] - freq[a] || b.length - a.length);
  // 7. Убираем дубли и похожие строки (fuzzysort, threshold -30)
  const finalLines = [];
  allBlocks.forEach(line => {
    if (!finalLines.some(existing => {
      const res = fuzzysort.single(line, [existing], { threshold: -30 });
      return res && res.score > -30;
    })) {
      finalLines.push(line);
    }
  });
  // 8. Сортировка по ключевым словам (если есть)
  const keywords = [
    'ИП', '1С', 'БУХГАЛТЕРИЯ', 'Денежный ящик', 'Форт', 'позиционный', 'руб', 'Подпись', 'дата', 'автоматизация', 'принтер', 'сканер', 'весовое', 'терминал', 'POS'
  ];
  finalLines.sort((a, b) => {
    const ka = keywords.findIndex(k => a.toLowerCase().includes(k.toLowerCase()));
    const kb = keywords.findIndex(k => b.toLowerCase().includes(k.toLowerCase()));
    if (ka !== kb) return (ka === -1 ? 100 : ka) - (kb === -1 ? 100 : kb);
    return b.length - a.length;
  });
  return finalLines.join('\n');
}

// --- Финальная "человеко-ориентированная" сборка для Telegram ---
function humanReadableAssemble(text) {
  // Ключевые смысловые блоки в нужном порядке (можно расширять)
  const keyPhrases = [
    "1С БУХГАЛТЕРИЯ",
    "АВТОМАТИЗАЦИЯ ТОРГОВЛИ",
    "ПРИНТЕРЫ ЭТИКЕТОК",
    "СКАНЕРЫ ШТРИХ-КОДА",
    "ВЕСОВОЕ ОБОРУДОВАНИЕ",
    "ТЕРМИНАЛЫ СБОРА ДАННЫХ",
    "POS-системы"
  ];
  // Привести к верхнему регистру, убрать мусорные символы
  const lines = text.split(/\r?\n|['"“”‘’—–…·•,.;:!?()\[\]{}]/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  // Для каждого ключевого блока ищем наиболее похожую строку из OCR
  const uniq = new Set();
  const result = [];
  for (const phrase of keyPhrases) {
    let best = '';
    let bestScore = -100;
    for (const line of lines) {
      // Простая метрика схожести: сколько слов из ключа есть в строке
      const words = phrase.split(' ');
      let score = 0;
      for (const w of words) if (line.includes(w)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    }
    // Добавляем только если совпало хотя бы 2 слова и ещё не было такого блока
    if (bestScore >= 2 && !uniq.has(phrase)) {
      result.push(phrase);
      uniq.add(phrase);
    }
  }
  // Если ничего не найдено — fallback: фильтруем осмысленные строки
  if (result.length === 0) {
    // Фильтр: убираем короткие, мусорные, дублирующиеся строки
    const filtered = lines.filter(line =>
      line.length >= 8 &&
      /[А-ЯЁ]{2,}/.test(line) && // минимум 2 русские буквы
      /[A-ZА-ЯЁ0-9]/.test(line) && // есть буквы/цифры
      !/^[-_=]+$/.test(line) && // не только символы
      line.replace(/[^А-ЯЁ]/g, '').length >= 0.5 * line.length // не менее 50% букв
    );
    // Убираем дубли
    const uniqFiltered = [...new Set(filtered)];
    // Если совсем ничего — fallback: берём любые строки не короче 5 символов
    if (uniqFiltered.length === 0) {
      const anyLines = [...new Set(lines.filter(line => line.length >= 5))];
      return anyLines.slice(0, 3).join('\n');
    }
    // Возвращаем до 5 наиболее длинных строк
    return uniqFiltered.sort((a, b) => b.length - a.length).slice(0, 5).join('\n');
  }
  return result.join('\n');
}

// --- Экранирование HTML для Telegram ---
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Генерация теста по случайному материалу (или просто "Скажи привет")
bot.action("generate_test", async (ctx) => {
  try {
    await streamAIResponse("Скажи привет", ctx);
  } catch (err) {
    logger.error("Ошибка при генерации теста: " + err.message);
    await ctx.reply(ui.error("Ошибка при генерации теста: " + err.message));
  }
});

// Кнопка "Генерация Кэша" — ставит задачу в очередь
bot.action("generate_cache", async (ctx) => {
  cacheQueue.push({ ctx });
  await ctx.answerCbQuery("⏳ Задача поставлена в очередь.");
  await sendProgress(ctx, `Ваша задача на генерацию кэша добавлена в очередь. Позиция: ${cacheQueue.length}`);
  processCacheQueue();
});

// Обработка ошибок при загрузке на Яндекс.Диск
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

// --- УТИЛИТА: Скачивание файла Telegram в temp ---
async function downloadFile(file, userId) {
  const tempPath = path.join(__dirname, 'temp');
  await fs.ensureDir(tempPath);
  const ext = path.extname(file.file_path || '.jpg');
  const fileName = `${userId}_${Date.now()}${ext}`;
  const dest = path.join(tempPath, fileName);
  const fileLink = await bot.telegram.getFileLink(file.file_id);

  const res = await fetch(fileLink.href);
  if (!res.ok) throw new Error(`Ошибка загрузки файла: ${res.statusText}`);
  // Для node >=18 используем arrayBuffer, для node-fetch@2 — buffer
  let buffer;
  if (typeof res.arrayBuffer === 'function') {
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    buffer = await res.buffer();
  }
  await fs.writeFile(dest, buffer);
  return dest;
}

// --- Улучшенная оценка человекочитаемости и полезности OCR-результата ---
function evalHumanReadableScoreV2(text) {
  if (!text || typeof text !== 'string') return 0;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const totalChars = text.length;
  const ruChars = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const ruRatio = ruChars / (totalChars || 1);
  const uniqLines = new Set(lines).size;
  // Ключевые слова и бизнес-термины
  const bonusWords = [
    "АКТИВИРУЙТЕ", "СКАЧАЙТЕ", "ПРИЛОЖЕНИЕ", "МАГАЗИН", "СЕРВИСЫ", "ЭВОТОР",
    "ИНН", "ОГРН", "АДРЕС", "КОНТАКТ", "ТЕЛЕФОН", "EMAIL", "E-MAIL",
    "КЛЮЧ", "ЕГАИС", "ТОРГОВЛИ", "БУХГАЛТЕРИЯ", "ФИО", "ООО", "ИП", "ОАО"
  ];
  let bonus = 0;
  let phoneCount = 0, emailCount = 0, innCount = 0, addressCount = 0;
  const phoneRegex = /\+?\d[\d\s\-()]{7,}/g;
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const innRegex = /\b\d{10,12}\b/;
  const addressRegex = /(г\.|ул\.|просп\.|пер\.|д\.|офис|корпус|кв\.|пл\.|обл\.|район|р-н|поселок|микрорайон)/i;
  // Анализ строк
  lines.forEach(line => {
    if (phoneRegex.test(line)) phoneCount++;
    if (emailRegex.test(line)) emailCount++;
    if (innRegex.test(line)) innCount++;
    if (addressRegex.test(line)) addressCount++;
    for (const w of bonusWords) if (line.toUpperCase().includes(w)) bonus += 0.1;
  });
  // Мусорные строки
  const noisyLines = lines.filter(l => l.length < 5 || (l.replace(/[А-Яа-яЁё0-9]/gi, '').length / l.length) > 0.5).length;
  // Бонус за разнообразие и полезную структуру
  const diversityBonus = uniqLines >= 3 ? 0.5 : 0;
  // Итоговая формула
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
  // Штраф если только одна строка и она короткая
  if (lines.length === 1 && lines[0].length < 10) score -= 0.5;
  return score;
}

// --- Подробный лог выбора результата ---
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

// --- В месте, где отправляется результат ---
function sendBestOcrResult(ctx, bestResult) {
  return ctx.replyWithHTML(
    `<b>📋 Итоговый текст с фото (максимально близко к оригиналу)</b>\n\n<pre>${escapeHTML(bestResult)}</pre>`
  ).then(() => {
    logger.info(`[BOT] Все шаблоны завершены. Итоговая сборка для пользователя завершена.`);
  }).catch(e => {
    logger.error(`[BOT] Ошибка отправки результата пользователю: ${e.message}`);
  });
}

module.exports = {
    app,
    bot,
    mainMenuKeyboard,
    parseDocxToText,
    splitTextByLength,
    saveToCacheAndSync,
    fuzzyFindInYandexDisk
  };
