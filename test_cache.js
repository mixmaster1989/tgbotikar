const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");
const fs = require("fs");
const readline = require('readline');

const MAX_TOKENS = 1500; // Безопасный лимит с учетом промпта и ответа

// Константы
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");
const db = new sqlite3.Database("database.sqlite");

// Добавляем класс для отслеживания прогресса
class GenerationProgress {
    constructor(totalTokens) {
        this.totalTokens = totalTokens;
        this.currentTokens = 0;
        this.lastUpdateTime = Date.now();
        this.updateInterval = 100; // минимальный интервал обновления в мс
    }

    update(token) {
        this.currentTokens++;
        const now = Date.now();

        // Обновляем прогресс-бар не чаще чем раз в updateInterval мс
        if (now - this.lastUpdateTime >= this.updateInterval) {
            this.lastUpdateTime = now;
            const percentage = Math.min(Math.round((this.currentTokens / this.totalTokens) * 100), 100);
            updateProgress(percentage, 100);
        }
    }
}

// Инициализация таблицы
function initDatabase() {
    db.run(
        `CREATE TABLE IF NOT EXISTS gpt_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt TEXT UNIQUE,
            response TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("❌ Ошибка при создании таблицы:", err);
            } else {
                console.log("✅ Таблица gpt_cache готова к использованию");
            }
        }
    );
}

// Парсинг текста из DOCX
async function parseDocxToText(filePath) {
    try {
        console.log(`Извлечение текста из файла: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        console.log(`Текст успешно извлечен (длина: ${result.value.length})`);
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "";
    }
}

// Функция для обрезки текста
function truncateText(text, maxTokens = MAX_TOKENS) {
    // Грубая оценка: 1 токен ≈ 4 символа
    const safeLength = maxTokens * 4;
    if (text.length > safeLength) {
        console.log(`⚠️ Текст слишком длинный (${text.length} символов), обрезаем до ${safeLength}`);
        return text.slice(0, safeLength) + "...";
    }
    return text;
}

// Инициализация GPT4All модели
async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");
        const model = await gpt4all.loadModel(modelName);

        return {
            generate: async (prompt, options = {}) => {
                try {
                    let response = '';
                    const progress = new GenerationProgress(options.max_tokens || 200);

                    const answer = await model.generate(prompt, {
                        ...options,
                        callback: (token) => {
                            response += token;
                            progress.update(token);
                            return true;
                        }
                    });

                    // Завершаем прогресс-бар
                    updateProgress(100, 100);
                    console.log('\n');

                    return answer.text;
                } catch (error) {
                    console.error("Ошибка при генерации:", error);
                    return null;
                }
            }
        };
    } catch (error) {
        console.error("Ошибка при инициализации GPT4All:", error);
        return null;
    }
}

// Сохранение результата в кэш
async function cacheResponse(prompt, response, text) {  // Добавляем параметр text
    try {
        // Сначала сохраняем в БД
        await new Promise((resolve, reject) => {
            db.run(
                "INSERT INTO gpt_cache (prompt, response) VALUES (?, ?)",
                [prompt, response],
                (err) => {
                    if (err) {
                        console.error("❌ Ошибка при сохранении в кэш:", err);
                        reject(err);
                    } else {
                        console.log("✅ Результат сохранен в кэш");
                        resolve();
                    }
                }
            );
        });

        // Затем сохраняем в JSONL лог
        const logEntry = {
            timestamp: new Date().toISOString(),
            text_length: text ? text.length : 0,
            question: prompt,
            answer: response,
            is_procedural: response.toLowerCase().includes('шаг') ||
                response.toLowerCase().includes('команд')
        };

        fs.appendFileSync(
            path.join(__dirname, 'generation_log.jsonl'),
            JSON.stringify(logEntry) + '\n'
        );

    } catch (error) {
        console.error("❌ Ошибка при сохранении:", error);
        throw error;
    }
}

// Получение результата из кэша
function getCachedResponse(prompt) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT response FROM gpt_cache WHERE prompt = ?",
            [prompt],
            (err, row) => {
                if (err) {
                    console.error("❌ Ошибка при запросе кэша:", err);
                    reject(err);
                } else {
                    resolve(row ? row.response : null);
                }
            }
        );
    });
}

// Функция для вычисления схожести строк (расстояние Левенштейна)
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
        dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(
                    dp[i - 1][j - 1] + 1,
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1
                );
            }
        }
    }

    return 1 - (dp[m][n] / Math.max(m, n)); // Нормализованное значение схожести
}

