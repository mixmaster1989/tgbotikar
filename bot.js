const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
require("dotenv").config();
const timeout = require('p-timeout');  // Импортируем p-timeout для установки тайм-аутов

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

async function generateAIQuestions(text) {
  const maxInputLength = 700;
  const truncatedText = text.length > maxInputLength ? text.substring(0, maxInputLength) + "..." : text;
  const prompt = `Сформулируй один короткий вопрос с 4 вариантами ответов по тексту ниже. Отметь правильный вариант.\nВОПРОС:\nА)\nБ)\nВ)\nГ)\nПРАВИЛЬНЫЙ:`;
  if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();
  
  // Используем p-timeout для увеличения тайм-аута до 120 секунд
  return await timeout(
    gpt4allModel.generate(`${prompt}\n\n${truncatedText}`),
    120000, // 120 секунд
    new Error('Генерация вопроса превысила время ожидания!')
  );
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

function saveToCache(question, answer) {
  const stmt = db.prepare("INSERT OR REPLACE INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(question, answer);
  stmt.finalize();
}

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

bot.action("materials", async (ctx) => {
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Файлы не найдены.");
  const buttons = files.map((f) => [Markup.button.callback(f, `open_${f}`)]);
  buttons.push([Markup.button.callback("🔄 Резет", "reset")]);
  await ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

bot.action(/open_(.+)/, async (ctx) => {
  const fileName = ctx.match[1];
  const fullPath = path.join(materialsPath, fileName);
  const pdfFile = `${fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.pdf`;
  const pdfPath = path.join(__dirname, 'static', 'previews', pdfFile);
  try {
    await convertDocxToPdf(fullPath, pdfPath);
    await ctx.replyWithDocument({ source: pdfPath, filename: fileName.replace(/\.[^.]+$/, '') + '.pdf' });
  } catch (err) {
    console.error('Ошибка при конвертации DOCX в PDF:', err);
    await ctx.reply('❌ Не удалось сконвертировать файл.');
  }
});

bot.action("generate_test", async (ctx) => {
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Нет материалов для генерации.");
  const random = files[Math.floor(Math.random() * files.length)];
  const filePath = path.join(materialsPath, random);
  await ctx.reply(`📚 Используется материал: ${random}`);
  
  // Логируем время начала обработки
  console.log("Начало генерации теста:", new Date());
  
  const content = await parseDocxToText(filePath);
  let test;
  try {
    test = await generateAIQuestions(content);
  } catch (err) {
    console.error("Ошибка генерации вопроса:", err);
    return ctx.reply("❌ Не удалось сгенерировать вопрос.");
  }

  // Логируем время завершения обработки
  console.log("Генерация теста завершена:", new Date());

  const parsed = parseTestResponse(test);

  let message = `❓ <b>${parsed.question}</b>\n`;
  for (const key in parsed.answers) {
    message += `\n${key}) ${parsed.answers[key]}`;
  }
  message += `\n\n✅ Правильный ответ: ${parsed.correct}`;
  await ctx.replyWithHTML(message);
  await ctx.reply("Выберите действие:", mainMenuKeyboard());
});

bot.action("generate_cache", async (ctx) => {
  const files = await yadisk.syncMaterials();
  if (!files.length) return ctx.reply("Нет файлов для кэша.");
  const random = files[Math.floor(Math.random() * files.length)];
  const filePath = path.join(materialsPath, random);
  const content = await parseDocxToText(filePath);
  const questionResponse = await generateAIQuestions(content);
  const parsed = parseTestResponse(questionResponse);
  saveToCache(parsed.question, parsed.correct);

  const jsonFilePath = path.join(cachePath, `${random.replace(".docx", "")}.json`);
  const jsonData = { question: parsed.question, answers: parsed.answers, correct: parsed.correct };
  fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2));
  await yadisk.uploadFile(jsonFilePath, `/cache/${path.basename(jsonFilePath)}`);

  await ctx.reply("✅ Кэш сгенерирован и сохранён на Я.Диске.");
  await ctx.reply("Выберите действие:", mainMenuKeyboard());
});

bot.action("settings", async (ctx) => {
  ctx.reply("⚙️ Настройки:", Markup.inlineKeyboard([
    [Markup.button.callback("🔁 Синхронизация", "sync_disk")],
    [Markup.button.callback("🔍 Проверка модели", "check_model")],
    [Markup.button.callback("⬅️ Назад", "reset")],
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

(async () => {
  app.listen(PORT, () => console.log(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  console.log("🤖 Бот запущен!");
})();
