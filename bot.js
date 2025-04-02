const { OpenAI } = require('openai'); // Импортируем OpenAI
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
const axios = require('axios');
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

// Функция для парсинга .docx в HTML
async function parseDocxToHtml(filePath) {
    try {
        console.log(`Парсинг файла: ${filePath}`);
        const result = await mammoth.convertToHtml({ path: filePath });
        console.log(`Парсинг завершен: ${filePath}`);
        return result.value.trim(); // Возвращаем HTML-контент
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return '<p>Ошибка при обработке файла.</p>'; // Возвращаем сообщение об ошибке
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

// Функция для генерации тестов через Hugging Face API
async function generateTestWithHuggingFace(material) {
    try {
        // Рассчитываем максимальную длину входного текста
        const maxInputTokens = 1024 - 200; // Учитываем max_new_tokens
        const truncatedMaterial = material.slice(0, maxInputTokens); // Обрезаем текст до допустимой длины

        const response = await fetch(
            'https://router.huggingface.co/hf-inference/models/gpt2', // Новый URL
            {
                headers: {
                    Authorization: `Bearer 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`, // Токен
                    'Content-Type': 'application/json',
                },
                method: 'POST',
                body: JSON.stringify({
                    inputs: `Создай тест на основе следующего материала:\n\n${truncatedMaterial}\n\nТест должен содержать 5 вопросов с вариантами ответов и правильным ответом.`,
                    parameters: {
                        max_new_tokens: 200, // Ограничиваем количество генерируемых токенов
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorDetails = await response.json();
            console.error('Ошибка API:', response.status, response.statusText, errorDetails);
            throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        return result.generated_text || 'Не удалось получить текст.';
    } catch (err) {
        console.error('Ошибка при генерации теста через Hugging Face API:', err);
        throw new Error('Не удалось сгенерировать тест.');
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
        const htmlContent = await parseDocxToHtml(filePath); // Парсим файл в HTML
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
                        ${htmlContent} <!-- Вставляем HTML-контент -->
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
            Markup.button.callback('📂 Просмотреть материалы', 'open_materials'),
            Markup.button.callback('📝 Сгенерировать тест', 'generate_test')
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

// Обработка кнопки "Сгенерировать тест"
bot.action('generate_test', async (ctx) => {
    try {
        await ctx.reply('Генерирую тест на основе материалов, пожалуйста, подождите...');

        // Получаем содержимое всех материалов
        const files = await getFilesFromRoot();
        if (files.length === 0) {
            return ctx.reply('Нет доступных файлов для генерации теста.');
        }

        // Читаем содержимое первого файла (для примера)
        const filePath = path.join(materialsPath, files[0]);
        const material = await parseDocxToText(filePath);

        // Генерируем тест через Hugging Face API
        const test = await generateTestWithHuggingFace(material);

        // Отправляем сгенерированный тест пользователю
        await ctx.reply(`Сгенерированный тест:\n\n${test}`);
    } catch (err) {
        console.error('Ошибка при генерации теста:', err);
        await ctx.reply('Произошла ошибка при генерации теста. Попробуйте позже.');
    }
});

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Web App доступен по адресу: ${webAppUrl}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
