// Основные зависимости
const { Telegraf, Markup } = require("telegraf"); // Telegraf для работы с Telegram API
const express = require("express"); // Express для веб-сервера
const path = require("path"); // Работа с путями
const fs = require("fs-extra"); // Расширенная работа с файлами
const mammoth = require("mammoth"); // Конвертация DOCX файлов
const gpt4all = require("gpt4all"); // Локальная AI модель для генерации текста
require("dotenv").config(); // Загрузка переменных окружения
const os = require("os"); // Работа с системными путями

// Основные константы и пути
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all"); // Директория с AI моделью
const finalModelPath = path.join(modelDir, modelName); // Путь к файлу модели. Возможно не нужен.
const materialsPath = path.join(__dirname, "materials"); // Путь к папке с материалами
const PORT = process.env.PORT || 3000; // Порт для веб-сервера
const webAppUrl = `http://89.169.131.216:${PORT}`; // URL веб-приложения

// Инициализация основных сервисов
const bot = new Telegraf(process.env.BOT_TOKEN, {
    handlerTimeout: 300000 // увеличиваем до 5 минут
}); // Создание экземпляра бота
const app = express(); // Создание Express приложения

// Настройка статических файлов для веб-сервера
app.use("/static", express.static(path.join(__dirname, "static")));

/**
 * Извлекает текст из DOCX файла
 * @param {string} filePath - путь к DOCX файлу
 * @returns {Promise<string>} текст из файла
 */
async function parseDocxToText(filePath) {
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "";
    }
}

/**
 * Конвертирует DOCX в HTML
 * @param {string} filePath - путь к DOCX файлу
 * @returns {Promise<string>} HTML разметка
 */
async function parseDocxToHtml(filePath) {
    try {
        const result = await mammoth.convertToHtml({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "<p>Ошибка при обработке файла.</p>";
    }
}

/**
 * Получает список всех DOCX файлов из папки материалов
 * @returns {Promise<string[]>} массив имен файлов
 */
async function getFilesFromRoot() {
    try {
        const items = await fs.readdir(materialsPath);
        return items.filter((item) => item.endsWith(".docx"));
    } catch (err) {
        console.error("Ошибка при получении списка файлов:", err);
        return [];
    }
}

// Глобальная переменная для хранения инициализированной модели
let gpt4allModel = null;

/**
 * Инициализирует модель GPT4All
 * @returns {Promise<Object|null>} объект модели с методом generate или null при ошибке
 */
async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");
        // в loadModel надо пихать название модели а не путь, пути он сам строит
        const model = await gpt4all.loadModel(modelName);

        // Возвращаем обертку с методом generate для удобства использования
        return {
            generate: async (prompt) => {
                try {
                    const answer = await model.generate(prompt);
                    return answer.text;
                } catch (error) {
                    console.error("Ошибка при генерации:", error);
                    return null;
                }
            },
        };
    } catch (error) {
        console.error("Ошибка при инициализации GPT4All:", error);
        return null;
    }
}

/**
 * Генерирует вопросы на основе текста используя AI
 * @param {string} text - исходный текст
 * @returns {Promise<string>} сгенерированные вопросы
 */
async function generateAIQuestions(text) {
    try {
        // Инициализируем модель если еще не инициализирована
        if (!gpt4allModel) {
            gpt4allModel = await initGPT4AllModel();
        }
        if (!gpt4allModel) {
            throw new Error("Модель GPT4All не инициализирована.");
        }

        // Формируем промпт и генерируем вопросы
        const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту: ${text}`;
        return await gpt4allModel.generate(prompt);
    } catch (err) {
        console.error("Ошибка при генерации вопросов через AI:", err);
        throw err;
    }
}

// Обработчики команд бота

// Команда /start - точка входа для пользователя
bot.start(async (ctx) => {
    await ctx.reply(
        "Добро пожаловать! Этот бот поможет вам просматривать материалы.",
        Markup.inlineKeyboard([
            Markup.button.callback("📂 Просмотреть материалы", "open_materials"),
            Markup.button.callback("📝 Сгенерировать тест", "generate_test"),
        ])
    );
});

// Обработка кнопки "Просмотреть материалы" - показывает список доступных файлов
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

// Обработка выбора конкретного файла - показывает ссылку на веб-просмотр
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
    // Увеличиваем таймаут до 5 минут
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation Timeout")), 300000); // 5 минут
    });

    try {
        await ctx.reply(
            "Генерирую тест на основе материалов, пожалуйста, подождите..."
        );

        // Используем Promise.race для ограничения времени выполнения
        await Promise.race([
            (async () => {
                // Получаем случайный файл из доступных
                const files = await getFilesFromRoot();
                if (files.length === 0) {
                    throw new Error("Нет доступных материалов для генерации теста.");
                }

                const randomFile = files[Math.floor(Math.random() * files.length)];
                const filePath = path.join(materialsPath, randomFile);

                await ctx.reply("Обрабатываю материал..."); // Добавляем промежуточное уведомление

                // Извлекаем текст и генерируем тест
                const result = await parseDocxToText(filePath);
                if (!result) {
                    throw new Error("Не удалось прочитать материал для теста.");
                }

                await ctx.reply("Генерирую вопросы..."); // Добавляем промежуточное уведомление

                const test = await generateAIQuestions(result);
                await ctx.reply(
                    `Тест создан на основе материала "${randomFile}":\n\n${test}`
                );
            })(),
            timeoutPromise,
        ]);
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        if (err.message === "Operation Timeout") {
            await ctx.reply("Превышено время ожидания. Попробуйте еще раз.");
        } else {
            await ctx.reply(
                "Произошла ошибка при генерации теста. Пожалуйста, попробуйте позже."
            );
        }
    }
});

// Запуск сервисов
bot
    .launch() // Запускаем бота
    .then(() => console.log("Бот успешно запущен!"))
    .catch((err) => console.error("Ошибка при запуске бота:", err));

app.listen(PORT, () => {
    // Запускаем веб-сервер
    console.log(`Express-сервер запущен на порту ${PORT}`);
});
