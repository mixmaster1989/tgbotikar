const { Telegraf, Markup } = require('telegraf');
const path = require('path');
require('dotenv').config();

// Основные константы
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ Отсутствует токен бота в .env файле');
    process.exit(1);
}

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Главное меню
const mainMenuKeyboard = Markup.keyboard([
    ['📚 Материалы', '🤖 Генерация'],
    ['📊 Статистика', '⚙️ Настройки']
]).resize();

// Обработчик команды /start
bot.command('start', async (ctx) => {
    try {
        const username = ctx.from?.username || ctx.from?.id || 'неизвестный пользователь';
        console.log(`👤 Пользователь ${username} запустил бота`);

        const welcomeMessage = 
            '👋 Добро пожаловать!\n\n' +
            '🤖 Я помогу вам:\n' +
            '📚 Просматривать учебные материалы\n' +
            '✍️ Генерировать тесты по материалам\n' +
            '📊 Отслеживать прогресс\n\n' +
            '🎯 Выберите действие в меню:';

        await ctx.reply(welcomeMessage, mainMenuKeyboard);
        console.log(`✅ Отправлено приветственное сообщение пользователю ${username}`);
    } catch (error) {
        console.error('❌ Ошибка в команде /start:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
    }
});

// Запуск бота
(async () => {
    try {
        console.log('🚀 Запуск бота...');
        await bot.launch();
        console.log('✅ Бот успешно запущен!');
    } catch (error) {
        console.error('❌ Ошибка при запуске бота:', error);
        process.exit(1);
    }
})();

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, останавливаем бота...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, останавливаем бота...');
    bot.stop('SIGTERM');
});