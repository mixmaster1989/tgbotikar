const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const fuzzysort = require('fuzzysort'); // Добавлено
require("dotenv").config();

const YaDiskService = require("./services/yadisk_service");
const { convertDocxToPdf } = require("./modules/docx2pdf");

const yadisk = new YaDiskService(process.env.YANDEX_DISK_TOKEN);

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
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));

// Убедитесь, что папка cache существует
fs.ensureDirSync(cachePath);

// Улучшенная обработка ошибок при инициализации базы данных
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    console.error("DB Error:", err.message);
    process.exit(1); // Завершаем процесс, если база данных не инициализируется
  } else {
    try {
      initDatabase();
    } catch (error) {
      console.error("Ошибка при инициализации базы данных:", error.message);
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

// История генераций для каждого файла
function saveToCacheHistory(file, summary) {
  const stmt = db.prepare("INSERT INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(file, summary);
  stmt.finalize();
}

// Получить все вопросы из кэша
function getAllCacheQuestions(callback) {
  db.all("SELECT prompt, response FROM gpt_cache", (err, rows) => {
    if (err) return callback(err, []);
    callback(null, rows);
  });
}

// Fuzzy поиск по кэшу
function fuzzyFindInCache(question, callback) {
  getAllCacheQuestions((err, rows) => {
    if (err) return callback(err, null);
    const results = fuzzysort.go(question, rows, { key: 'prompt', threshold: -1000 });
    if (results.length > 0 && results[0].score > -1000) {
      callback(null, results[0].obj.response);
    } else {
      callback(null, null);
    }
  });
}

// Fuzzy поиск по кэшу на Яндекс.Диске
async function fuzzyFindInYandexDisk(question) {
  try {
    // Скачиваем файл кэша с Я.Диска (например, cache/dataset.json)
    const remotePath = "/bot_cache/dataset.json";
    const localPath = path.join(cachePath, "dataset.json");
    await yadisk.downloadFile(remotePath, localPath);

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
    console.error(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    notifyAdmin(`[YADISK CACHE] Ошибка поиска: ${err.message}`);
    return null;
  }
}

// Логирование ошибок и отчётов для администратора (через ADMIN_ID)
const ADMIN_ID = process.env.ADMIN_ID;
function notifyAdmin(message) {
  if (ADMIN_ID) bot.telegram.sendMessage(ADMIN_ID, `[ADMIN LOG]\n${message}`);
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
    await sendProgress(ctx, "🛠️ Генерация кэша: синхронизация материалов...");
    const files = await yadisk.syncMaterials();
    if (!files.length) {
      await sendProgress(ctx, "Нет файлов для кэша.");
      isCacheProcessing = false;
      return;
    }

    const random = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(materialsPath, random);
    await sendProgress(ctx, `📄 Используется файл: ${random}\nПарсинг...`);
    const content = await parseDocxToText(filePath);

    // Разбиваем материал на части
    const parts = splitTextByLength(content, 700);
    let allSummaries = [];
    for (let idx = 0; idx < parts.length; idx++) {
      await sendProgress(ctx, `🤖 Генерация тезисов по части ${idx + 1} из ${parts.length}...`);
      const prompt = `Ты профессиональный специалист по контрольно-кассовой технике, 1С и автоматизации бизнеса. 
Изучи материал ниже и выдели только те тезисы, которые будут полезны специалисту в этой области. Не перечисляй общеизвестные основы и базовые факты. Упоминай только новые, сложные или малоизвестные детали, которые могут быть интересны профессионалу. Каждый тезис — с новой строки.

${parts[idx]}`;
      if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
      const summary = await gpt4allModel.generate(prompt);
      allSummaries.push(summary);
    }
    const finalSummary = allSummaries.join("\n---\n");

    // Сохраняем историю генераций (каждый запуск — новая запись)
    saveToCacheHistory(random, finalSummary);

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

    await sendProgress(ctx, "✅ Краткое изложение сохранено в кэш.");
    notifyAdmin(`Кэш сгенерирован для файла: ${random}`);

  } catch (err) {
    await sendProgress(ctx, "❌ Ошибка при генерации: " + err.message);
    notifyAdmin(`Ошибка генерации кэша: ${err.message}`);
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
    await ctx.reply("❌ Ошибка генерации: " + error.message);
  }
}

// Обработка ошибок при работе с файлами
async function parseDocxToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (error) {
    console.error(`Ошибка при обработке файла ${filePath}:`, error.message);
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
    console.error("Ошибка при генерации вопросов:", error.message);
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

function saveToCache(question, response) {
  const stmt = db.prepare("INSERT OR REPLACE INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(question, response);
  stmt.finalize();
}

// Логирование в консоль и в бот
function logAndNotify(message, ctx = null) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  console.log(logMessage); // Логируем в консоль
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
    await ctx.reply("⏳ Конвертация DOCX в PDF...");
    await convertDocxToPdf(docxPath, pdfPath);

    await ctx.replyWithDocument({ source: pdfPath, filename: pdfName });
    // Telegram автоматически покажет предпросмотр первой страницы PDF
  } catch (err) {
    await ctx.reply("Ошибка при конвертации или отправке PDF: " + err.message);
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

    console.log(`[${new Date().toISOString()}] [AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);
    notifyAdmin(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);

    // 1. Fuzzy поиск в локальном кэше
    getAllCacheQuestions((err, rows) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] [CACHE] Ошибка получения кэша: ${err.message}`);
        notifyAdmin(`[CACHE] Ошибка получения кэша: ${err.message}`);
        ctx.reply("❌ Ошибка поиска в кэше.");
        return;
      }
      console.log(`[${new Date().toISOString()}] [CACHE] В кэше ${rows.length} записей. Начинаем fuzzy поиск...`);
      notifyAdmin(`[CACHE] В кэше ${rows.length} записей. Начинаем fuzzy поиск...`);

      const results = fuzzysort.go(ctx.message.text, rows, { key: 'prompt', threshold: -1000 });
      if (results.length > 0) {
        console.log(`[${new Date().toISOString()}] [CACHE] Лучший результат: "${results[0].obj.prompt}" (score: ${results[0].score})`);
        notifyAdmin(`[CACHE] Лучший результат: "${results[0].obj.prompt}" (score: ${results[0].score})`);
      } else {
        console.log(`[${new Date().toISOString()}] [CACHE] Совпадений не найдено.`);
        notifyAdmin(`[CACHE] Совпадений не найдено.`);
      }

      if (results.length > 0 && results[0].score > -1000) {
        ctx.reply("🔎 Ответ из кэша (поиск по похожести):\n" + results[0].obj.response);
        console.log(`[${new Date().toISOString()}] [CACHE] Ответ отправлен из кэша.`);
        notifyAdmin(`[CACHE] Ответ отправлен из кэша.`);
        return;
      }

      // 2. Fuzzy поиск на Яндекс.Диске
      (async () => {
        ctx.reply("⏳ Поиск ответа на Яндекс.Диске...");
        const yadiskAnswer = await fuzzyFindInYandexDisk(ctx.message.text);
        if (yadiskAnswer) {
          ctx.reply("🔎 Ответ из кэша на Яндекс.Диске:\n" + yadiskAnswer);
          console.log(`[${new Date().toISOString()}] [YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          notifyAdmin(`[YADISK CACHE] Ответ отправлен из кэша на Я.Диске.`);
          return;
        }

        // 3. Если нет ни в одном кэше — спрашиваем модель
        try {
          console.log(`[${new Date().toISOString()}] [AI] Ответа в кэше нет, обращаемся к модели...`);
          notifyAdmin(`[AI] Ответа в кэше нет, обращаемся к модели...`);
          if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();

          const contextWindow = 10;
          const context = userContexts[userId].slice(-contextWindow);
          const prompt = context.map(m => (m.role === "user" ? `Пользователь: ${m.content}` : `ИИ: ${m.content}`)).join('\n') + "\nИИ:";

          const result = await gpt4allModel.generate(prompt);
          userContexts[userId].push({ role: "assistant", content: result });

          saveToCacheHistory(ctx.message.text, result);

          ctx.reply(result || "Пустой ответ от модели.");
          console.log(`[${new Date().toISOString()}] [AI] Ответ модели отправлен и сохранён в кэш.`);
          notifyAdmin(`[AI] Ответ модели отправлен и сохранён в кэш.`);
        } catch (error) {
          ctx.reply("❌ Ошибка генерации: " + error.message);
          console.error(`[${new Date().toISOString()}] [AI] Ошибка генерации: ${error.message}`);
          notifyAdmin(`[AI] Ошибка генерации: ${error.message}`);
        }
      })();
    });
  }
});

// Генерация теста по случайному материалу (или просто "Скажи привет")
bot.action("generate_test", async (ctx) => {
  try {
    await streamAIResponse("Скажи привет", ctx);
  } catch (err) {
    await ctx.reply("Ошибка при генерации теста: " + err.message);
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
    console.error(`Ошибка загрузки файла на Я.Диск (${localFilePath}):`, error.message);
    logAndNotify(`Ошибка загрузки на Я.Диск: ${error.message}`, ctx);
    throw new Error("Не удалось загрузить файл на Яндекс.Диск.");
  }
}

(async () => {
  app.listen(PORT, () => console.log(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  console.log("🤖 Бот запущен!");
})();
