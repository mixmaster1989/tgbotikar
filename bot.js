// Основные зависимости
const { Telegraf, Markup } = require("telegraf"); // Telegraf для работы с Telegram API
const express = require("express"); // Express для веб-сервера
const path = require("path"); // Работа с путями
const fs = require("fs-extra"); // Расширенная работа с файлами
const mammoth = require("mammoth"); // Конвертация DOCX файлов
const gpt4all = require("gpt4all"); // Локальная AI модель для генерации текста
require("dotenv").config(); // Загрузка переменных окружения
const os = require("os"); // Работа с системными путями
const sqlite3 = require("sqlite3").verbose(); // Подключаем SQLite
const { spawn } = require('child_process'); // Для запуска внешних процессов
const YaDiskService = require('./services/yadisk_service');
const yadisk = new YaDiskService(process.env.YANDEX_DISK_TOKEN);

// Основные константы и пути
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all"); // Директория с AI моделью
const finalModelPath = path.join(modelDir, modelName); // Путь к файлу модели. Возможно не нужен.
const materialsPath = path.join(__dirname, "materials"); // Путь к папке с материалами
const PORT = process.env.PORT || 3000; // Порт для веб-сервера
const webAppUrl = `http://89.232.176.215:${PORT}`; // URL веб-приложения

// Инициализация основных сервисов
const bot = new Telegraf(process.env.BOT_TOKEN, {
    handlerTimeout: 300000 // увеличиваем до 5 минут
}); // Создание экземпляра бота
const app = express(); // Создание Express приложения

// Настройка статических файлов для веб-сервера
app.use("/static", express.static(path.join(__dirname, "static")));

// Создаем подключение к базе данных
const db = new sqlite3.Database("database.sqlite", (err) => {
    if (err) {
        console.error("❌ Ошибка подключения к базе данных:", err);
    } else {
        console.log("✅ Успешное подключение к базе данных");
        initDatabase();
    }
});

// Функция для инициализации таблицы
function initDatabase() {
    db.run(
        `CREATE TABLE IF NOT EXISTS gpt_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt TEXT UNIQUE,
            response TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("❌ Ошибка при создании таблицы:", err);
            } else {
                console.log("✅ Таблица gpt_cache готова к использованию");
            }
        }
    );
}

/**
 * Запускает приложение
 */
async function startApp() {
    try {
        console.log("📌 Начало выполнения программы");
        console.log("🚀 Запуск приложения...");

        // 1. Запуск Express-сервера
        await new Promise((resolve) => {
            app.listen(PORT, () => {
                console.log(`🌐 Express-сервер запущен на порту ${PORT}`);
                resolve();
            });
        });

        // 2. Запуск Telegram бота
        console.log("🤖 Запуск Telegram бота...");
        try {
            await bot.launch();
            console.log("✅ Telegram бот успешно запущен!");
        } catch (error) {
            console.error("❌ Ошибка при запуске Telegram бота:", error);
            process.exit(1);
        }

        // 3. Лог успешного завершения запуска
        console.log("\n🎉 Приложение полностью готово к работе!");

        // 4. Обработчики завершения
        process.once('SIGINT', () => {
            console.log('\n👋 Завершение работы по SIGINT');
            bot.stop('SIGINT');
            process.exit(0);
        });

        process.once('SIGTERM', () => {
            console.log('\n👋 Завершение работы по SIGTERM');
            bot.stop('SIGTERM');
            process.exit(0);
        });

    } catch (error) {
        console.error("❌ Ошибка при запуске приложения:", error);
        process.exit(1);
    }
}

// Запуск приложения
startApp().catch((err) => {
    console.error("❌ Критическая ошибка:", err);
    process.exit(1);
});

/**
 * Извлекает текст из DOCX файла
 * @param {string} filePath - путь к DOCX файлу
 * @returns {Promise<string>} текст из файла
 */
async function parseDocxToText(filePath) {
    try {
        console.log(`Извлечение текста из файла: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        console.log(`Текст успешно извлечен (длина: ${result.value.length})`);
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
        const files = await yadisk.syncMaterials();
        console.log(`📚 Доступно ${files.length} .docx файлов`);
        return files;
    } catch (err) {
        console.error("❌ Ошибка при получении списка файлов:", err);
        return [];
    }
}

// Глобальная переменная для хранения инициализированной модели
let gpt4allModel = null;

// Добавляем глобальный объект для хранения правильных ответов
const activeTests = new Map();

// Глобальная переменная для хранения активного процесса обработки кэша
let activeTestCacheProcess = null;

/**
 * Инициализирует модель GPT4All
 * @returns {Promise<Object|null>} объект модели с методом generate или null при ошибке
 */
