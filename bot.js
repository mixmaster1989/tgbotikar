const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
const axios = require('axios');
const fetch = require('node-fetch');  // Добавляем node-fetch
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

// Функция для извлечения ключевых фраз из текста
function extractKeyPhrases(text) {
    // Удаляем стоп-слова и знаки препинания
    const stopWords = new Set(['и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему']);
    const words = text.toLowerCase()
        .replace(/[.,!?;:()]/g, '')
        .split(' ')
        .filter(word => word.length > 3 && !stopWords.has(word));
    
    // Находим часто встречающиеся слова и их контекст
    const wordFreq = {};
    const wordContext = {};
    
    // Окно контекста
    const windowSize = 5;
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        wordFreq[word] = (wordFreq[word] || 0) + 1;
        
        // Собираем контекст слова
        if (!wordContext[word]) {
            wordContext[word] = new Set();
        }
        
        // Добавляем слова из окна контекста
        for (let j = Math.max(0, i - windowSize); j < Math.min(words.length, i + windowSize); j++) {
            if (i !== j) {
                wordContext[word].add(words[j]);
            }
        }
    }
    
    // Вычисляем важность слов на основе частоты и разнообразия контекста
    const wordImportance = {};
    for (const word in wordFreq) {
        wordImportance[word] = wordFreq[word] * wordContext[word].size;
    }
    
    // Возвращаем топ слов с их контекстом
    return Object.entries(wordImportance)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => ({
            word,
            context: Array.from(wordContext[word])
        }));
}

// Функция для создания правдоподобных неправильных ответов
function generateDistractors(answer, keyPhrases, count = 3) {
    const answerLower = answer.toLowerCase();
    const distractors = new Set();
    
    // Сначала пробуем использовать слова из того же контекста
    const answerPhrase = keyPhrases.find(p => p.word === answerLower);
    if (answerPhrase) {
        answerPhrase.context.forEach(word => {
            if (word !== answerLower && word.length > 3) {
                distractors.add(word);
            }
        });
    }
    
    // Если не хватает, добавляем другие ключевые фразы
    keyPhrases.forEach(phrase => {
        if (distractors.size < count && phrase.word !== answerLower) {
            distractors.add(phrase.word);
        }
    });
    
    // Преобразуем в массив и форматируем
    return Array.from(distractors)
        .slice(0, count)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1));
}

// Функция для создания вопроса на основе предложения
function createQuestion(sentence, keyPhrases) {
    // Разбиваем на слова и ищем потенциальные ответы
    const words = sentence.split(' ');
    const potentialAnswers = words.filter(w => {
        const wLower = w.toLowerCase().replace(/[.,!?;:()]/, '');
        return w.length > 4 && keyPhrases.some(p => p.word === wLower);
    });
    
    if (potentialAnswers.length === 0) return null;
    
    // Выбираем слово для вопроса
    const answer = potentialAnswers[Math.floor(Math.random() * potentialAnswers.length)];
    const cleanAnswer = answer.replace(/[.,!?;:()]/, '');
    
    // Создаем вопрос
    let question = sentence;
    
    // Пробуем создать вопрос разными способами
    const questionTypes = [
        // Заполнить пропуск
        () => sentence.replace(answer, '_________'),
        // Что/Кто это?
        () => `Что такое "${cleanAnswer}" в данном контексте?`,
        // Определение
        () => `Выберите правильное определение для термина "${cleanAnswer}":`,
        // Значение
        () => `Какое значение имеет "${cleanAnswer}" в этом тексте?`
    ];
    
    // Выбираем случайный тип вопроса
    question = questionTypes[Math.floor(Math.random() * questionTypes.length)]();
    
    // Генерируем неправильные варианты
    const distractors = generateDistractors(cleanAnswer, keyPhrases);
    
    // Перемешиваем все варианты ответов
    const options = [cleanAnswer, ...distractors].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(cleanAnswer);
    
    return {
        question,
        options,
        correctAnswer: String.fromCharCode(97 + correctIndex)
    };
}

// Улучшенная функция для локальной генерации теста
function generateSmartTest(material) {
    // Разбиваем материал на предложения и абзацы
    const paragraphs = material.split('\n\n').filter(p => p.trim().length > 30);
    const sentences = material.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Извлекаем ключевые фразы с контекстом
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
            if (questions.length >= 5) break;
            const question = createQuestion(sentence, keyPhrases);
            if (question) questions.push(question);
        }
    }
    
    // Форматируем тест
    let test = 'Тест по материалу:\n\n';
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

    // Используем улучшенную локальную генерацию как запасной вариант
    console.log('Использую локальную генерацию...');
    return generateSmartTest(material);
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
