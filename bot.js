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

// Функция для локальной генерации простого теста
function generateSimpleTest(material) {
    // Разбиваем материал на предложения
    const sentences = material.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // Если материала недостаточно, возвращаем сообщение об ошибке
    if (sentences.length < 5) {
        return 'Недостаточно материала для генерации теста.';
    }

    // Выбираем 5 случайных предложений для вопросов
    const selectedSentences = [];
    const usedIndexes = new Set();
    
    while (selectedSentences.length < 5 && selectedSentences.length < sentences.length) {
        const idx = Math.floor(Math.random() * sentences.length);
        if (!usedIndexes.has(idx)) {
            usedIndexes.add(idx);
            selectedSentences.push(sentences[idx].trim());
        }
    }

    // Генерируем тест
    let test = 'Тест по материалу:\n\n';
    
    selectedSentences.forEach((sentence, idx) => {
        // Создаем вопрос из предложения
        const words = sentence.split(' ').filter(w => w.length > 3);
        if (words.length === 0) return;
        
        const randomWord = words[Math.floor(Math.random() * words.length)];
        const question = sentence.replace(randomWord, '________');
        
        // Создаем варианты ответов
        const correctAnswer = randomWord;
        const otherWords = words.filter(w => w !== randomWord);
        const alternatives = [correctAnswer];
        
        // Добавляем случайные слова как альтернативные варианты
        while (alternatives.length < 4 && otherWords.length > 0) {
            const randomIndex = Math.floor(Math.random() * otherWords.length);
            const word = otherWords.splice(randomIndex, 1)[0];
            if (word !== correctAnswer) {
                alternatives.push(word);
            }
        }
        
        // Перемешиваем варианты ответов
        const shuffledAlternatives = alternatives.sort(() => Math.random() - 0.5);
        const correctIndex = shuffledAlternatives.indexOf(correctAnswer);
        
        // Добавляем вопрос в тест
        test += `${idx + 1}. ${question}\n`;
        shuffledAlternatives.forEach((alt, i) => {
            test += `${String.fromCharCode(97 + i)}) ${alt}\n`;
        });
        test += `Правильный ответ: ${String.fromCharCode(97 + correctIndex)}\n\n`;
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
                
                // Создаем промис с таймаутом для API запроса
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('API Timeout')), 15000); // 15 секунд таймаут
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

                // Используем Promise.race для обработки таймаута
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
            await new Promise(resolve => setTimeout(resolve, 3000)); // Уменьшаем время ожидания между попытками
        }
    }

    console.log('Использую локальную генерацию теста...');
    return generateSimpleTest(material);
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
    // Создаем промис с таймаутом для всей операции
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation Timeout')), 60000); // 60 секунд максимум на всю операцию
    });

    try {
        await ctx.reply('Генерирую тест на основе материалов, пожалуйста, подождите...');
        
        // Оборачиваем основную логику в Promise.race с таймаутом
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
                
                // Если API недоступен, сразу используем локальную генерацию
                let test;
                try {
                    test = await generateTestWithHuggingFace(result);
                } catch (err) {
                    console.log('Ошибка API, использую локальную генерацию...');
                    test = generateSimpleTest(result);
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
