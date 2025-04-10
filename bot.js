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
        console.log("Начинаем генерацию вопросов...");

        if (!gpt4allModel) {
            console.log("Модель не инициализирована, запускаем инициализацию...");
            gpt4allModel = await initGPT4AllModel();
        }

        if (!gpt4allModel) {
            console.log("Ошибка: Модель не удалось инициализировать");
            throw new Error("Модель GPT4All не инициализирована.");
        }

        console.log("Подготовка промпта для генерации...");
        // Возвращаемся к предыдущей версии промпта
        const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту: ${text}`;

        console.log("Отправляем запрос к модели...");
        const result = await gpt4allModel.generate(prompt);
        console.log("Ответ от модели получен");
        return result;
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
    try {
        const files = await getFilesFromRoot();
        if (files.length === 0) {
            return ctx.reply("Нет доступных материалов для генерации теста.");
        }

        // Создаем кнопки для выбора файла
        const buttons = files.map((file) => [
            Markup.button.callback(`📄 ${file}`, `test:${file}`),
        ]);

        // Добавляем кнопку случайного выбора
        buttons.push([Markup.button.callback("🎲 Случайный материал", "test:random")]);

        await ctx.reply(
            "Выберите материал для генерации теста:",
            Markup.inlineKeyboard(buttons)
        );
    } catch (err) {
        console.error("Ошибка при подготовке списка:", err);
        await ctx.reply("Произошла ошибка. Попробуйте позже.");
    }
});

// Добавляем обработчик выбора файла для теста
bot.action(/^test:(.+)$/, async (ctx) => {
    console.log("Запущена генерация теста");
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation Timeout")), 300000);
    });

    try {
        const files = await getFilesFromRoot();
        let selectedFile;

        if (ctx.match[1] === 'random') {
            console.log("Выбираем случайный файл...");
            selectedFile = files[Math.floor(Math.random() * files.length)];
        } else {
            selectedFile = ctx.match[1];
        }

        console.log(`Выбран файл: ${selectedFile}`);
        await ctx.reply(
            `📝 Начинаю генерацию теста по материалу "${selectedFile}"\n\n` +
            `⏳ Процесс займет около 3-5 минут\n` +
            `❗️ Пожалуйста, дождитесь окончания всех этапов`
        );

        await Promise.race([
            (async () => {
                const filePath = path.join(materialsPath, selectedFile);
                console.log("Начинаем обработку материала...");
                await ctx.reply("🔄 Этап 1/3: Обработка материала...");

                const result = await parseDocxToText(filePath);
                if (!result) {
                    throw new Error("Не удалось прочитать материал для теста.");
                }

                console.log("Материал обработан, начинаем генерацию вопросов...");
                await ctx.reply(
                    "✅ Материал обработан\n" +
                    "🤖 Этап 2/3: Запуск AI модели"
                );

                const test = await generateAIQuestions(result);
                console.log("Вопросы сгенерированы, форматируем результат...");
                await ctx.reply("✅ AI модель завершила работу\n🎯 Этап 3/3: Подготовка результата");

                await ctx.reply(
                    `🎉 Тест успешно создан!\n\n` +
                    `📚 Материал: "${selectedFile}"\n\n` +
                    `${test}`
                );
            })(),
            timeoutPromise,
        ]);
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        await ctx.reply(
            "❌ Произошла ошибка при генерации теста\n" +
            "🔄 Пожалуйста, попробуйте позже"
        );
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
