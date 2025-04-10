const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
require("dotenv").config();
const os = require("os");

// Основные константы
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const finalModelPath = path.join(modelDir, "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf");
const materialsPath = path.join(__dirname, "materials");
const PORT = process.env.PORT || 3000;
const webAppUrl = `http://89.169.131.216:${PORT}`;

// Инициализация бота и Express
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

// Статические файлы
app.use("/static", express.static(path.join(__dirname, "static")));

// Базовые функции работы с файлами
async function parseDocxToText(filePath) {
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "";
    }
}

async function parseDocxToHtml(filePath) {
    try {
        const result = await mammoth.convertToHtml({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "<p>Ошибка при обработке файла.</p>";
    }
}

async function getFilesFromRoot() {
    try {
        const items = await fs.readdir(materialsPath);
        return items.filter((item) => item.endsWith(".docx"));
    } catch (err) {
        console.error("Ошибка при получении списка файлов:", err);
        return [];
    }
}

// Функции работы с AI
let gpt4allModel = null;

async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");
        const model = new gpt4all.LLModel(finalModelPath);

        return {
            generate: async (prompt) => {
                try {
                    return await model.prompt(prompt);
                } catch (error) {
                    console.error("Ошибка при генерации:", error);
                    return null;
                }
            }
        };
    } catch (error) {
        console.error("Ошибка при инициализации GPT4All:", error);
        return null;
    }
}

async function generateAIQuestions(text) {
    try {
        if (!gpt4allModel) {
            gpt4allModel = await initGPT4AllModel();
        }
        if (!gpt4allModel) {
            throw new Error("Модель GPT4All не инициализирована.");
        }
        const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту: ${text}`;
        return await gpt4allModel.generate(prompt);
    } catch (err) {
        console.error("Ошибка при генерации вопросов через AI:", err);
        throw err;
    }
}

// Обработчики команд бота
bot.start(async (ctx) => {
    await ctx.reply(
        "Добро пожаловать! Этот бот поможет вам просматривать материалы.",
        Markup.inlineKeyboard([
            Markup.button.callback("📂 Просмотреть материалы", "open_materials"),
            Markup.button.callback("📝 Сгенерировать тест", "generate_test"),
        ])
    );
});

// Обработка кнопки "Просмотреть материалы"
bot.action("open_materials", async (ctx) => {
    const files = await getFilesFromRoot();

    if (files.length === 0) {
        return ctx.reply("Нет доступных файлов.");
    }

    const buttons = files.map((file) => [
        Markup.button.callback(file, `material:${file}`),
    ]);

    await ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

// Обработка выбора файла
bot.action(/^material:(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        return ctx.reply("Файл не найден.");
    }

    const url = `${webAppUrl}/article/${encodeURIComponent(fileName)}`;

    await ctx.reply(
        `Откройте файл "${fileName}" через Web App:`,
        Markup.inlineKeyboard([
            Markup.button.url("Открыть файл", url),
            Markup.button.callback("🔙 Назад", "open_materials"),
        ])
    );
});

// Обработка кнопки "Сгенерировать тест"
bot.action("generate_test", async (ctx) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation Timeout")), 60000);
    });

    try {
        await ctx.reply(
            "Генерирую тест на основе материалов, пожалуйста, подождите..."
        );

        await Promise.race([
            (async () => {
                const files = await getFilesFromRoot();
                if (files.length === 0) {
                    throw new Error("Нет доступных материалов для генерации теста.");
                }

                const randomFile = files[Math.floor(Math.random() * files.length)];
                const filePath = path.join(materialsPath, randomFile);

                const result = await parseDocxToText(filePath);
                if (!result) {
                    throw new Error("Не удалось прочитать материал для теста.");
                }

                const test = await generateAIQuestions(result);
                await ctx.reply(`Тест создан на основе материала "${randomFile}":\n\n${test}`);
            })(),
            timeoutPromise,
        ]);
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        if (err.message === "Operation Timeout") {
            await ctx.reply("Превышено время ожидания. Попробуйте еще раз.");
        } else {
            await ctx.reply("Произошла ошибка при генерации теста. Пожалуйста, попробуйте позже.");
        }
    }
});

// Запуск сервисов
bot.launch()
    .then(() => console.log("Бот успешно запущен!"))
    .catch((err) => console.error("Ошибка при запуске бота:", err));

app.listen(PORT, () => {
    console.log(`Express-сервер запущен на порту ${PORT}`);
});