// Поиск похожего промпта
async function findSimilarPrompt(prompt) {
    return new Promise((resolve, reject) => {
        db.all("SELECT prompt, response FROM gpt_cache", (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при запросе кэша:", err);
                reject(err);
            } else {
                let bestMatch = null;
                let highestSimilarity = 0;

                // Очищаем промпты от общих частей и приводим к нижнему регистру
                const cleanPrompt = prompt
                    .replace(/\\n\\n.*$/s, '') // Удаляем текст после \n\n
                    .toLowerCase()
                    .trim();

                rows.forEach((row) => {
                    const cleanRowPrompt = row.prompt
                        .replace(/\\n\\n.*$/s, '')
                        .toLowerCase()
                        .trim();

                    // Вычисляем схожесть строк
                    const similarity = levenshteinDistance(cleanPrompt, cleanRowPrompt);

                    // Проверяем наличие одинаковых ключевых слов
                    const promptWords = new Set(cleanPrompt.split(/\s+/));
                    const rowWords = new Set(cleanRowPrompt.split(/\s+/));
                    const commonWords = [...promptWords].filter(word => rowWords.has(word));
                    const wordSimilarity = commonWords.length / Math.max(promptWords.size, rowWords.size);

                    // Общая схожесть - среднее между Левенштейном и схожестью слов
                    const totalSimilarity = (similarity + wordSimilarity) / 2;

                    if (totalSimilarity > highestSimilarity) {
                        highestSimilarity = totalSimilarity;
                        bestMatch = row;
                    }
                });

                // Увеличиваем порог схожести до 0.95 (95%)
                if (highestSimilarity > 0.95) {
                    console.log(`✅ Найден похожий промпт с коэффициентом схожести ${highestSimilarity.toFixed(3)}`);
                    resolve(bestMatch);
                } else {
                    resolve(null);
                }
            }
        });
    });
}

// Получение списка всех .docx файлов
async function getAllDocxFiles() {
    return new Promise((resolve, reject) => {
        fs.readdir(materialsPath, (err, files) => {
            if (err) {
                console.error("❌ Ошибка при чтении папки materials:", err);
                reject(err);
            } else {
                const docxFiles = files.filter(file => file.endsWith('.docx'));
                console.log(`📚 Найдено ${docxFiles.length} .docx файлов`);
                resolve(docxFiles);
            }
        });
    });
}

// Функция для экспорта кэша в датасет
async function exportCacheToDataset() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                prompt,
                response,
                created_at,
                (SELECT COUNT(*) FROM gpt_cache WHERE response LIKE '%' || gc.response || '%') as response_frequency
            FROM gpt_cache gc
        `, async (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при чтении кэша:", err);
                reject(err);
                return;
            }

            // Улучшенный формат для файнтюнинга
            const dataset = rows.map(row => ({
                // Основные поля для обучения
                instruction: row.prompt,
                input: "",  // Пустой, так как контекст уже в instruction
                output: row.response,

                // Метаданные для анализа качества
                metadata: {
                    created_at: row.created_at,
                    response_frequency: row.response_frequency,
                    is_factual: !row.response.toLowerCase().includes('как') &&
                        !row.response.toLowerCase().includes('шаг'),
                    response_length: row.response.length,
                    response_type: detectResponseType(row.response)
                }
            }));

            try {
                const datasetDir = path.join(__dirname, "dataset");
                if (!fs.existsSync(datasetDir)) {
                    fs.mkdirSync(datasetDir);
                }

                // Добавляем метаинформацию о датасете
                const datasetInfo = {
                    model: modelName,
                    total_examples: dataset.length,
                    created_at: new Date().toISOString(),
                    format_version: "1.0",
                    examples: dataset
                };

                const timestamp = new Date().toISOString().replace(/[:]/g, '-');
                const filename = path.join(datasetDir, `finetune_dataset_${timestamp}.json`);

                fs.writeFileSync(
                    filename,
                    JSON.stringify(datasetInfo, null, 2),
                    'utf8'
                );

                console.log(`✅ Датасет для файнтюнинга сохранен: ${filename}`);
                console.log(`📊 Статистика:`);
                console.log(`   - Всего примеров: ${dataset.length}`);
                console.log(`   - Фактологических ответов: ${dataset.filter(d => d.metadata.is_factual).length}`);
                console.log(`   - Средняя длина ответа: ${Math.round(dataset.reduce((acc, d) => acc + d.metadata.response_length, 0) / dataset.length)}`);

                resolve(filename);
            } catch (error) {
                console.error("❌ Ошибка при сохранении датасета:", error);
                reject(error);
            }
        });
    });
}

// Вспомогательная функция для определения типа ответа
function detectResponseType(response) {
    if (response.includes('В тексте нет точного ответа')) return 'no_answer';
    if (/\d+/.test(response)) return 'numeric';
    if (response.length < 50) return 'short_factual';
    return 'descriptive';
}

// Функция задержки
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Функция для обновления прогресс-бара
function updateProgress(current, total) {
    const percentage = Math.round((current / total) * 100);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`⏳ Генерация: [${new Array(Math.floor(percentage / 5)).fill('█').join('')}${new Array(20 - Math.floor(percentage / 5)).fill('▒').join('')}] ${percentage}%`);
    // Явный вывод в stdout для телеграм-бота
    process.stdout.write(`PROGRESS: ${current}%\n`);
}

// Генерация промпта на основе контекста
async function generatePromptFromContext(model, text) {
    const truncatedText = truncateText(text);
    const maxAttempts = 3;
    let attempt = 0;

    // Улучшенный метапромпт с примерами
    const metaPrompt = `На основе текста сформулируй ПРОСТОЙ ВОПРОС О ФАКТЕ.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Вопрос должен начинаться ТОЛЬКО с этих слов:
   - "Какой" (пример: "Какой срок действия сертификата?")
   - "Кто" (пример: "Кто является владельцем сертификата?")
   - "Где" (пример: "Где хранится файл сертификата?")
   - "Когда" (пример: "Когда был выпущен документ?")
   - "Сколько" (пример: "Сколько копий нужно сделать?")

