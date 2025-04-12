const { Markup } = require('telegraf');

class BotHandlers {
    static setupMainMenu(bot) {
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

        bot.hears('🔙 Главное меню', (ctx) => {
            ctx.reply('Главное меню', mainMenuKeyboard);
        });
    }
}

module.exports = BotHandlers;
