// --- Зависимости ---
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
require("dotenv").config();
const os = require("os");
const sqlite3 = require("sqlite3").verbose();
const { spawn } = require('child_process');
const YaDiskService = require('./services/yadisk_service');
const { convertDocxToPdf } = require('./modules/docx2pdf');
const pTimeout = require('p-timeout');

// --- Константы и пути ---
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const finalModelPath = path.join(modelDir, modelName);
const materialsPath = path.join(__dirname, "materials");
const PORT = process.env.PORT || 3000;
const webAppUrl = `http://89.232.176.215:${PORT}`;

// --- Инициализация сервисов ---
const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 300000 });
const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));
const yadisk = new YaDiskService(process.env.YANDEX_DISK_TOKEN);

// --- Глобальные переменные ---
let gpt4allModel = null;

// --- Логирование ошибок ---
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('Uncaught Exception:', error));

// --- Вспомогательные функции ---
function trimText(text, maxLen = 1000) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen);
}

async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All...");
        const model = await gpt4all.loadModel(modelName);
        console.log("✅ Модель GPT4All инициализирована.");
        return {
            generate: async (prompt) => {
                try {
                    console.log("📤 Запрос к модели:", prompt.slice(0, 100) + "...");
                    const answer = await model.generate(prompt);
                    console.log("📥 Ответ от модели получен.");
                    return answer.text || answer;
                } catch (error) {
                    console.error("Ошибка генерации:", error);
                    throw error;
                }
            }
        };
    } catch (error) {
        console.error("Ошибка инициализации GPT4All:", error);
        return null;
    }
}

