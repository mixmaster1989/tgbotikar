const { OpenAI } = require('openai'); // Импортируем OpenAI
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
require('dotenv').config();

// Путь к папке с материалами
const materialsPath = path.join(__dirname, 'materials');

// Глобальный объект для хранения путей к файлам
const fileMap = {};

// Инициализация OpenAI API
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Укажите ваш API-ключ
});

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Инициализация Express-сервера
const app = express();
const PORT = process.env.PORT || 3000;

// Статические файлы для фронтенда
app.use('/static', express.static(path.join(__dirname, 'static')));

// URL Web App (используем публичный IP)
const webAppUrl = `http://89.169.131.216:${PORT}`;

// Функция для парсинга .docx в текст
async function parseDocxToText(filePath) {
    try {
        console.log(`Парсинг файла: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        console.log(`Парсинг завершен: ${filePath}`);
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return '';
    }
}

// Функция для получения списка файлов из корня
async function getFilesFromRoot() {
    try {
        console.log('Получение списка файлов из корня...');
        const items = await fs.readdir(materialsPath);
        const files = items.filter(item => item.endsWith('.docx'));
        console.log('Список файлов:', files);
        return files;
    } catch (err) {
        console.error('Ошибка при получении списка файлов:', err);
        return [];
    }
}

// Маршрут для отображения статьи
app.get('/article/:fileName', async (req, res) => {
    const { fileName } = req.params;

    console.log(`Запрос на статью: fileName=${fileName}`);

    // Формируем путь к файлу
    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return res.status(404).send('Файл не найден');
    }

    try {
        const htmlContent = await parseDocxToText(filePath);
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${fileName}</title>
                <link rel="stylesheet" href="/static/styles.css">
            </head>
            <body>
                <div class="container">
                    <div class="article">
                        ${htmlContent}
                    </div>
                    <button class="close-btn" onclick="Telegram.WebApp.close()">Закрыть</button>
                </div>
                <script src="https://telegram.org/js/telegram-web-app.js"></script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(`Ошибка при обработке файла ${filePath}:`, err);
        res.status(500).send('Ошибка при обработке файла');
    }
});

// Команда /start для приветствия и отображения кнопок
bot.start(async (ctx) => {
    console.log('Команда /start вызвана');
    await ctx.reply(
        'Добро пожаловать! Этот бот поможет вам просматривать материалы.',
        Markup.inlineKeyboard([
            Markup.button.callback('📂 Просмотреть материалы', 'open_materials')
        ])
    );
});

// Обработка кнопки "Просмотреть материалы"
bot.action('open_materials', async (ctx) => {
    console.log('Обработчик "open_materials" вызван');
    const files = await getFilesFromRoot();

    if (files.length === 0) {
        console.log('Нет доступных файлов');
        return ctx.reply('Нет доступных файлов.');
    }

    const buttons = files.map(file => [
        Markup.button.callback(file, `material:${file}`)
    ]);

    await ctx.reply('Выберите файл:', Markup.inlineKeyboard(buttons));
});

// Обработка выбора файла
bot.action(/^material:(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    console.log(`Обработчик файла вызван: fileName=${fileName}`);

    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return ctx.reply('Файл не найден.');
    }

    const url = `${webAppUrl}/article/${encodeURIComponent(fileName)}`;
    console.log(`Ссылка на файл: ${url}`);

    await ctx.reply(
        `Откройте файл "${fileName}" через Web App:`,
        Markup.inlineKeyboard([
            Markup.button.url('Открыть файл', url),
            Markup.button.callback('🔙 Назад', 'open_materials')
        ])
    );
});

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Web App доступен по адресу: ${webAppUrl}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
