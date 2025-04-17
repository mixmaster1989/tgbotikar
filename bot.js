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
const { convertDocxToPdf } = require('./modules/docx2pdf'); // Конвертация DOCX в PDF

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

// Добавляем кнопку в start меню
bot.start(async (ctx) => {
    const buttonRows = [
        [Markup.button.callback("📂 Просмотреть материалы", "open_materials")],
        [Markup.button.callback("📝 Сгенерировать тест", "generate_test")],
        [
            Markup.button.callback("📊 Проверить кэш", "check_cache"),
            Markup.button.callback("📚 Просмотр датасета", "view_dataset")
        ]
    ];

    // Добавляем кнопку остановки только если есть активный процесс
    if (activeTestCacheProcess) {
        buttonRows.push([
            Markup.button.callback("🔄 Запустить обработку", "run_test_cache"),
            Markup.button.callback("⛔️ Остановить генерацию", "stop_test_cache")
        ]);
    } else {
        buttonRows.push([
            Markup.button.callback("🔄 Запустить обработку", "run_test_cache")
        ]);
    }

    await ctx.reply(
        "Добро пожаловать! Этот бот поможет вам просматривать материалы.",
        Markup.inlineKeyboard(buttonRows)
    );
});

// Улучшенный обработчик кнопки "Проверить кэш"
bot.action("check_cache", async (ctx) => {
    try {
        db.all(`
            SELECT 
                prompt, 
                response, 
                created_at,
                (SELECT COUNT(*) FROM gpt_cache) as total_entries
            FROM gpt_cache 
            ORDER BY created_at DESC 
            LIMIT 5
        `, async (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при запросе кэша:", err);
                return ctx.reply("❌ Ошибка при запросе кэша.");
            }

            if (rows.length === 0) {
                return ctx.reply("📂 Кэш пуст.");
            }

            let message = `📊 <b>Статистика кэша</b>\n`;
            message += `\nВсего записей: ${rows[0].total_entries}\n`;
            message += `\n<b>Последние 5 запросов:</b>\n\n`;

            rows.forEach((row, index) => {
                const date = new Date(row.created_at).toLocaleString('ru-RU');
                message += `${index + 1}. <b>Дата:</b> ${date}\n`;
                message += `📝 <b>Вопрос:</b>\n${row.prompt.slice(0, 100)}${row.prompt.length > 100 ? '...' : ''}\n`;
                message += `💡 <b>Ответ:</b>\n${row.response.slice(0, 100)}${row.response.length > 100 ? '...' : ''}\n\n`;
            });

            message += `\nДля полного списка используйте команду /cache`;

            await ctx.reply(message, {
                parse_mode: 'HTML',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 Обновить", "check_cache")],
                    [Markup.button.callback("🏠 В главное меню", "back_to_menu")]
                ])
            });
        });
    } catch (err) {
        console.error("❌ Ошибка при обработке кнопки 'Проверить кэш':", err);
        ctx.reply("❌ Произошла ошибка при обработке кнопки.");
    }
});

// Новый обработчик для просмотра датасета
bot.action("view_dataset", async (ctx) => {
    try {
        const datasetDir = path.join(__dirname, "dataset");

        if (!fs.existsSync(datasetDir)) {
            return ctx.reply("📂 Папка с датасетами не найдена.");
        }

        const files = fs.readdirSync(datasetDir)
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => {
                return fs.statSync(path.join(datasetDir, b)).mtime.getTime() -
                    fs.statSync(path.join(datasetDir, a)).mtime.getTime();
            });

        if (files.length === 0) {
            return ctx.reply("📂 Датасеты не найдены.");
        }

        // Берем самый свежий датасет
        const latestDataset = JSON.parse(
            fs.readFileSync(path.join(datasetDir, files[0]), 'utf8')
        );

        let message = `📚 <b>Информация о последнем датасете:</b>\n\n`;
        message += `📅 Дата создания: ${new Date(latestDataset.created_at).toLocaleString('ru-RU')}\n`;
        message += `📊 Всего примеров: ${latestDataset.total_examples}\n`;
        message += `🤖 Модель: ${latestDataset.model}\n\n`;

        message += `<b>Статистика ответов:</b>\n`;
        const factualCount = latestDataset.examples.filter(ex => ex.metadata.is_factual).length;
        message += `✅ Фактологических: ${factualCount}\n`;
        message += `📏 Средняя длина: ${Math.round(latestDataset.examples.reduce((acc, ex) => acc + ex.metadata.response_length, 0) / latestDataset.total_examples)}\n\n`;

        message += `<b>Последние 3 примера:</b>\n\n`;
        latestDataset.examples.slice(0, 3).forEach((example, i) => {
            message += `${i + 1}. <b>Вопрос:</b>\n${example.instruction.slice(0, 100)}${example.instruction.length > 100 ? '...' : ''}\n`;
            message += `<b>Ответ:</b>\n${example.output.slice(0, 100)}${example.output.length > 100 ? '...' : ''}\n\n`;
        });

        await ctx.reply(message, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("🔄 Обновить", "view_dataset")],
                [Markup.button.callback("🏠 В главное меню", "back_to_menu")]
            ])
        });

    } catch (err) {
        console.error("❌ Ошибка при просмотре датасета:", err);
        ctx.reply("❌ Произошла ошибка при просмотре датасета.");
    }
});

