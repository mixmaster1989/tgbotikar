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
            generate: async (prompt) => {
                try {
                    const answer = await model.generate(prompt);
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

                rows.forEach((row) => {
                    const similarity = levenshteinDistance(prompt, row.prompt);
                    if (similarity > highestSimilarity) {
                        highestSimilarity = similarity;
                        bestMatch = row;
                    }
                });

                if (highestSimilarity > 0.8) { // Порог схожести
                    console.log(`✅ Найден похожий промпт с коэффициентом схожести ${highestSimilarity}`);
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

// Основной процесс
async function main() {
    initDatabase();

    while (true) { // Бесконечный цикл
        try {
            const files = await getAllDocxFiles();
            if (files.length === 0) {
                console.error("❌ Нет доступных .docx файлов");
                return;
            }

            // Случайный выбор файла
            const randomFile = files[Math.floor(Math.random() * files.length)];
            const filePath = path.join(materialsPath, randomFile);
            console.log(`\n📄 Обработка файла: ${randomFile}`);

            const text = await parseDocxToText(filePath);
            if (!text) {
                console.error("❌ Не удалось извлечь текст из файла");
                continue;
            }

            const gptModel = await initGPT4AllModel();
            if (!gptModel) {
                console.error("❌ Модель GPT4All не инициализирована");
                continue;
            }

            // Генерируем различные типы промптов
            const prompts = [
                `обьясни, о чем тут на русском языке:\n\n${text}`,
                `Какова основная мысль текста?:\n\n${text}`,
                `Объясни используемые в тексте термины:\n\n${text}`,
                `Создай концепцию на основе тескта:\n\n${text}`,
                `Расскажи о ККТ в целом:\n\n${text}`
            ];

            // Выбираем случайный промпт
            const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
            console.log("\n📝 Выбран промпт:", randomPrompt.split('\n')[0]);

            // Проверяем кэш
            console.log("🔍 Проверяем кэш на схожесть...");
            const similarPrompt = await findSimilarPrompt(randomPrompt);
            if (similarPrompt) {
                console.log("✅ Найдено в кэше:", similarPrompt.response);
                // Делаем паузу перед следующей итерацией
                await delay(10000); // 10 секунд
                continue;
            }

            console.log("🤖 Отправляем запрос к модели...");
            const response = await gptModel.generate(randomPrompt);

            if (!response) {
                console.error("❌ Не удалось получить ответ от модели");
                continue;
            }

            console.log("📨 Ответ от модели:", response);
            await cacheResponse(randomPrompt, response);

            // Делаем паузу перед следующей итерацией
            console.log("😴 Ждем 10 секунд перед следующей итерацией...\n");
            await delay(10000); // 10 секунд

        } catch (error) {
            console.error("❌ Ошибка в итерации:", error);
            await delay(5000); // 5 секунд паузы при ошибке
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