// bot.js — Исправленный вариант с инлайн-меню без синтаксических ошибок

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

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");

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
                maxTokens: 256,
                temp: 0.7,
                topK: 40,
                topP: 0.4,
                repeatPenalty: 1.18,
                batchSize: 8
            };
            return (await model.generate(prompt, options)).text;
        }
    };
}

async function parseDocxToText(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
}

function mainMenuKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback("\uD83D\uDCC2 Материалы", "materials")],
        [Markup.button.callback("\uD83D\uDCDD Генерация Теста", "generate_test")],
        [Markup.button.callback("\uD83D\uDCCA Кэш", "cache_ops")],
        [Markup.button.callback("\u2699\uFE0F Настройки", "settings")],
        [Markup.button.callback("\uD83D\uDD04 Резет", "reset")]
    ]);
}

bot.start(async (ctx) => {
    return ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard());
});

bot.action("reset", async (ctx) => {
    await ctx.reply("История сброшена. Выберите раздел:", mainMenuKeyboard());
});

bot.action("materials", async (ctx) => {
    const files = await yadisk.syncMaterials();
    if (!files.length) return ctx.reply("Файлы не найдены.");

    const buttons = files.map((f) => [Markup.button.callback(f, `open_${f}`)]);
    buttons.push([Markup.button.callback('\uD83D\uDD04 Резет', 'reset')]);
    await ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

bot.action("cache_ops", async (ctx) => {
    ctx.reply("\uD83D\uDCCA Кэш:", Markup.inlineKeyboard([
        [Markup.button.callback("Очистить кэш", "clear_cache")],
        [Markup.button.callback("Назад", "start")],
        [Markup.button.callback("\uD83D\uDD04 Резет", "reset")]
    ]));
});

bot.action("settings", async (ctx) => {
    ctx.reply("\u2699\uFE0F Настройки:", Markup.inlineKeyboard([
        [Markup.button.callback("\uD83D\uDD01 Синхронизация", "sync_disk")],
        [Markup.button.callback("\uD83D\uDD0D Проверка модели", "check_model")],
        [Markup.button.callback("\u2B05\uFE0F Назад", "start")],
        [Markup.button.callback("\uD83D\uDD04 Резет", "reset")]
    ]));
});

bot.action("clear_cache", async (ctx) => {
    db.run("DELETE FROM gpt_cache", () => ctx.reply("\uD83E\uDEC3 Кэш очищен"));
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
