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

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));

// Создание базы данных SQLite
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) console.error("DB Error:", err);
  else initDatabase();
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

async function parseDocxToText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

async function generateAIQuestions(text) {
  const maxInputLength = 700;
  const truncatedText = text.length > maxInputLength ? text.substring(0, maxInputLength) + "..." : text;
  const prompt = `Сформулируй один короткий вопрос с 4 вариантами ответов по тексту ниже. Отметь правильный вариант.\nВОПРОС:\nА)\nБ)\nВ)\nГ)\nПРАВИЛЬНЫЙ:`;
  if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
  
  return await gpt4allModel.generate(`${prompt}\n\n${truncatedText}`);
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
    [Markup.button.callback("📝 Генерация Теста", "generate_test")],
    [Markup.button.callback("📊 Генерация Кэша", "generate_cache")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
    [Markup.button.callback("🔄 Резет", "reset")],
  ]);
}

bot.start((ctx) => ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard()));
bot.action("reset", async (ctx) => ctx.reply("История сброшена.", mainMenuKeyboard()));

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
        await yadisk.uploadFile(datasetFilePath, `/bot_cache/${path.basename(datasetFilePath)}`);
        logAndNotify(`Файл загружен на Я.Диск: /bot_cache/${path.basename(datasetFilePath)}`, ctx);
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

(async () => {
  app.listen(PORT, () => console.log(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  console.log("🤖 Бот запущен!");
})();
