const { Markup } = require('telegraf');
const logger = require('./logger');

class BotHandlers {
    static setupMainMenu(bot) {
        logger.info('Initializing bot handlers...');

        const mainMenuKeyboard = Markup.keyboard([
            ['📚 Кэш', '🤖 Генерация'],
            ['📊 Статистика', '⚙️ Настройки']
        ]).resize().oneTime(false);

        bot.command('start', (ctx) => {
            try {
                logger.info(`User ${ctx.from.username} started the bot`);
                ctx.reply('👋 Привет! Выбери действие:', mainMenuKeyboard);
            } catch (error) {
                logger.error('Error in start command', { error, user: ctx.from });
            }
        });

        const menuHandlers = [
            { text: '📚 Кэш', description: 'Cache menu', submenu: [
                ['📋 Список кэша', '🗑️ Очистить кэш']
            ]},
            { text: '🤖 Генерация', description: 'Generation menu', submenu: [
                ['▶️ Запустить тест-кэш', '⏹️ Остановить тест-кэш']
            ]},
            { text: '📊 Статистика', description: 'Statistics menu', submenu: [
                ['📈 Кэш', '🤖 Генерация']
            ]},
            { text: '⚙️ Настройки', description: 'Settings menu', submenu: [
                ['🔧 Параметры', '📝 Логи']
            ]}
        ];

        menuHandlers.forEach(menu => {
            bot.hears(menu.text, (ctx) => {
                try {
                    logger.info(`User ${ctx.from.username} opened ${menu.description}`);
                    ctx.reply(menu.description, {
                        reply_markup: {
                            keyboard: [
                                ...menu.submenu,
                                ['🔙 Главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    logger.error(`Error in ${menu.text} handler`, { error, user: ctx.from });
                }
            });
        });

        bot.hears('🔙 Главное меню', (ctx) => {
            try {
                logger.info(`User ${ctx.from.username} returned to main menu`);
                ctx.reply('Главное меню', mainMenuKeyboard);
            } catch (error) {
                logger.error('Error returning to main menu', { error, user: ctx.from });
            }
        });

        // Обработчики подменю с расширенным логированием
        const subMenuHandlers = [
            { text: '📋 Список кэша', action: 'Requesting cache list' },
            { text: '🗑️ Очистить кэш', action: 'Clearing cache' },
            { text: '▶️ Запустить тест-кэш', action: 'Starting test cache' },
            { text: '⏹️ Остановить тест-кэш', action: 'Stopping test cache' }
        ];

        subMenuHandlers.forEach(handler => {
            bot.hears(handler.text, (ctx) => {
                try {
                    logger.info(`User ${ctx.from.username} ${handler.action}`);
                    ctx.reply(`Выполняется: ${handler.action}`);
                } catch (error) {
                    logger.error(`Error in ${handler.text} handler`, { error, user: ctx.from });
                }
            });
        });

        // Глобальный обработчик неизвестных команд
        bot.on('text', (ctx) => {
            logger.warn(`Unhandled message from ${ctx.from.username}: ${ctx.message.text}`);
            ctx.reply('Извините, я не понял эту команду. Пожалуйста, используйте кнопки меню.');
        });
    }
}

module.exports = BotHandlers;