async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");
        const model = await gpt4all.loadModel(modelName);

        return {
            generate: async (prompt, ctx = null) => {
                try {
                    const answer = await model.generate(prompt);
                    return answer.text;
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

/**
 * Обрезает текст до безопасного размера
 * @param {string} text - исходный текст
 * @returns {string} обрезанный текст
 */
function trimText(text) {
    // Примерно 1500 символов должно уложиться в лимит токенов
    const MAX_LENGTH = 1500;
    if (text.length <= MAX_LENGTH) return text;

    // Берем первую часть текста
    const firstPart = text.substring(0, MAX_LENGTH);

    // Находим последнюю точку для красивого обрезания
    const lastDot = firstPart.lastIndexOf('.');
    return lastDot > 0 ? firstPart.substring(0, lastDot + 1) : firstPart;
}

/**
 * Генерирует вопросы на основе текста используя AI
 * @param {string} text - исходный текст
 * @param {Object} ctx - контекст Telegram
 * @returns {Promise<string>} сгенерированные вопросы
 */
async function generateAIQuestions(text, ctx) {
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

        // Обрезаем текст до безопасного размера
        const trimmedText = trimText(text);
        console.log(`Исходный размер текста: ${text.length}, обрезанный: ${trimmedText.length}`);

        console.log("Подготовка промпта для генерации...");
        const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту. 
        Формат ответа строго такой:
        ВОПРОС: [текст вопроса]
        А) [вариант ответа]
        Б) [вариант ответа]
        В) [вариант ответа]
        Г) [вариант ответа]
        ПРАВИЛЬНЫЙ: [буква правильного ответа]

        Текст: ${trimmedText}`;

        console.log("Отправляем запрос к модели...");
        const result = await gpt4allModel.generate(prompt, ctx);
        console.log("Ответ от модели получен");
        return result;
    } catch (err) {
        console.error("Ошибка при генерации вопросов через AI:", err);
        throw err;
    }
}

/**
 * Функция для парсинга ответа модели
 * @param {string} response - ответ модели
 * @returns {Object} объект с вопросом, вариантами ответов и правильным ответом
 */
function parseTestResponse(response) {
    const lines = response.split('\n');
    const question = lines[0].replace('ВОПРОС:', '').trim();
    const answers = {
        'А': lines[1].replace('А)', '').trim(),
        'Б': lines[2].replace('Б)', '').trim(),
        'В': lines[3].replace('В)', '').trim(),
        'Г': lines[4].replace('Г)', '').trim()
    };
    const correct = lines[5].replace('ПРАВИЛЬНЫЙ:', '').trim();

    return { question, answers, correct };
}

// Обработчики команд бота

// Определяем константы для меню
const MENU_MATERIALS = '📂 Материалы';
const MENU_TESTS = '📝 Тесты';
const MENU_CACHE = '📊 Кэш';
const MENU_SETTINGS = '⚙️ Настройки';
const MENU_BACK = '🔙 Назад';

// Создаем клавиатуры для разных меню
const mainMenuKeyboard = Markup.keyboard([
    [MENU_MATERIALS, MENU_TESTS],
    [MENU_CACHE, MENU_SETTINGS]
]).resize();

const backKeyboard = Markup.keyboard([
    [MENU_BACK]
]).resize();

// Обработчик команды /start
bot.command('start', async (ctx) => {
    return ctx.reply('Добро пожаловать! Выберите раздел:', mainMenuKeyboard);
});

// Обработчик кнопки "Назад"
bot.hears(MENU_BACK, async (ctx) => {
    return ctx.reply('Выберите раздел:', mainMenuKeyboard);
});

// Обработчик раздела "Материалы"
bot.hears(MENU_MATERIALS, async (ctx) => {
    const files = await getFilesFromRoot();
    if (files.length === 0) {
        return ctx.reply('Нет доступных файлов.', mainMenuKeyboard);
    }

    let message = '📚 Доступные материалы:\n\n';
    files.forEach((file, i) => {
        message += `${i + 1}. ${file}\n`;
    });
    message += '\nВведите номер материала для просмотра';

    return ctx.reply(message, backKeyboard);
});

// Обработчик раздела "Тесты"
bot.hears(MENU_TESTS, async (ctx) => {
    const files = await getFilesFromRoot();
    if (files.length === 0) {
        return ctx.reply('Нет материалов для генерации теста.', mainMenuKeyboard);
    }

    let message = '📝 Выберите материал для теста:\n\n';
    files.forEach((file, i) => {
        message += `${i + 1}. ${file}\n`;
    });
    message += '\n0. 🎲 Случайный материал\nВведите номер:';

    return ctx.reply(message, backKeyboard);
});

// Обработчик раздела "Кэш"
bot.hears(MENU_CACHE, async (ctx) => {
    let message = '📊 Операции с кэшем:\n\n';
    message += '1. Просмотреть кэш\n';
    message += '2. Запустить обработку\n';
    message += '3. Очистить кэш\n\n';
    message += 'Введите номер операции:';

    return ctx.reply(message, backKeyboard);
});

// Обработчик раздела "Настройки"
bot.hears(MENU_SETTINGS, async (ctx) => {
    let message = '⚙️ Настройки:\n\n';
    message += '1. Проверить Яндекс.Диск\n';
    message += '2. Синхронизировать файлы\n';
    message += '3. Проверить модель AI\n\n';
    message += 'Введите номер настройки:';

    return ctx.reply(message, backKeyboard);
});

// Добавляем новую команду для ручной синхронизации:
bot.command('sync', async (ctx) => {
    try {
        await ctx.reply('🔄 Начинаю синхронизацию с Яндекс.Диском...');
        const files = await yadisk.syncMaterials();
        await ctx.reply(`✅ Синхронизация завершена!\nОбновлено файлов: ${files.length}`);
    } catch (error) {
        console.error('Ошибка синхронизации:', error);
        await ctx.reply('❌ Ошибка при синхронизации с Яндекс.Диском');
    }
});

// Добавляем команду для тестирования доступа
bot.command('check_disk', async (ctx) => {
    try {
        await ctx.reply('🔍 Проверяю доступ к Яндекс.Диску...');
        await yadisk.checkAccess();
        await ctx.reply('✅ Доступ к Яндекс.Диску подтвержден');
    } catch (error) {
        console.error('Ошибка при проверке доступа:', error);
        await ctx.reply(`❌ Ошибка доступа: ${error.message}`);
    }
});
