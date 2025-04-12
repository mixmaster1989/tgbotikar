const { Markup } = require('telegraf');
const logger = require('./logger');

class BotHandlers {
    static setupMainMenu(bot) {
        const mainMenuKeyboard = Markup.keyboard([
            ['📚 Кэш', '🤖 Генерация'],
            ['📊 Статистика', '⚙️ Настройки']
        ]).resize().oneTime(false);

        bot.command('start', (ctx) => {
            logger.info(`User ${ctx.from.username} started the bot`);
            ctx.reply('👋 Привет! Выбери действие:', mainMenuKeyboard);
        });

        bot.hears('📚 Кэш', (ctx) => {
            logger.info(`User ${ctx.from.username} opened Cache menu`);
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
            logger.info(`User ${ctx.from.username} opened Generation menu`);
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
            logger.info(`User ${ctx.from.username} opened Statistics menu`);
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
            logger.info(`User ${ctx.from.username} opened Settings menu`);
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
            logger.info(`User ${ctx.from.username} returned to main menu`);
            ctx.reply('Главное меню', mainMenuKeyboard);
        });

        // Обработчики подменю
        bot.hears('📋 Список кэша', (ctx) => {
            logger.info(`User ${ctx.from.username} requested cache list`);
            ctx.reply('Здесь будет список кэша');
        });

        bot.hears('🗑️ Очистить кэш', (ctx) => {
            logger.info(`User ${ctx.from.username} requested cache clear`);
            ctx.reply('Кэш будет очищен');
        });

        bot.hears('▶️ Запустить тест-кэш', (ctx) => {
            logger.info(`User ${ctx.from.username} started test cache`);
            ctx.reply('Запуск теста кэша');
        });

        bot.hears('⏹️ Остановить тест-кэш', (ctx) => {
            logger.info(`User ${ctx.from.username} stopped test cache`);
            ctx.reply('Тест кэша остановлен');
        });
    }
}

module.exports = BotHandlers;
