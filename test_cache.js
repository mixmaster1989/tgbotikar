const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Константы
const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
const materialsPath = path.join(__dirname, "materials");
const db = new sqlite3.Database("database.sqlite");

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

// Инициализация GPT4All модели
async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");
        const model = await gpt4all.loadModel(modelName);
        return {
            generate: async (prompt, options = {}) => {
                try {
                    const answer = await model.generate(prompt, options);
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
async function cacheResponse(prompt, response) {
    return new Promise((resolve, reject) => {
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
        db.all("SELECT prompt, response FROM gpt_cache", async (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при чтении кэша:", err);
                reject(err);
                return;
            }

            // Преобразуем данные в формат для обучения
            const dataset = rows.map(row => ({
                instruction: row.prompt,
                input: "",  // Можно оставить пустым, так как контекст уже в instruction
                output: row.response,
                history: [] // История диалога (пустая для однократных запросов)
            }));

            try {
                // Создаем папку для датасета, если её нет
                const datasetDir = path.join(__dirname, "dataset");
                if (!fs.existsSync(datasetDir)) {
                    fs.mkdirSync(datasetDir);
                }

                // Сохраняем датасет в JSON файл
                const timestamp = new Date().toISOString().replace(/[:]/g, '-');
                const filename = path.join(datasetDir, `dataset_${timestamp}.json`);

                fs.writeFileSync(
                    filename,
                    JSON.stringify(dataset, null, 2),
                    'utf8'
                );

                console.log(`✅ Датасет сохранен в файл: ${filename}`);
                console.log(`📊 Количество примеров: ${dataset.length}`);

                resolve(filename);
            } catch (error) {
                console.error("❌ Ошибка при сохранении датасета:", error);
                reject(error);
            }
        });
    });
}

// Функция задержки
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Генерация промпта на основе контекста
async function generatePromptFromContext(model, text) {
    const metaPrompt = `На основе приведённого текста сформулируй вопрос, на который можно дать точный ответ, используя только информацию из этого текста. Не добавляй внешние сведения и не фантазируй. Ответ должен быть строго внутри текста.

Текст для анализа:
${text}

Сформулируй вопрос:`;

    console.log("🤖 Генерируем промпт на основе контекста...");
    const generatedPrompt = await model.generate(metaPrompt, {
        temperature: 0.3,
        top_p: 0.9,
        repeat_penalty: 1.15
    });

    if (!generatedPrompt) {
        throw new Error("Не удалось сгенерировать промпт");
    }

    console.log("📝 Сгенерированный промпт:", generatedPrompt);
    return generatedPrompt;
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

            const text = await parseDocxToText(filePath);
            if (!text) {
                console.error("❌ Не удалось извлечь текст из файла");
                continue;
            }

            // Генерируем промпт на основе контекста
            const generatedPrompt = await generatePromptFromContext(gptModel, text);

            // Проверяем кэш
            console.log("🔍 Проверяем кэш на схожесть...");
            const similarPrompt = await findSimilarPrompt(generatedPrompt);
            if (similarPrompt) {
                console.log("✅ Найдено в кэше:", similarPrompt.response);
                await delay(10000);
                continue;
            }

            // Получаем ответ на сгенерированный промпт
            console.log("🤖 Отправляем сгенерированный промпт модели...");
            const response = await gptModel.generate(generatedPrompt);

            if (!response) {
                console.error("❌ Не удалось получить ответ от модели");
                continue;
            }

            console.log("📨 Ответ от модели:", response);
            await cacheResponse(generatedPrompt, response);

            console.log("😴 Ждем 10 секунд перед следующей итерацией...\n");
            await delay(10000);

        } catch (error) {
            console.error("❌ Ошибка в итерации:", error);
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