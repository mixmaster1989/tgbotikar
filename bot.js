const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
require('dotenv').config();

// Путь к папке с материалами
const materialsPath = path.join(__dirname, 'materials');

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Инициализация Express-сервера
const app = express();
const PORT = process.env.PORT || 3000;

// Статические файлы для фронтенда
app.use('/static', express.static(path.join(__dirname, 'static')));

// Функция для парсинга .docx в HTML
async function parseDocxToHtml(filePath) {
    const result = await mammoth.convertToHtml({ path: filePath });
    return result.value;
}

// Маршрут для отображения статьи
app.get('/article/:fileName', async (req, res) => {
    const fileName = req.params.fileName;
    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Файл не найден');
    }

    try {
        const htmlContent = await parseDocxToHtml(filePath);
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

// Команда /article для отправки Web App кнопки
bot.command('article', async (ctx) => {
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure)
        .filter(file => structure[file] === null) // Только файлы .docx
        .map(file => Markup.button.webApp(file, `${process.env.WEB_APP_URL}/article/${file}`));

    if (buttons.length === 0) {
        return ctx.reply('Нет доступных статей.');
    }

    await ctx.reply('Выберите статью:', Markup.inlineKeyboard(buttons, { columns: 1 }));
});

// Функция для получения структуры папок и файлов
async function getMaterialsStructure() {
    const categories = await fs.readdir(materialsPath);
    const structure = {};

    for (const category of categories) {
        const categoryPath = path.join(materialsPath, category);
        const isDirectory = await fs.stat(categoryPath).then(stat => stat.isDirectory());

        if (!isDirectory && category.endsWith('.docx')) {
            structure[category] = null; // Указываем, что это файл
        }
    }

    return structure;
}

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
