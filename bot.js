// Основные зависимости
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const path = require("path");
const { spawn } = require('child_process');
require("dotenv").config();

// Импорт модулей
const database = require("./modules/database");
const gptModel = require("./modules/gpt");
const docxProcessor = require("./modules/docx");
const BotHandlers = require("./modules/handlers");
const logger = require("./modules/logger");

// Основные константы
const PORT = process.env.PORT || 3000;
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN, {
    handlerTimeout: 300000 // 5 минут
});

// Глобальная переменная для хранения активного процесса
let activeTestCacheProcess = null;

async function startApp() {
    try {
        logger.info('Начало инициализации приложения');

        // Инициализация сервисов
        database.initCache();
        await gptModel.init();

        // Настройка Express
        app.use("/static", express.static(path.join(__dirname, "static")));

        // Настройка обработчиков бота
        BotHandlers.setupMainMenu(bot);

        // Запуск сервисов
        app.listen(PORT, () => {
            logger.info(`Express-сервер запущен на порту ${PORT}`);
        });

        bot.launch();
        logger.info('Telegram бот успешно запущен');
    } catch (error) {
        logger.error('Критическая ошибка при запуске приложения', { error });
        process.exit(1);
    }
}

// Команда просмотра кэша
bot.command('cache', (ctx) => {
    database.db.all("SELECT * FROM gpt_cache ORDER BY created_at DESC LIMIT 10", (err, rows) => {
        if (err) {
            logger.error('Ошибка при запросе кэша', { error: err });
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
});

// Обработка кнопки "Просмотреть материалы"
bot.action("open_materials", async (ctx) => {
    const files = await docxProcessor.listFiles();

    if (files.length === 0) {
        return ctx.reply("Нет доступных файлов.");
    }

    const buttons = files.map((file) => [
        Markup.button.callback(file, `material:${file}`),
    ]);

    ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

// Обработчики завершения
process.once('SIGINT', () => {
    logger.info('Получен сигнал SIGINT, остановка бота');
    bot.stop('SIGINT');
    database.close();
});

process.once('SIGTERM', () => {
    logger.info('Получен сигнал SIGTERM, остановка бота');
    bot.stop('SIGTERM');
    database.close();
});

// Запуск приложения
startApp().catch((err) => {
    logger.error('Критическая ошибка при запуске приложения', { error: err });
    process.exit(1);
});
