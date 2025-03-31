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
        const result = await mammoth.extractRawText({ path: filePath });
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
        const response = await openai.createCompletion({
            model: 'text-davinci-003', // Или используйте 'gpt-4', если доступно
            prompt,
            max_tokens: 500,
            temperature: 0.7,
        });
        return response.data.choices[0].text.trim();
    } catch (err) {
        console.error('Ошибка при генерации теста:', err);
        throw new Error('Не удалось сгенерировать тест.');
    }
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

// Команда /start для приветствия и отображения кнопок
bot.start(async (ctx) => {
    await ctx.reply(
        'Добро пожаловать! Этот бот поможет вам просматривать материалы и проходить тесты.',
        Markup.inlineKeyboard([
            Markup.button.callback('📂 Просмотреть материалы', 'open_materials'),
            Markup.button.callback('📝 Пройти тест', 'generate_test'),
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
    const materials = structure[category];

    if (!materials || materials.length === 0) {
        return ctx.reply('В этой категории нет материалов.');
    }

    const buttons = materials.map(material => [
        Markup.button.callback(material.name, `material:${material.id}`)
    ]);

    buttons.push([Markup.button.callback('🔙 Назад', 'materials')]);

    await ctx.reply(`Категория: ${category}\nВыберите материал:`, Markup.inlineKeyboard(buttons));
});

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Web App доступен по адресу: ${webAppUrl}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
