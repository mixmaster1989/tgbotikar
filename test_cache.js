const sqlite3 = require("sqlite3").verbose();
const mammoth = require("mammoth");
const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");

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
function cacheResponse(prompt, response) {
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

// Основной процесс
async function main() {
    initDatabase();

    const filePath = path.join(materialsPath, "1.docx"); // Указываем тестовый файл
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

    // Первый этап: Генерация промпта для создания теста
    const promptForPrompt = `Прочитай текст и сгенерируй промпт для создания теста по материалу. Промпт должен быть на русском языке и содержать четкие инструкции для генерации теста.\n\nТекст:\n${text}`;
    console.log("Отправляем запрос к модели для генерации промпта...");
    const generatedPromptResponse = await gptModel.generate(promptForPrompt);

    if (!generatedPromptResponse) {
        console.error("❌ Не удалось получить сгенерированный промпт от модели");
        return;
    }

    console.log("Сгенерированный промпт:", generatedPromptResponse);

    // Парсим сгенерированный промпт
    const generatedPrompt = generatedPromptResponse.trim(); // Здесь можно добавить дополнительный парсинг, если нужно

    // Второй этап: Генерация теста по сгенерированному промпту
    console.log("Отправляем запрос к модели для генерации теста...");
    const testResponse = await gptModel.generate(generatedPrompt);

    if (!testResponse) {
        console.error("❌ Не удалось получить тест от модели");
        return;
    }

    console.log("Сгенерированный тест:", testResponse);

    // Сохраняем результат в кэш
    await cacheResponse(generatedPrompt, testResponse);

    console.log("✅ Процесс завершен. Проверьте содержимое кэша.");
    db.close();
}

main().catch((err) => {
    console.error("❌ Критическая ошибка:", err);
    db.close();
});