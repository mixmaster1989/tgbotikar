// Обновлённый bot.js с восстановленной функцией "Генерация кэша"

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
const datasetPath = path.join(__dirname, "dataset.json");

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));

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
        batchSize: 6,
      };
      return (await model.generate(prompt, options)).text;
    },
  };
}

async function parseDocxToText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

async function saveToDataset(question, answer) {
  const data = fs.existsSync(datasetPath)
    ? JSON.parse(await fs.readFile(datasetPath, "utf8"))
    : [];
  data.push({ question, answer });
  await fs.writeFile(datasetPath, JSON.stringify(data, null, 2), "utf8");
  await yadisk.uploadFile(datasetPath, "dataset.json");
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📂 Материалы", "materials")],
    [Markup.button.callback("📝 Генерация Теста", "generate_test")],
    [Markup.button.callback("🧠 Генерация Кэша", "generate_cache")],
    [Markup.button.callback("📊 Кэш", "cache_ops")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
    [Markup.button.callback("🔄 Резет", "reset")],
  ]);
}

bot.start((ctx) => ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard()));

bot.action("generate_cache", async (ctx) => {
  await ctx.reply("⚙️ Генерация кэша запущена. Пожалуйста, подождите...");
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Нет материалов.");

  const file = files[Math.floor(Math.random() * files.length)];
  const filePath = path.join(materialsPath, file);
  const content = await parseDocxToText(filePath);

  if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();

  const questionPrompt = `Сформулируй один короткий вопрос по тексту:
\n\n${content.substring(0, 700)}...`;
  const question = await gpt4allModel.generate(questionPrompt);

  const answerPrompt = `Ответь кратко на вопрос: ${question}`;
  const answer = await gpt4allModel.generate(answerPrompt);

  db.run(
    `INSERT OR IGNORE INTO gpt_cache (prompt, response) VALUES (?, ?)`,
    [question, answer],
    (err) => {
      if (err) console.error("Ошибка записи в кэш:", err);
    }
  );

  await saveToDataset(question, answer);
  await ctx.replyWithHTML(`✅ Добавлено в кэш и датасет:
<b>Вопрос:</b> ${question}
<b>Ответ:</b> ${answer}`);
  await ctx.reply("Выберите действие:", mainMenuKeyboard());
});

// Остальной код прежний — материалы, тесты, PDF, кэш, настройки и запуск...

(async () => {
  app.listen(PORT, () => console.log(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  console.log("🤖 Бот запущен!");
})();
