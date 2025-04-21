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

// Убедитесь, что папка cache существует
fs.ensureDirSync(cachePath);

// Улучшенная обработка ошибок при инициализации базы данных
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    console.error("DB Error:", err.message);
    process.exit(1); // Завершаем процесс, если база данных не инициализируется
  } else {
    try {
      initDatabase();
    } catch (error) {
      console.error("Ошибка при инициализации базы данных:", error.message);
    }
  }
});

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
        batchSize: 1,
      };
      return (await model.generate(prompt, options)).text;
    },
  };
}

// Обработка ошибок при работе с файлами
async function parseDocxToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (error) {
    console.error(`Ошибка при обработке файла ${filePath}:`, error.message);
    throw new Error("Не удалось извлечь текст из файла.");
  }
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

function saveToCache(question, response) {
  const stmt = db.prepare("INSERT OR REPLACE INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(question, response);
  stmt.finalize();
}

// Логирование в консоль и в бот
function logAndNotify(message, ctx = null) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  console.log(logMessage); // Логируем в консоль
  if (ctx) ctx.reply(message); // Отправляем в бот
}

// Основное меню
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

// Кнопка "Материалы" — выводит список файлов
bot.action("materials", async (ctx) => {
  try {
    const files = await fs.readdir(materialsPath);
    const docxFiles = files.filter(f => f.endsWith(".docx"));
    if (!docxFiles.length) {
      return ctx.reply("Нет доступных материалов.");
    }
    const buttons = docxFiles.map(f =>
      [Markup.button.callback(f, `material_${encodeURIComponent(f)}`)]
    );
    await ctx.reply("Выберите материал:", Markup.inlineKeyboard(buttons));
  } catch (err) {
    await ctx.reply("Ошибка при получении списка материалов.");
  }
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

// Генерация кэша и датасета
bot.action("generate_cache", async (ctx) => {
  await ctx.answerCbQuery("⏳ Генерация началась..."); // Быстрый ответ на callback (избегаем таймаута)
  logAndNotify("🛠️ Генерация кэша и датасета запущена, подождите...", ctx);

  setTimeout(async () => {
    try {
      const files = await yadisk.syncMaterials();
      if (!files.length) {
        logAndNotify("Нет файлов для кэша.", ctx);
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
