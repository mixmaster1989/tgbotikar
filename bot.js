// Основные зависимости
const { Telegraf, Markup } = require("telegraf"); // Telegraf для работы с Telegram API
const express = require("express"); // Express для веб-сервера
const path = require("path"); // Работа с путями
const fs = require("fs-extra"); // Расширенная работа с файлами
const mammoth = require("mammoth"); // Конвертация DOCX файлов
const gpt4all = require("gpt4all"); // Локальная AI модель для генерации текста
require("dotenv").config(); // Загрузка переменных окружения
const os = require("os"); // Работа с системными путями
const sqlite3 = require('sqlite3').verbose();
const util = require('util');

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

// Инициализация БД
const db = new sqlite3.Database('database.sqlite', (err) => {
    if (err) {
        console.error('Ошибка при подключении к БД:', err);
    } else {
        console.log('Успешное подключение к БД');
        initDatabase();
    }
});

// Промисифицируем методы БД
const dbRun = util.promisify(db.run.bind(db));
const dbGet = util.promisify(db.get.bind(db));
const dbAll = util.promisify(db.all.bind(db));

/**
 * Функция инициализации БД
 */
async function initDatabase() {
    try {
        await dbRun(`CREATE TABLE IF NOT EXISTS test_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE,
            content TEXT,
            test_json TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('БД инициализирована');
    } catch (err) {
        console.error('Ошибка при инициализации БД:', err);
    }
}

/**
 * Функция сканирования и кэширования материалов
 */
async function scanAndCacheMaterials() {
    try {
        console.log('Начинаем сканирование материалов...');

        // Получаем список всех .docx файлов
        const files = await getFilesFromRoot();
        console.log(`Найдено файлов: ${files.length}`);

        for (const filename of files) {
            try {
                // Проверяем, есть ли файл уже в базе
                const existing = await dbGet(
                    'SELECT filename FROM test_cache WHERE filename = ?',
                    [filename]
                );

                if (existing) {
                    console.log(`Пропускаем ${filename} - уже в базе`);
                    continue;
                }

                // Получаем путь к файлу
                const filePath = path.join(materialsPath, filename);

                // Извлекаем текст
                const content = await parseDocxToText(filePath);

                if (!content) {
                    console.error(`Ошибка: Не удалось извлечь текст из ${filename}`);
                    continue;
                }

                // Сохраняем в базу
                await dbRun(
                    'INSERT INTO test_cache (filename, content, test_json) VALUES (?, ?, ?)',
                    [filename, content, '']
                );

                console.log(`✅ Файл ${filename} успешно обработан и сохранен`);

            } catch (err) {
                console.error(`Ошибка при обработке файла ${filename}:`, err);
            }
        }

        console.log('Сканирование завершено');
    } catch (err) {
        console.error('Ошибка при сканировании материалов:', err);
    }
}

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

// Добавляем глобальный объект для хранения правильных ответов
const activeTests = new Map();

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

                const test = await generateAIQuestions(result, ctx);
                console.log("Вопросы сгенерированы, форматируем результат...");

                // Парсим ответ модели
                const parsedTest = parseTestResponse(test);

                // Сохраняем правильный ответ
                const testId = Date.now().toString();
                activeTests.set(testId, parsedTest.correct);

                // Формируем сообщение с вопросом
                const message = `🎯 <b>Вопрос:</b>\n\n${parsedTest.question}\n\n` +
                    `<i>Выберите правильный вариант ответа:</i>`;

                // Создаем клавиатуру с вариантами ответов
                const keyboard = [
                    [
                        Markup.button.callback('А) ' + parsedTest.answers['А'], `answer:${testId}:А`),
                        Markup.button.callback('Б) ' + parsedTest.answers['Б'], `answer:${testId}:Б`)
                    ],
                    [
                        Markup.button.callback('В) ' + parsedTest.answers['В'], `answer:${testId}:В`),
                        Markup.button.callback('Г) ' + parsedTest.answers['Г'], `answer:${testId}:Г`)
                    ]
                ];

                // Отправляем вопрос с вариантами ответов
                await ctx.reply(message, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(keyboard)
                });

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

// Добавляем обработчик ответов на вопросы
bot.action(/^answer:(\d+):([АБВГ])$/, async (ctx) => {
    try {
        const testId = ctx.match[1];
        const userAnswer = ctx.match[2];
        const correctAnswer = activeTests.get(testId);

        if (!correctAnswer) {
            await ctx.reply('⚠️ Тест устарел. Пожалуйста, сгенерируйте новый.');
            return;
        }

        // Удаляем тест из активных
        activeTests.delete(testId);

        // Проверяем ответ
        const isCorrect = userAnswer === correctAnswer;

        // Отправляем результат
        await ctx.reply(
            isCorrect
                ? '✅ <b>Правильно!</b>\n\nОтличная работа!'
                : `❌ <b>Неправильно</b>\n\nПравильный ответ: ${correctAnswer}`,
            {
                parse_mode: 'HTML',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('🔄 Новый тест', 'generate_test')]
                ])
            }
        );

        // Редактируем оригинальное сообщение, чтобы показать, что тест завершен
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    } catch (err) {
        console.error('Ошибка при проверке ответа:', err);
        await ctx.reply('❌ Произошла ошибка при проверке ответа');
    }
});

/**
 * Проверяет базу данных и запускает сканирование материалов при необходимости
 */
async function checkAndRunScan() {
    try {
        console.log('\n📊 Проверка базы данных...');

        // Проверяем содержимое
        const records = await dbAll('SELECT filename, length(content) as content_length FROM test_cache');
        console.log(`Записей в базе: ${records.length}`);

        if (records.length === 0) {
            console.log('❗ База пуста, запускаем сканирование...');
            await scanAndCacheMaterials();

            // Проверяем результат сканирования
            const newRecords = await dbAll('SELECT filename, length(content) as content_length FROM test_cache');
            console.log('\n📝 Результаты сканирования:');
            newRecords.forEach(record => {
                console.log(`📄 ${record.filename} (размер: ${record.content_length} символов)`);
            });
        } else {
            console.log('\n📝 Содержимое базы:');
            records.forEach(record => {
                console.log(`📄 ${record.filename} (размер: ${record.content_length} символов)`);
            });
        }
    } catch (err) {
        console.error('❌ Ошибка при проверке/сканировании:', err);
    }
}

// Добавляем обработку завершения работы
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Ошибка при закрытии БД:', err);
        } else {
            console.log('Соединение с БД закрыто');
        }
        process.exit(0);
    });
});

// Изменяем запуск бота
bot
    .launch()
    .then(async () => {
        console.log("🤖 Бот запущен!");
        await checkAndRunScan();
        console.log("\n✅ Бот готов к работе!");
    })
    .catch((err) => console.error("❌ Ошибка при запуске бота:", err));

app.listen(PORT, () => {
    // Запускаем веб-сервер
    console.log(`Express-сервер запущен на порту ${PORT}`);
});
