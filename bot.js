const { Telegraf, Markup, session } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const fuzzysort = require('fuzzysort'); // Добавлено

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
        logger.info(`[BOT] Завершён шаблон ${i+1}: ${tpl.name}`);
      } catch (e) {
        tesseractText = `Ошибка Tesseract: ${e.message}`;
        logger.error(`[BOT] Ошибка шаблона ${i+1}: ${tpl.name}: ${e.message}`);
      }
      allResults.push({ tplName: tpl.name, text: tesseractText });
      try {
        await ctx.replyWithHTML(
          `<b>Шаблон ${i+1}: ${tpl.name}</b>\n\n<b>Tesseract:</b>\n${tesseractText}`
        );
        logger.info(`[BOT] Ответ отправлен по шаблону ${i+1}: ${tpl.name}`);
      } catch (err) {
        logger.error(`[BOT] Ошибка отправки ответа по шаблону ${i+1}: ${tpl.name}: ${err.message}`);
      }
    }
    // --- Новый этап: "семантическая сборка" из всех шаблонов ---
    const semanticResult = semanticOcrAssemble(allResults);
    await ctx.replyWithHTML(
      `<b>🏆 Семантическая сборка OCR (уникальные строки из всех шаблонов)</b>\n\n<pre>${semanticResult}</pre>`
    );
    logger.info(`[BOT] Все шаблоны завершены. Семантическая сборка завершена.`);
  } catch (e) {
    logger.error(`[BOT] Глобальная ошибка в ocr_all_templates: ${e.message}`);
    await ctx.reply('Ошибка при распознавании: ' + e.message);
  }
});

// --- Функция: очистка и выбор лучшего результата OCR ---
function cleanAndSelectBestOcrResult(results) {
  // results: [{ tplName, text }]
  // 1. Фильтруем строки: только кириллица, цифры, базовые знаки препинания, длина строки > 10
  function cleanText(text) {
    return text
      .split(/\n|\r|\f|\v|\u2028|\u2029|\u0085/)
      .map(line => line.replace(/[^а-яА-ЯёЁ0-9a-zA-Z.,:;!?()\-\s]/g, ''))
      .map(line => line.trim())
      .filter(line => line.length > 10 && /[а-яА-ЯёЁ]/.test(line))
      .join('\n');
  }
  // 2. Считаем "осознанные" слова (русские слова длиной > 2)
  function countWords(text) {
    return (text.match(/[а-яА-ЯёЁ]{3,}/g) || []).length;
  }
  // 3. Для каждого результата: чистим, считаем слова
  const processed = results.map(r => {
    const cleaned = cleanText(r.text);
    return {
      tplName: r.tplName,
      cleaned,
      wordCount: countWords(cleaned)
    };
  });
  // 4. Находим результат с максимальным числом "осознанных" слов
  const best = processed.reduce((max, cur) => (cur.wordCount > max.wordCount ? cur : max), processed[0]);
  return best;
}

// --- Новый механизм: "Семантическая сборка" из всех шаблонов OCR ---
function semanticOcrAssemble(results) {
  // results: [{ tplName, text }]
  // 1. Фильтруем и разбиваем на строки
  function cleanLines(text) {
    return text
      .split(/\n|\r|\f|\v|\u2028|\u2029|\u0085/)
      .map(line => line.replace(/[^а-яА-ЯёЁ0-9a-zA-Z.,:;!?()\-\s]/g, ''))
      .map(line => line.trim())
      .filter(line => line.length > 8 && /[а-яА-ЯёЁ]/.test(line));
  }
  // 2. Собираем все строки из всех шаблонов
  let allLines = [];
  results.forEach(r => {
    allLines = allLines.concat(cleanLines(r.text));
  });
  // 3. Считаем частоту каждой строки
  const freq = {};
  allLines.forEach(line => {
    freq[line] = (freq[line] || 0) + 1;
  });
  // 4. Оставляем только уникальные строки, сортируем по частоте (убывание), затем по длине (убывание)
  const uniqueLines = [...new Set(allLines)];
  uniqueLines.sort((a, b) => freq[b] - freq[a] || b.length - a.length);
  // 5. Склеиваем в финальный текст
  return uniqueLines.join('\n');
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

module.exports = {
    app,
    bot,
    mainMenuKeyboard,
    parseDocxToText,
    splitTextByLength,
    saveToCacheAndSync,
    fuzzyFindInYandexDisk
  };
