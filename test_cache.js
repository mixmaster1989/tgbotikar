const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");
const use = require('@tensorflow-models/universal-sentence-encoder');
const tf = require('@tensorflow/tfjs-node'); // Явно подключаем TensorFlow.js

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
            vector BLOB,
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

// Инициализация модели эмбеддингов
let embedder;
async function initEmbedder() {
    console.log("Инициализация модели эмбеддингов...");
    embedder = await use.load();
    console.log("✅ Модель эмбеддингов инициализирована");
}

// Преобразование текста в вектор
async function getVector(text) {
    if (!embedder) {
        console.error("❌ Модель эмбеддингов не инициализирована");
        return null;
    }
    const embeddings = await embedder.embed([text]);
    return embeddings.arraySync()[0]; // Возвращаем вектор
}

// Сохранение результата в кэш
async function cacheResponse(prompt, response) {
    const vector = await getVector(prompt); // Преобразуем промпт в вектор
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO gpt_cache (prompt, response, vector) VALUES (?, ?, ?)",
            [prompt, response, JSON.stringify(vector)], // Сохраняем вектор как JSON
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

// Поиск похожего промпта
async function findSimilarPrompt(prompt) {
    const vector = await getVector(prompt); // Преобразуем новый промпт в вектор
    return new Promise((resolve, reject) => {
        db.all("SELECT prompt, response, vector FROM gpt_cache", (err, rows) => {
            if (err) {
                console.error("❌ Ошибка при запросе кэша:", err);
                reject(err);
            } else {
                let bestMatch = null;
                let highestSimilarity = 0;

                rows.forEach((row) => {
                    const cachedVector = JSON.parse(row.vector);
                    const similarity = cosineSimilarity(vector, cachedVector); // Сравниваем векторы
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

// Функция для вычисления косинусной схожести
function cosineSimilarity(vec1, vec2) {
    const dotProduct = vec1.reduce((sum, v, i) => sum + v * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, v) => sum + v * v, 0));
    return dotProduct / (magnitude1 * magnitude2);
}

// Основной процесс
async function main() {
    initDatabase();
    await initEmbedder();

    const filePath = path.join(materialsPath, "1.docx");
    const text = await parseDocxToText(filePath);

    if (!text) {
        console.error("❌ Не удалось извлечь текст из файла");
        return;
    }

    const gptModel = await initGPT4AllModel();
    if (!gptModel) {
        console.error("❌ Модель GPT4All не инициализирована");
        return;
    }

    const prompt = `Создай краткое резюме текста на русском языке:\n\n${text}`;

    // Проверяем кэш на схожий промпт
    console.log("Проверяем кэш на схожесть...");
    const similarPrompt = await findSimilarPrompt(prompt);
    if (similarPrompt) {
        console.log("✅ Найдено в кэше:", similarPrompt.response);
        return;
    }

    console.log("Отправляем запрос к модели...");
    const response = await gptModel.generate(prompt);

    if (!response) {
        console.error("❌ Не удалось получить ответ от модели");
        return;
    }

    console.log("Ответ от модели:", response);

    await cacheResponse(prompt, response);

    console.log("✅ Процесс завершен. Проверьте содержимое кэша.");
    db.close();
}

main().catch((err) => {
    console.error("❌ Критическая ошибка:", err);
    db.close();
});