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
    try {
        const result = await mammoth.convertToHtml({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        throw new Error('Ошибка при парсинге файла');
    }
}

// Функция для получения структуры папок и файлов
async function getMaterialsStructure() {
    const structure = {};
    try {
        const items = await fs.readdir(materialsPath);

        // Проверяем файлы в корне папки materials
        const rootFiles = items.filter(item => item.endsWith('.docx'));
        if (rootFiles.length > 0) {
            structure['Без категории'] = { 'Корневые материалы': rootFiles };
        }

        // Проверяем папки категорий
        for (const item of items) {
            const itemPath = path.join(materialsPath, item);
            const isDirectory = await fs.stat(itemPath).then(stat => stat.isDirectory());

            if (isDirectory) {
                structure[item] = {};
                const sections = await fs.readdir(itemPath);

                for (const section of sections) {
                    const sectionPath = path.join(itemPath, section);
                    const isSectionDir = await fs.stat(sectionPath).then(stat => stat.isDirectory());

                    if (isSectionDir) {
                        const files = await fs.readdir(sectionPath);
                        structure[item][section] = files.filter(file => file.endsWith('.docx'));
                    }
                }
            }
        }
    } catch (err) {
        console.error('Ошибка при получении структуры материалов:', err);
    }
    return structure;
}

// Маршрут для отображения статьи
app.get('/article/:category/:section/:fileName', async (req, res) => {
    const { category, section, fileName } = req.params;
    const filePath = path.join(materialsPath, category, section, fileName);

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

// Команда /materials для отображения категорий
bot.command('materials', async (ctx) => {
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure).map(category => [
        Markup.button.callback(category, `category:${category}`)
    ]);

    if (buttons.length === 0) {
        return ctx.reply('Нет доступных категорий.');
    }

    await ctx.reply('Выберите категорию:', Markup.inlineKeyboard(buttons));
});

// Обработка выбора категории
bot.action(/^category:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const structure = await getMaterialsStructure();
    const sections = structure[category];

    if (category === 'Без категории') {
        const materials = sections['Корневые материалы'];

        if (!materials || materials.length === 0) {
            return ctx.reply('В этой категории нет материалов.');
        }

        const buttons = materials.map(material => {
            const callbackData = `material:${category}:Корневые материалы:${material}`
                .slice(0, 64)
                .replace(/[^a-zA-Z0-9:._]/g, ''); // Разрешаем точки в callback_data

            console.log(`Создан callback_data: ${callbackData}`); // Логируем callback_data
            return [Markup.button.callback(material, callbackData)];
        });

        return ctx.reply(`Категория: ${category}\nВыберите материал:`, Markup.inlineKeyboard(buttons));
    }

    if (!sections || Object.keys(sections).length === 0) {
        return ctx.reply('В этой категории нет разделов.');
    }

    const buttons = Object.keys(sections).map(section => [
        Markup.button.callback(section, `section:${category}:${section}`)
    ]);

    await ctx.reply(`Категория: ${category}\nВыберите раздел:`, Markup.inlineKeyboard(buttons));
});

// Обработка выбора раздела
bot.action(/^section:(.+):(.+)$/, async (ctx) => {
    const [category, section] = ctx.match.slice(1);
    const structure = await getMaterialsStructure();
    const materials = structure[category][section];

    if (!materials || materials.length === 0) {
        return ctx.reply('В этом разделе нет материалов.');
    }

    const buttons = materials.map(material => [
        Markup.button.callback(material, `material:${category}:${section}:${material}`)
    ]);

    await ctx.reply(`Раздел: ${section}\nВыберите материал:`, Markup.inlineKeyboard(buttons));
});

// Обработка выбора материала
bot.action(/^material:(.*?):(.*?):(.+)$/, async (ctx) => {
    console.log('Обработчик кнопки "material" вызван'); // Логируем вызов обработчика
    const [category, section, material] = ctx.match.slice(1);
    console.log(`Выбран материал: category=${category}, section=${section}, material=${material}`); // Логируем данные

    const filePath = path.join(materialsPath, category || '', section || '', material);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return ctx.reply('Файл не найден.');
    }

    try {
        const content = await parseDocxToHtml(filePath);
        await ctx.reply(`Материал: ${material}\n\n${content}`);
    } catch (err) {
        console.error(`Ошибка при чтении файла ${filePath}:`, err);
        await ctx.reply('Ошибка при чтении материала.');
    }
});

// Обработка callback_query
bot.on('callback_query', (ctx) => {
    console.log('Получен callback_query:', ctx.callbackQuery.data); // Логируем данные callback_query
});

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
