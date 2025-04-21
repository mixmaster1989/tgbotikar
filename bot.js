const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
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
        maxTokens: 192,
        temp: 0.65,
        topK: 30,
        topP: 0.35,
        repeatPenalty: 1.2,
        batchSize: 1,
      };
      return (await model.generate(prompt, options)).text;
    },
  };
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

const userStates = {};

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
  await ctx.reply("Введите ваш вопрос для ИИ:");
});

// Обработка текстового сообщения как вопроса для ИИ, если пользователь в нужном состоянии
bot.on("text", async (ctx) => {
  if (userStates[ctx.from.id] === "awaiting_ai_prompt") {
    userStates[ctx.from.id] = null;
    try {
      if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
      const result = await gpt4allModel.generate(ctx.message.text);
      await ctx.reply(result, mainMenuKeyboard());
    } catch (error) {
      await ctx.reply("❌ Ошибка генерации: " + error.message, mainMenuKeyboard());
    }
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

// Генерация кэша и датасета
bot.action("generate_cache", async (ctx) => {
  await ctx.answerCbQuery("⏳ Генерация началась..."); // Быстрый ответ на callback (избегаем таймаута)
  logAndNotify("🛠️ Генерация кэша и датасета запущена, подождите...", ctx);

  setTimeout(async () => {
    try {
      const files = await yadisk.syncMaterials();
      if (!files.length) {
        logAndNotify("Нет файлов для кэша.", ctx);
        return;
      }

      const random = files[Math.floor(Math.random() * files.length)];
      const filePath = path.join(materialsPath, random);
      logAndNotify(`Используется файл: ${random}`, ctx);
      const content = await parseDocxToText(filePath);
      const questionResponse = await generateAIQuestions(content);
      const parsed = parseTestResponse(questionResponse);

      saveToCache(parsed.question, JSON.stringify(parsed.answers));

      const datasetFilePath = path.join(cachePath, "dataset.json");
      let dataset = [];
      if (fs.existsSync(datasetFilePath)) {
        const existingData = fs.readFileSync(datasetFilePath, 'utf8');
        dataset = JSON.parse(existingData);
      }
      dataset.push({
        question: parsed.question,
        answers: parsed.answers,
        correct: parsed.correct,
      });
      fs.writeFileSync(datasetFilePath, JSON.stringify(dataset, null, 2));

      try {
        await uploadToYandexDisk(datasetFilePath, `/bot_cache/${path.basename(datasetFilePath)}`, ctx);
      } catch (error) {
        logAndNotify(`Ошибка загрузки на Я.Диск: ${error.message}`, ctx);
      }

      logAndNotify("✅ Кэш и датасет обновлены.", ctx);
    } catch (err) {
      logAndNotify(`Ошибка в генерации кэша: ${err.message}`, ctx);
      await ctx.reply("❌ Ошибка при генерации.");
    }

    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  }, 100); // Задержка в 100 мс, чтобы избежать телегиных ограничений
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
