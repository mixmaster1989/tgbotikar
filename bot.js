const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
const axios = require('axios');
const { GPT4All } = require('node-gpt4all');  // Используем node-gpt4all
require('dotenv').config();

// Путь к папке с материалами
const materialsPath = path.join(__dirname, 'materials');

// Глобальный объект для хранения путей к файлам
const fileMap = {};

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

// Инициализация GPT4All
let gpt4all = null;
let gptInitialized = false;

// Инициализируем модель при запуске
(async () => {
    try {
        gpt4all = new GPT4All('ggml-gpt4all-j');  // используем базовую модель
        await gpt4all.init(false);  // false означает не скачивать модель, если она уже есть
        gptInitialized = true;
        console.log('GPT4All успешно инициализирован');
    } catch (err) {
        console.error('Ошибка инициализации GPT4All:', err);
    }
})();

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

// Функция для генерации теста через GPT4All
async function generateTestWithGPT4All(material) {
    if (!gptInitialized || !gpt4all) {
        throw new Error('GPT4All не инициализирован');
    }

    try {
        const prompt = `Создай тест из 5 вопросов на основе этого текста. Каждый вопрос должен иметь 4 варианта ответа, где только один правильный:

${material.slice(0, 1000)}

Формат ответа:
1. [Вопрос 1]
a) [Вариант A]
b) [Вариант B]
c) [Вариант C]
d) [Вариант D]
Правильный ответ: [буква]

2. [Следующий вопрос...]`;

        const response = await gpt4all.generate(prompt, {
            temp: 0.7,
            maxTokens: 800,
            topK: 40,
            topP: 0.9,
            repeatPenalty: 1.1
        });

        return response.trim();
    } catch (err) {
        console.error('Ошибка при генерации теста через GPT4All:', err);
        throw err;
    }
}

// Улучшенная функция для локальной генерации теста
function generateSmartTest(material) {
    // Разбиваем материал на предложения и абзацы
    const paragraphs = material.split('\n\n').filter(p => p.trim().length > 30);
    const sentences = material.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Функция для извлечения ключевых фраз из текста
    function extractKeyPhrases(text) {
        // Удаляем стоп-слова и знаки препинания
        const stopWords = new Set(['и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему']);
        const words = text.toLowerCase()
            .replace(/[.,!?;:()]/g, '')
            .split(' ')
            .filter(word => word.length > 3 && !stopWords.has(word));
        
        // Находим часто встречающиеся слова
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        // Возвращаем топ слов
        return Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }
    
    // Функция для создания вопроса на основе предложения
    function createQuestion(sentence, keyPhrases) {
        const words = sentence.split(' ');
        const potentialAnswers = words.filter(w => w.length > 4 && keyPhrases.includes(w.toLowerCase()));
        
        if (potentialAnswers.length === 0) return null;
        
        const answer = potentialAnswers[Math.floor(Math.random() * potentialAnswers.length)];
        const question = sentence.replace(answer, '_________');
        
        // Создаем неправильные варианты из ключевых фраз
        const otherOptions = keyPhrases
            .filter(w => w !== answer.toLowerCase())
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1));
        
        const options = [answer, ...otherOptions].sort(() => Math.random() - 0.5);
        const correctIndex = options.indexOf(answer);
        
        return {
            question,
            options,
            correctAnswer: String.fromCharCode(97 + correctIndex)
        };
    }
    
    // Генерируем тест
    let test = 'Тест по материалу:\n\n';
    const keyPhrases = extractKeyPhrases(material);
    const questions = [];
    
    // Пробуем создать вопросы из каждого абзаца
    for (const paragraph of paragraphs) {
        const question = createQuestion(paragraph, keyPhrases);
        if (question) questions.push(question);
        if (questions.length >= 5) break;
    }
    
    // Если не хватает вопросов, используем отдельные предложения
    if (questions.length < 5) {
        for (const sentence of sentences) {
            const question = createQuestion(sentence, keyPhrases);
            if (question) questions.push(question);
            if (questions.length >= 5) break;
        }
    }
    
    // Форматируем тест
    questions.forEach((q, idx) => {
        test += `${idx + 1}. ${q.question}\n`;
        q.options.forEach((opt, i) => {
            test += `${String.fromCharCode(97 + i)}) ${opt}\n`;
        });
        test += `Правильный ответ: ${q.correctAnswer}\n\n`;
    });
    
    return test;
}