async function parseDocxToText(filePath) {
    try {
        console.log(`Извлечение текста из файла: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        console.log(`Текст успешно извлечен (длина: ${result.value.length})`);
        return result.value;
    } catch (err) {
        console.error("Ошибка извлечения текста:", err);
        throw err;
    }
}

// --- Генерация вопросов через AI ---
async function generateAIQuestions(text) {
    try {
        if (!gpt4allModel) {
            gpt4allModel = await initGPT4AllModel();
        }
        if (!gpt4allModel) throw new Error("Модель GPT4All не инициализирована.");

        const trimmedText = trimText(text, 700); // Меньше текста — быстрее ответ
        const prompt = `Сделай один вопрос с 4 вариантами ответа по тексту: ${trimmedText}`;
        return await gpt4allModel.generate(prompt);
    } catch (err) {
        console.error("Ошибка генерации вопросов:", err);
        throw err;
    }
}

// --- Парсинг ответа модели ---
function parseTestResponse(response) {
    // Ожидается формат: Вопрос\nA) ...\nB) ...\nC) ...\nD) ...\nОтвет: X
    const lines = response.split('\n').filter(Boolean);
    const question = lines[0] || "";
    const answers = {};
    let correct = "";
    lines.slice(1).forEach(line => {
        const match = line.match(/^([A-D])\)\s*(.+)$/);
        if (match) answers[match[1]] = match[2];
        if (/Ответ[:\-]?\s*([A-D])/i.test(line)) correct = RegExp.$1;
    });
    return { question, answers, correct };
}

// --- Основное меню ---
const mainMenuKeyboard = Markup.keyboard([
    ['📚 Кэш', '🤖 Генерация'],
    ['📊 Статистика', '⚙️ Настройки']
]).resize().oneTime(false);

// --- Обработчик кнопки "Материалы" ---
bot.action("materials", async (ctx) => {
    try {
        console.log("Обработчик 'Материалы' вызван.");
        await ctx.answerCbQuery("📂 Загрузка материалов...");
        const files = await fs.readdir(materialsPath);
        console.log("Список файлов:", files);
        if (!files.length) return ctx.reply("❌ Нет доступных материалов.");
        const fileButtons = files.map((file) => Markup.button.callback(file, `file_${file}`));
        await ctx.reply("📂 Доступные материалы:", Markup.inlineKeyboard(fileButtons, { columns: 1 }));
    } catch (error) {
        console.error("Ошибка в обработчике 'Материалы':", error);
        await ctx.reply("❌ Произошла ошибка при загрузке материалов.");
    }
});

// --- Обработчик отправки PDF ---
bot.action(/^file_(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    const fullPath = path.join(materialsPath, fileName);
    const pdfFile = `${fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.pdf`;
    const pdfPath = path.join(__dirname, 'static', 'previews', pdfFile);
    try {
        console.log(`Конвертация ${fileName} в PDF...`);
        await convertDocxToPdf(fullPath, pdfPath);
        console.log(`PDF готов: ${pdfPath}`);
        await ctx.replyWithDocument(
            { source: pdfPath, filename: `${fileName.replace(/\.[^.]+$/, '')}.pdf`, contentType: 'application/pdf' },
            { caption: `📄 ${fileName.replace(/\.[^.]+$/, '')}` }
        );
    } catch (err) {
        console.error('Ошибка при конвертации DOCX в PDF:', err);
        await ctx.reply('❌ Не удалось сконвертировать файл.');
    }
});

// --- Обработчик генерации теста с прогресс-баром и логами ---
bot.action("generate_test", async (ctx) => {
    try {
        const startTime = Date.now();
        console.log("Генерация теста запущена пользователем:", ctx.from.username || ctx.from.id);

        const files = await fs.readdir(materialsPath);
        if (!files.length) return ctx.reply("Нет доступных материалов для генерации теста.");

        const random = files[Math.floor(Math.random() * files.length)];
        const filePath = path.join(materialsPath, random);
        await ctx.reply(`📚 Используется: ${random}`);

        const progressMessage = await ctx.reply("⏳ Генерация теста началась...\n[                    ] 0%");
        const statuses = [
            "📖 Извлечение текста...",
            "🤖 Генерация вопроса...",
            "📝 Форматирование...",
            "📦 Завершение..."
        ];
        const totalSteps = statuses.length;
        const totalTime = 40; // Сокращаем до 40 сек для UX
        const updateInterval = totalTime / totalSteps;

        for (let i = 0; i < totalSteps; i++) {
            await new Promise((resolve) => setTimeout(resolve, updateInterval * 1000));
            const progress = Math.round(((i + 1) / totalSteps) * 100);
            const progressBar = `[${"=".repeat(progress / 5)}${" ".repeat(20 - progress / 5)}] ${progress}%`;
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                progressMessage.message_id,
                null,
                `${statuses[i]}\n${progressBar}`
            );
            console.log(`Шаг ${i + 1}/${totalSteps}: ${statuses[i]}`);
        }

        // Извлекаем текст
        const content = await pTimeout(parseDocxToText(filePath), 120000, "Извлечение текста заняло слишком много времени");

        // Генерируем тест
        const test = await pTimeout(generateAIQuestions(content), 120000, "Генерация вопросов заняла слишком много времени");
        const parsed = parseTestResponse(test);

        // Формируем сообщение с вопросом
        let message = `❓ <b>${parsed.question}</b>\n`;
        for (const key in parsed.answers) {
            message += `\n${key}) ${parsed.answers[key]}`;
        }
        message += `\n\n✅ Правильный ответ: ${parsed.correct}`;

        await ctx.replyWithHTML(message);

        const endTime = Date.now();
        const executionTime = ((endTime - startTime) / 1000).toFixed(2);
        await ctx.reply(`⏱️ Генерация теста завершена за ${executionTime} секунд.`);
        await ctx.reply("Выберите действие:", mainMenuKeyboard);
        console.log(`Генерация теста завершена за ${executionTime} секунд.`);
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        await ctx.reply(`❌ Произошла ошибка: ${err.message}`);
    }
});

// --- Запуск приложения ---
(async () => {
    try {
        await bot.launch();
        app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
        console.log("Бот успешно запущен!");
    } catch (error) {
        console.error("❌ Критическая ошибка:", error);
        process.exit(1);
    }
})();