2. Вопрос должен быть о КОНКРЕТНОМ факте из текста.
3. Ответ должен быть коротким (дата, число, имя или одно предложение).

ЗАПРЕЩЕНО:
- Вопросы о процедурах ("как", "каким образом")
- Просьбы объяснить или описать
- Вопросы, требующие пошаговых инструкций

Текст для анализа:
${truncatedText}

Сформулируй один простой вопрос о факте:`;

    while (attempt < maxAttempts) {
        attempt++;
        console.log(`\n🎯 Попытка генерации вопроса ${attempt}/${maxAttempts}`);

        const generatedPrompt = await model.generate(metaPrompt, {
            temperature: 0.1, // Снижаем креативность
            top_p: 0.3,      // Ужесточаем выбор токенов
            repeat_penalty: 1.3,
            max_tokens: 30    // Ограничиваем длину вопроса
        });

        // Улучшенная валидация
        const validStarters = {
            'какой': true, 'какая': true, 'какое': true, 'какие': true,
            'кто': true, 'где': true, 'когда': true, 'сколько': true
        };

        const invalidWords = {
            'как': true, 'каким': true, 'что нужно': true, 'опиши': true,
            'объясни': true, 'расскажи': true, 'перечисли': true, 'шаги': true,
            'способ': true, 'образом': true
        };

        const promptWords = generatedPrompt.toLowerCase().split(/\s+/);
        const startsWithValid = validStarters[promptWords[0]];
        const containsInvalid = promptWords.some(word => invalidWords[word]);

        if (startsWithValid && !containsInvalid && promptWords.length <= 15) {
            console.log("✅ Сгенерирован корректный вопрос:", generatedPrompt);
            return generatedPrompt.trim();
        }

        console.log("⚠️ Некорректный вопрос:", generatedPrompt);
        console.log("⏳ Пробуем еще раз...");
        await delay(1000); // Небольшая пауза между попытками
    }

    throw new Error(`Не удалось сгенерировать корректный вопрос после ${maxAttempts} попыток`);
}

// Генерация ответа на основе текста и вопроса
async function generateAnswer(model, text, question) {
    // Обрезаем текст перед формированием промпта
    const truncatedText = truncateText(text);

    const answerPrompt = `Ты работаешь в режиме строгой фактологической проверки. 
Твоя задача - найти в предоставленном тексте ТОЧНЫЙ ответ на вопрос.