// Обработчик кнопки возврата в главное меню
bot.action("back_to_menu", async (ctx) => {
    await ctx.editMessageText(
        "Выберите действие:",
        Markup.inlineKeyboard([
            [Markup.button.callback("📂 Просмотреть материалы", "open_materials")],
            [Markup.button.callback("📝 Сгенерировать тест", "generate_test")],
            [
                Markup.button.callback("📊 Проверить кэш", "check_cache"),
                Markup.button.callback("📚 Просмотр датасета", "view_dataset")
            ],
            [Markup.button.callback("🔄 Запустить обработку кэша", "run_test_cache")]
        ])
    );
});

// Команда /cache - проверка содержимого кэша
bot.command("cache", async (ctx) => {
    try {
        db.all("SELECT prompt, response, created_at FROM gpt_cache", (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при запросе кэша:", err);
                return ctx.reply("❌ Ошибка при запросе кэша.");
            }

            if (rows.length === 0) {
                return ctx.reply("📂 Кэш пуст.");
            }

            let message = "📊 Содержимое кэша:\n\n";
            rows.forEach((row, index) => {
                message += `${index + 1}. [${row.created_at}]\n`;
                message += `Промпт: ${row.prompt.slice(0, 50)}...\n`;
                message += `Ответ: ${row.response.slice(0, 50)}...\n\n`;
            });

            ctx.reply(message);
        });
    } catch (err) {
        console.error("❌ Ошибка при обработке команды /cache:", err);
        ctx.reply("❌ Произошла ошибка при обработке команды.");
    }
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

// Обработка выбора конкретного файла - отправляет PDF вместо ссылки на Web App
bot.action(/^material:(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    const fullPath = path.join(materialsPath, fileName);
    const pdfFile = `${fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.pdf`;
    const pdfPath = path.join(__dirname, 'static', 'previews', pdfFile);

    try {
        console.log(`Конвертация файла ${fileName} в PDF...`);
        await convertDocxToPdf(fullPath, pdfPath); // Конвертация DOCX в PDF
        console.log(`Файл ${fileName} успешно конвертирован в PDF: ${pdfPath}`);
        
        // Отправляем PDF-файл с явным указанием MIME-типа
        await ctx.replyWithDocument(
            {
                source: pdfPath,
                filename: `${fileName.replace(/\.[^.]+$/, '')}.pdf`,
                contentType: 'application/pdf', // Явно указываем MIME-тип
            },
            {
                caption: `📄 ${fileName.replace(/\.[^.]+$/, '')}`,
            }
        );
    } catch (err) {
        console.error('Ошибка при конвертации DOCX в PDF:', err);
        await ctx.reply('❌ Не удалось сконвертировать файл.');
    }
});

// Обработка кнопки "Сгенерировать тест"
bot.action("generate_test", async (ctx) => {
    try {
        const startTime = Date.now(); // Засекаем время начала
        const files = await getFilesFromRoot();
        if (files.length === 0) {
            return ctx.reply("Нет доступных материалов для генерации теста.");
        }

        // Выбираем случайный файл
        const random = files[Math.floor(Math.random() * files.length)];
        const filePath = path.join(materialsPath, random);
        await ctx.reply(`📚 Используется: ${random}`);

        // Извлекаем текст из файла
        const content = await parseDocxToText(filePath);

        // Генерируем тест
        const test = await generateAIQuestions(content);
        const parsed = parseTestResponse(test);

        // Формируем сообщение с вопросом
        let message = `❓ <b>${parsed.question}</b>\n`;
        for (const key in parsed.answers) {
            message += `\n${key}) ${parsed.answers[key]}`;
        }
        message += `\n\n✅ Правильный ответ: ${parsed.correct}`;

        // Отправляем тест
        await ctx.replyWithHTML(message);

        // Логируем время выполнения
        const endTime = Date.now(); // Засекаем время окончания
        const executionTime = ((endTime - startTime) / 1000).toFixed(2); // Время выполнения в секундах
        await ctx.reply(`⏱️ Генерация теста завершена за ${executionTime} секунд.`);

        // Возвращаем главное меню
        await ctx.reply("Выберите действие:", mainMenuKeyboard());
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        await ctx.reply("❌ Произошла ошибка при генерации теста.");
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

// Добавляем переменную для контроля частоты обновлений
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // минимальный интервал между обновлениями (1 секунда)

// Обновляем обработчик run_test_cache
bot.action("run_test_cache", async (ctx) => {
    try {
        const statusMessage = await ctx.reply(
            "🚀 Запуск обработки кэша...\n\n",
            Markup.inlineKeyboard([[
                Markup.button.callback("⛔️ Остановить генерацию", "stop_test_cache")
            ]])
        );

        let output = "";
        let pendingUpdate = false;

        activeTestCacheProcess = spawn('node', ['test_cache.js'], {
            cwd: __dirname
        });

        // Обновленный обработчик вывода
        activeTestCacheProcess.stdout.on('data', async (data) => {
            const message = data.toString().trim();
            output += message + '\n';
            const now = Date.now();

            // Новые префиксы для обновления
            const updatePrefixes = [
                'FILE:', 'PROMPT:', 'CACHE_CHECK:', 'CACHE_HIT:',
                'MODEL_REQUEST:', 'RESPONSE:', 'WAIT:', 'ERROR:',
                'SKIP:', 'CRITICAL_ERROR:', 'PROGRESS:'
            ];

            const shouldUpdate = updatePrefixes.some(prefix => message.startsWith(prefix));

            if (!pendingUpdate && (shouldUpdate || now - lastUpdateTime >= UPDATE_INTERVAL)) {
                pendingUpdate = true;
                lastUpdateTime = now;

                try {
                    const truncatedOutput = output.slice(-2000); // Уменьшаем размер вывода
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        statusMessage.message_id,
                        null,
                        `🚀 Запуск обработки кэша...\n\n<pre>${truncatedOutput}</pre>`,
                        {
                            parse_mode: 'HTML',
                            reply_markup: Markup.inlineKeyboard([
                                [Markup.button.callback("⛔️ Остановить генерацию", "stop_test_cache")]
                            ])
                        }
                    ).catch(() => { });
                } finally {
                    pendingUpdate = false;
                }
            }
        });

        // Остальной код остается прежним...
    } catch (err) {
        console.error("❌ Ошибка при запуске test_cache.js:", err);
        await ctx.reply("❌ Произошла ошибка при запуске процесса обработки кэша.");
    }
});

// Обновляем обработчик stop_test_cache
bot.action("stop_test_cache", async (ctx) => {
    try {
        if (activeTestCacheProcess) {
            activeTestCacheProcess.kill('SIGTERM');
            activeTestCacheProcess = null;

            await ctx.reply("🛑 Обработка остановлена",
                Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 Запустить заново", "run_test_cache")],
                    [Markup.button.callback("🏠 В главное меню", "back_to_menu")]
                ])
            );
        } else {
            await ctx.reply("❓ Нет активного процесса генерации");
        }
    } catch (err) {
        console.error("❌ Ошибка при остановке процесса:", err);
        await ctx.reply("❌ Не удалось остановить процесс.");
    }
});

// Добавим обработку завершения процесса
process.on('SIGINT', () => {
    if (activeTestCacheProcess) {
        console.log('Завершение дочернего процесса test_cache.js');
        activeTestCacheProcess.kill('SIGTERM');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    if (activeTestCacheProcess) {
        console.log('Завершение дочернего процесса test_cache.js');
        activeTestCacheProcess.kill('SIGTERM');
    }
    process.exit(0);
});

// Главное меню
const mainMenuKeyboard = Markup.keyboard([
    ['📚 Кэш', '🤖 Генерация'],
    ['📊 Статистика', '⚙️ Настройки']
]).resize().oneTime(false);

// Обновим команду старта
bot.command('start', (ctx) => {
    ctx.reply('👋 Привет! Выбери действие:', mainMenuKeyboard);
});

// Обработчики кнопок главного меню
bot.hears('📚 Кэш', (ctx) => {
    ctx.reply('Управление кэшем', {
        reply_markup: {
            keyboard: [
                ['📋 Список кэша', '🗑️ Очистить кэш'],
                ['🔙 Главное меню']
            ],
            resize_keyboard: true
        }
    });
});

bot.hears('🤖 Генерация', (ctx) => {
    ctx.reply('Режимы генерации', {
        reply_markup: {
            keyboard: [
                ['▶️ Запустить тест-кэш', '⏹️ Остановить тест-кэш'],
                ['🔙 Главное меню']
            ],
            resize_keyboard: true
        }
    });
});

bot.hears('📊 Статистика', (ctx) => {
    ctx.reply('Статистика работы бота', {
        reply_markup: {
            keyboard: [
                ['📈 Кэш', '🤖 Генерация'],
                ['🔙 Главное меню']
            ],
            resize_keyboard: true
        }
    });
});

bot.hears('⚙️ Настройки', (ctx) => {
    ctx.reply('Настройки бота', {
        reply_markup: {
            keyboard: [
                ['🔧 Параметры', '📝 Логи'],
                ['🔙 Главное меню']
            ],
            resize_keyboard: true
        }
    });
});

// Возврат в главное меню
bot.hears('🔙 Главное меню', (ctx) => {
    ctx.reply('Главное меню', mainMenuKeyboard);
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

// Обработчик кнопки "Материалы"
bot.action("materials", async (ctx) => {
    try {
        console.log("Обработчик 'Материалы' вызван.");
        await ctx.answerCbQuery("📂 Загрузка материалов...");

        const files = await getFilesFromRoot(); // Получаем список файлов из папки материалов
        console.log("Список файлов:", files);

        if (!files.length) {
            await ctx.reply("❌ Нет доступных материалов.");
            return;
        }

        const fileButtons = files.map((file) =>
            Markup.button.callback(file, `file_${file}`)
        );
        await ctx.reply(
            "📂 Доступные материалы:",
            Markup.inlineKeyboard(fileButtons, { columns: 1 })
        );
    } catch (error) {
        console.error("Ошибка в обработчике 'Материалы':", error.message);
        await ctx.reply("❌ Произошла ошибка при загрузке материалов.");
    }
});

// Обработчик для отправки PDF
bot.action(/file_(.+)/, async (ctx) => {
    const fileName = ctx.match[1];
    const fullPath = path.join(materialsPath, fileName);
    const pdfFile = `${fileName.replace(/\.[^.]+$/, '')}_${Date.now()}.pdf`;
    const pdfPath = path.join(__dirname, 'static', 'previews', pdfFile);

    try {
        console.log(`Конвертация файла ${fileName} в PDF...`);
        await convertDocxToPdf(fullPath, pdfPath); // Конвертация DOCX в PDF
        console.log(`Файл ${fileName} успешно конвертирован в PDF: ${pdfPath}`);
        
        // Отправляем PDF-файл с явным указанием MIME-типа
        await ctx.replyWithDocument(
            {
                source: pdfPath,
                filename: `${fileName.replace(/\.[^.]+$/, '')}.pdf`,
                contentType: 'application/pdf', // Явно указываем MIME-тип
            },
            {
                caption: `📄 ${fileName.replace(/\.[^.]+$/, '')}`, // Описание файла
            }
        );
    } catch (err) {
        console.error('Ошибка при конвертации DOCX в PDF:', err);
        await ctx.reply('❌ Не удалось сконвертировать файл.');
    }
});
