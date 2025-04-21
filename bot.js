// Основные зависимости
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
const yadisk = new YaDiskService(process.env.YANDEX_DISK_TOKEN);

// Основные константы и пути
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const finalModelPath = path.join(modelDir, modelName);
const materialsPath = path.join(__dirname, "materials");
const cachePath = path.join(__dirname, "cache");
const PORT = process.env.PORT || 3000;
const webAppUrl = `http://89.232.176.215:${PORT}`;

// Инициализация сервисов
const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 300000 });
const app = express();
fs.ensureDirSync(cachePath);

// Инициализация базы данных
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    console.error("DB Error:", err.message);
    process.exit(1);
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

// Глобальные переменные
let gpt4allModel = null;
let activeTestCacheProcess = null;
const activeTests = new Map();
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000;

// Вспомогательные функции
async function parseDocxToText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (error) {
    console.error(`Ошибка при обработке файла ${filePath}:`, error.message);
    throw new Error("Не удалось извлечь текст из файла.");
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
    const files = await yadisk.syncMaterials();
    return files;
  } catch (err) {
    console.error("❌ Ошибка при получении списка файлов:", err);
    return [];
  }
}

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

function trimText(text, maxLength = 2000) {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

async function generateAIQuestions(text, ctx) {
  try {
    if (!gpt4allModel) {
      gpt4allModel = await initGPT4AllModel();
    }
    if (!gpt4allModel) {
      throw new Error("Модель GPT4All не инициализирована.");
    }
    const trimmedText = trimText(text);
    const prompt = `Создай 1 вопрос с 4 вариантами ответа по тексту. 
Формат ответа строго такой:
ВОПРОС: [текст вопроса]
А) [вариант ответа]
Б) [вариант ответа]
В) [вариант ответа]
Г) [вариант ответа]
ПРАВИЛЬНЫЙ: [буква правильного ответа]

Текст: ${trimmedText}`;
    const result = await gpt4allModel.generate(prompt, ctx);
    return result;
  } catch (err) {
    console.error("Ошибка при генерации вопросов через AI:", err);
    throw err;
  }
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

function saveToCache(question, response) {
  const stmt = db.prepare("INSERT OR REPLACE INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(question, response);
  stmt.finalize();
}

function logAndNotify(message, ctx = null) {
  const logMessage = `[${new Date().toISOString()}] ${message}`;
  console.log(logMessage);
  if (ctx) ctx.reply(message);
}

// --- Меню и команды ---
const mainMenuKeyboard = Markup.keyboard([
  ['📚 Кэш', '🤖 Генерация'],
  ['📊 Статистика', '⚙️ Настройки']
]).resize().oneTime(false);

bot.command('start', (ctx) => {
  ctx.reply('👋 Привет! Выбери действие:', mainMenuKeyboard);
});

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

bot.hears('🔙 Главное меню', (ctx) => {
  ctx.reply('Главное меню', mainMenuKeyboard);
});

// --- Действия и обработчики ---
bot.action("generate_cache", async (ctx) => {
  await ctx.answerCbQuery("⏳ Генерация началась...");
  logAndNotify("🛠️ Генерация кэша и датасета запущена, подождите...", ctx);

  setTimeout(async () => {
    try {
      const files = await yadisk.syncMaterials();
      if (!files.length) {
        logAndNotify("Нет файлов для кэша.", ctx);
        return;
      }
      // ...дополнительная логика генерации кэша...
    } catch (err) {
      console.error('Ошибка при генерации кэша:', err);
      await ctx.reply('❌ Произошла ошибка при генерации кэша');
    }
  }, 1000);
});

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

    activeTestCacheProcess.stdout.on('data', async (data) => {
      const message = data.toString().trim();
      output += message + '\n';
      const now = Date.now();

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
          const truncatedOutput = output.slice(-2000);
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

    // ...остальной код обработки процесса...
  } catch (err) {
    console.error("❌ Ошибка при запуске test_cache.js:", err);
    await ctx.reply("❌ Произошла ошибка при запуске процесса обработки кэша.");
  }
});

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

// --- Команды для синхронизации и информации ---
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

bot.command('disk_info', async (ctx) => {
  try {
    await ctx.reply('🔍 Получаю информацию о Яндекс.Диске...');
    const diskInfo = await yadisk.getDiskInfo();
    await ctx.reply(`✅ Информация о диске:\n\n${JSON.stringify(diskInfo, null, 2)}`);
  } catch (error) {
    console.error('Ошибка при получении информации о диске:', error);
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

// --- Запуск бота и обработка ошибок ---
bot.launch().then(() => {
  console.log("🤖 Бот запущен и готов к работе!");
}).catch((err) => {
  console.error("❌ Ошибка при запуске бота:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// --- Завершение работы и очистка ---
function gracefulShutdown(signal) {
  if (typeof activeTestCacheProcess !== 'undefined' && activeTestCacheProcess) {
    console.log('Завершение дочернего процесса test_cache.js');
    activeTestCacheProcess.kill('SIGTERM');
  }
  db.close((err) => {
    if (err) {
      console.error("Ошибка при закрытии базы данных:", err);
    } else {
      console.log("База данных закрыта");
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => gracefulShutdown('SIGINT'));
process.on("SIGTERM", () => gracefulShutdown('SIGTERM'));
