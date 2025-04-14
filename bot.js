// bot.js — Полный ребилд с инлайн-меню

// === Зависимости ===
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
const yadisk = new YaDiskService(process.env.YANDEX_DISK_TOKEN);

// === Константы ===
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");

// === Инициализация ===
const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));

const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) console.error("DB Error:", err);
  else initDatabase();
});

function initDatabase() {
  db.run(
    `CREATE TABLE IF NOT EXISTS gpt_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT UNIQUE,
      response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

let gpt4allModel = null;
async function initGPT4AllModel() {
  const model = await gpt4all.loadModel(modelName);
  return {
    generate: async (prompt) => (await model.generate(prompt)).text,
  };
}

async function parseDocxToText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

async function generateAIQuestions(text) {
  const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту.
Формат:
ВОПРОС: [текст]
А) [...]
Б) [...]
В) [...]
Г) [...]
ПРАВИЛЬНЫЙ: [буква]\n\nТекст: ${text}`;

  if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
  return await gpt4allModel.generate(prompt);
}

function parseTestResponse(response) {
  const lines = response.split("\n");
  return {
    question: lines[0].replace("ВОПРОС:", "").trim(),
    answers: {
      А: lines[1].slice(3).trim(),
      Б: lines[2].slice(3).trim(),
      В: lines[3].slice(3).trim(),
      Г: lines[4].slice(3).trim(),
    },
    correct: lines[5].replace("ПРАВИЛЬНЫЙ:", "").trim(),
  };
}

// === Меню и Обработчики ===
bot.start(async (ctx) => {
  return ctx.reply("Добро пожаловать! Выберите раздел:", Markup.inlineKeyboard([
    [Markup.button.callback("📂 Материалы", "materials")],
    [Markup.button.callback("📝 Генерация Теста", "generate_test")],
    [Markup.button.callback("📊 Кэш", "cache_ops")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
  ]));
});

bot.action("materials", async (ctx) => {
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Файлы не найдены.");

  const buttons = files.map((f) => [Markup.button.callback(f, `open_${f}`)]);
  await ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

bot.action(/open_(.+)/, async (ctx) => {
  const fileName = ctx.match[1];
  const fullPath = path.join(materialsPath, fileName);
  const content = await parseDocxToText(fullPath);
  ctx.replyWithHTML(`<b>Содержимое:</b>\n\n${content.substring(0, 1500)}...`);
});

bot.action("generate_test", async (ctx) => {
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Нет материалов.");
  const random = files[Math.floor(Math.random() * files.length)];
  const filePath = path.join(materialsPath, random);
  const content = await parseDocxToText(filePath);
  const test = await generateAIQuestions(content);
  const parsed = parseTestResponse(test);
  let message = `❓ <b>${parsed.question}</b>\n`;
  for (const key in parsed.answers) {
    message += `\n${key}) ${parsed.answers[key]}`;
  }
  message += `\n\n✅ Правильный ответ: ${parsed.correct}`;
  ctx.replyWithHTML(message);
});

bot.action("cache_ops", async (ctx) => {
  ctx.reply("📊 Кэш:", Markup.inlineKeyboard([
    [Markup.button.callback("Очистить кэш", "clear_cache")],
    [Markup.button.callback("Назад", "start")],
  ]));
});

bot.action("clear_cache", async (ctx) => {
  db.run("DELETE FROM gpt_cache", () => ctx.reply("🧹 Кэш очищен"));
});

bot.action("settings", async (ctx) => {
  ctx.reply("⚙️ Настройки:", Markup.inlineKeyboard([
    [Markup.button.callback("🔁 Синхронизация", "sync_disk")],
    [Markup.button.callback("🔍 Проверка модели", "check_model")],
    [Markup.button.callback("⬅️ Назад", "start")],
  ]));
});

bot.action("sync_disk", async (ctx) => {
  const files = await yadisk.syncMaterials();
  ctx.reply(`✅ Синхронизация завершена: ${files.length} файлов`);
});

bot.action("check_model", async (ctx) => {
  if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
  ctx.reply("✅ Модель загружена и готова к работе.");
});

// === Запуск ===
(async () => {
  app.listen(PORT, () => console.log(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  console.log("🤖 Бот запущен!");
})();