// Функция для генерации тестов через Hugging Face API
async function generateTestWithHuggingFace(material) {
    const maxAttempts = 2;
    const models = [
        // Маленькие модели (быстрые)
        'bigscience/bloomz-560m',
        'facebook/opt-125m',
        'EleutherAI/pythia-160m',
        
        // Средние модели
        'bigscience/bloomz-1b1',
        'facebook/opt-1.3b',
        'EleutherAI/pythia-1.4b',
        
        // Большие модели (более качественные)
        'EleutherAI/gpt-neo-1.3B',
        'bigscience/bloomz-3b',
        'facebook/opt-2.7b'
    ];

    // Перемешиваем модели для случайного порядка
    const shuffledModels = models.sort(() => Math.random() - 0.5);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        for (const model of shuffledModels) {
            try {
                console.log(`Попытка ${attempt + 1} с моделью ${model}`);
                
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('API Timeout')), 15000);
                });
                
                const apiPromise = fetch(
                    `https://api-inference.huggingface.co/models/${model}`,
                    {
                        headers: {
                            'Authorization': 'Bearer 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',
                            'Content-Type': 'application/json',
                        },
                        method: 'POST',
                        body: JSON.stringify({
                            inputs: `Создай тест на основе следующего материала:\n\n${material.slice(0, 800)}\n\nТест должен содержать 5 вопросов с вариантами ответов и правильным ответом.`,
                            parameters: {
                                max_new_tokens: 500,
                                temperature: 0.7,
                                top_p: 0.95,
                                do_sample: true
                            },
                        })
                    }
                );

                const response = await Promise.race([apiPromise, timeoutPromise]);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Ошибка API (${model}):`, response.status, response.statusText, errorText);
                    
                    if (response.status === 500 || response.status === 503) {
                        continue;
                    }
                    
                    throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();
                
                if (Array.isArray(result) && result.length > 0) {
                    return result[0].generated_text || 'Не удалось получить текст.';
                }
                
                return result.generated_text || 'Не удалось получить текст.';
            } catch (err) {
                console.error(`Ошибка при генерации теста через модель ${model}:`, err);
                continue;
            }
        }
        
        if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    // Пробуем GPT4All как запасной вариант
    try {
        console.log('Пробую использовать GPT4All...');
        return await generateTestWithGPT4All(material);
    } catch (err) {
        console.error('Ошибка GPT4All, использую локальную генерацию...', err);
        return generateSmartTest(material);
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
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation Timeout')), 60000);
    });

    try {
        await ctx.reply('Генерирую тест на основе материалов, пожалуйста, подождите...');
        
        await Promise.race([
            (async () => {
                const files = await getFilesFromRoot();
                if (files.length === 0) {
                    throw new Error('Нет доступных материалов для генерации теста.');
                }
                
                const randomFile = files[Math.floor(Math.random() * files.length)];
                const filePath = path.join(materialsPath, randomFile);
                
                const result = await parseDocxToText(filePath);
                if (!result) {
                    throw new Error('Не удалось прочитать материал для теста.');
                }
                
                let test;
                try {
                    test = await generateTestWithHuggingFace(result);
                } catch (err) {
                    console.log('Ошибка API, использую локальную генерацию...', err);
                    test = generateSmartTest(result);
                }
                
                await ctx.reply(`Тест создан на основе материала "${randomFile}":\n\n${test}`);
            })(),
            timeoutPromise
        ]);
    } catch (err) {
        console.error('Ошибка при генерации теста:', err);
        if (err.message === 'Operation Timeout') {
            await ctx.reply('Превышено время ожидания. Попробуйте еще раз.');
        } else {
            await ctx.reply('Произошла ошибка при генерации теста. Пожалуйста, попробуйте позже.');
        }
    }
});

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Web App доступен по адресу: ${webAppUrl}`);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