ВАЖНЫЕ ПРАВИЛА:
1. Используй ТОЛЬКО информацию из предоставленного текста
2. Если точного ответа нет в тексте - ответь "В тексте нет точного ответа на этот вопрос"
3. НЕ ДОБАВЛЯЙ никакой информации от себя
4. НЕ ПРИДУМЫВАЙ детали
5. Если в тексте есть только частичный ответ - укажи это
6. Цитируй текст там, где это возможно

Текст документа:
${truncatedText}

Вопрос: ${question}

Ответ (строго из текста):`;

    console.log("🤖 Генерируем ответ на основе текста...");

    const response = await model.generate(answerPrompt, {
        temperature: 0.1,
        top_p: 0.5,
        repeat_penalty: 1.2,
        max_tokens: 200
    });

    return response;
}

// Основной процесс
async function main() {
    initDatabase();

    // Инициализируем модель один раз перед циклом
    console.log("🚀 Инициализация GPT4All модели...");
    const gptModel = await initGPT4AllModel();
    if (!gptModel) {
        console.error("❌ Модель GPT4All не инициализирована");
        return;
    }
    console.log("✅ Модель успешно инициализирована");

    while (true) {
        try {
            const files = await getAllDocxFiles();
            if (files.length === 0) {
                console.error("❌ Нет доступных .docx файлов");
                return;
            }

            const randomFile = files[Math.floor(Math.random() * files.length)];
            const filePath = path.join(materialsPath, randomFile);
            console.log(`\n📄 Обработка файла: ${randomFile}`);
            process.stdout.write(`FILE: ${randomFile}\n`);

            const text = await parseDocxToText(filePath);
            if (!text) {
                console.error("❌ Не удалось извлечь текст из файла");
                process.stdout.write(`ERROR: Не удалось извлечь текст\n`);
                continue;
            }

            // Генерируем промпт на основе контекста
            const generatedPrompt = await generatePromptFromContext(gptModel, text);
            process.stdout.write(`PROMPT: ${generatedPrompt.slice(0, 100)}...\n`);

            // Проверяем кэш
            console.log("🔍 Проверяем кэш на схожесть...");
            process.stdout.write(`CACHE_CHECK: Поиск похожих промптов\n`);
            const similarPrompt = await findSimilarPrompt(generatedPrompt);
            if (similarPrompt) {
                console.log("✅ Найдено в кэше:", similarPrompt.response);
                process.stdout.write(`CACHE_HIT: ${similarPrompt.response.slice(0, 100)}...\n`);
                await delay(10000);
                continue;
            }

            // Получаем ответ на сгенерированный промпт
            console.log("🤖 Отправляем сгенерированный промпт модели...");
            process.stdout.write(`MODEL_REQUEST: Генерация ответа\n`);
            const response = await generateAnswer(gptModel, text, generatedPrompt);

            if (!response) {
                console.error("❌ Не удалось получить ответ от модели");
                process.stdout.write(`ERROR: Не получен ответ от модели\n`);
                continue;
            }

            // Валидация ответа
            if (response.toLowerCase().includes('шаг') ||
                response.toLowerCase().includes('команд') ||
                response.toLowerCase().includes('выполните') ||
                response.toLowerCase().includes('откройте')) {
                console.log("⚠️ Обнаружена потенциальная отсебятина в ответе, пропускаем...");
                process.stdout.write(`SKIP: Потенциальная отсебятина\n`);
                continue;
            }

            console.log("📨 Ответ от модели:", response);
            process.stdout.write(`RESPONSE: ${response.slice(0, 200)}...\n`);
            await cacheResponse(generatedPrompt, response, text);

            console.log("😴 Ждем 10 секунд перед следующей итерацией...\n");
            process.stdout.write(`WAIT: Следующая итерация через 10 сек\n`);
            await delay(10000);

        } catch (error) {
            console.error("❌ Ошибка в итерации:", error);
            process.stdout.write(`CRITICAL_ERROR: ${error.message}\n`);
            await delay(5000);
        }
    }
}

// Обновленный обработчик SIGINT
process.on('SIGINT', async () => {
    console.log('\n👋 Получен сигнал завершения...');

    try {
        console.log('📥 Экспортируем кэш в датасет...');
        await exportCacheToDataset();

        console.log('🔒 Закрываем соединение с БД...');
        db.close();

        console.log('✅ Завершение работы');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

// Запускаем процесс
main().catch((err) => {
    console.error("❌ Критическая ошибка:", err);
    db.close();
});