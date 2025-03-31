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

// Функция для генерации тестов через OpenAI API
async function generateTest(material) {
    try {
        const prompt = `Создай тест на основе следующего материала:\n\n${material}\n\nТест должен содержать 5 вопросов с вариантами ответов и правильным ответом.`;
        const response = await openai.chat.completions.create({
            model: 'gpt-4', // Или используйте 'gpt-3.5-turbo', если GPT-4 недоступен
            messages: [
                { role: 'system', content: 'Ты помощник, который генерирует тесты.' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 500,
            temperature: 0.7,
        });
        return response.choices[0].message.content.trim();
    } catch (err) {
        console.error('Ошибка при генерации теста:', err);
        throw new Error('Не удалось сгенерировать тест.');
    }
}

// Функция для получения структуры материалов
async function getMaterialsStructure() {
    const structure = {};
    try {
        console.log('Получение структуры материалов...');
        const items = await fs.readdir(materialsPath);

        // Проверяем файлы в корне папки materials
        const rootFiles = items.filter(item => item.endsWith('.docx'));
        if (rootFiles.length > 0) {
            structure['Без категории'] = rootFiles;
        }

        // Проверяем папки категорий
        for (const item of items) {
            const itemPath = path.join(materialsPath, item);
            const isDirectory = await fs.stat(itemPath).then(stat => stat.isDirectory());

            if (isDirectory) {
                const files = await fs.readdir(itemPath);
                structure[item] = files.filter(file => file.endsWith('.docx'));
            }
        }
        console.log('Структура материалов:', structure); // Логируем структуру
    } catch (err) {
        console.error('Ошибка при получении структуры материалов:', err);
    }
    return structure;
}

// Функция для получения списка материалов
async function getMaterialsContent() {
    try {
        const items = await fs.readdir(materialsPath);
        const materials = [];

        for (const item of items) {
            const filePath = path.join(materialsPath, item);
            if (item.endsWith('.docx') && (await fs.stat(filePath)).isFile()) {
                const content = await parseDocxToText(filePath);
                materials.push(content);
            }
        }

        return materials.join('\n\n'); // Объединяем все материалы в один текст
    } catch (err) {
        console.error('Ошибка при получении материалов:', err);
        throw new Error('Не удалось получить материалы.');
    }
}

// Маршрут для отображения статьи
app.get('/article/:category?/:fileName', async (req, res) => {
    const { category, fileName } = req.params;

    console.log(`Запрос на статью: category=${category}, fileName=${fileName}`);

    // Формируем путь к файлу
    const filePath = path.join(
        materialsPath,
        category || '', // Если category пустой, используем корень
        fileName
    );

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

// Обработка кнопки "Пройти тест"
bot.action('generate_test', async (ctx) => {
    try {
        await ctx.reply('Генерирую тест на основе материалов, пожалуйста, подождите...');

        // Получаем содержимое всех материалов
        const materialsContent = await getMaterialsContent();

        if (!materialsContent) {
            return ctx.reply('Материалы отсутствуют или не удалось их загрузить.');
        }

        // Генерируем тест через OpenAI API
        const test = await generateTest(materialsContent);

        // Отправляем сгенерированный тест пользователю
        await ctx.reply(`Сгенерированный тест:\n\n${test}`);
    } catch (err) {
        console.error('Ошибка при генерации теста:', err);
        await ctx.reply('Произошла ошибка при генерации теста. Попробуйте позже.');
    }
});

// Обработка кнопки "Просмотреть материалы"
bot.action('open_materials', async (ctx) => {
    console.log('Обработчик "open_materials" вызван');
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure).map(category => [
        Markup.button.callback(category, `category:${category}`)
    ]);

    if (buttons.length === 0) {
        console.log('Нет доступных категорий');
        return ctx.reply('Нет доступных категорий.');
    }

    await ctx.reply('Выберите категорию:', Markup.inlineKeyboard(buttons));
});

// Обработка выбора категории
bot.action(/^category:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    console.log(`Обработчик категории вызван: ${category}`);
    const structure = await getMaterialsStructure();
    const materials = structure[category];

    if (!materials || materials.length === 0) {
        console.log(`В категории "${category}" нет материалов`);
        return ctx.reply('В этой категории нет материалов.');
    }

    const buttons = materials.map(material => [
        Markup.button.callback(material, `material:${category}:${material}`)
    ]);

    buttons.push([Markup.button.callback('🔙 Назад', 'open_materials')]);

    await ctx.reply(`Категория: ${category}\nВыберите материал:`, Markup.inlineKeyboard(buttons));
});

// Обработка выбора материала
bot.action(/^material:(.+):(.+)$/, async (ctx) => {
    const [category, fileName] = ctx.match.slice(1);
    console.log(`Обработчик материала вызван: category=${category}, fileName=${fileName}`);

    const filePath = path.join(materialsPath, category, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return ctx.reply('Файл не найден.');
    }

    const url = `${webAppUrl}/article/${encodeURIComponent(category)}/${encodeURIComponent(fileName)}`;
    console.log(`Ссылка на материал: ${url}`);

    await ctx.reply(
        `Откройте материал "${fileName}" через Web App:`,
        Markup.inlineKeyboard([
            Markup.button.url('Открыть материал', url),
            Markup.button.callback('🔙 Назад', `category:${category}`)
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
