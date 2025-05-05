const gpt4all = require("gpt4all");

async function testGPT4All() {
    try {
        console.log("Инициализация модели...");
        const model = await gpt4all.loadModel("Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf");

        console.log("Модель загружена. Начинаю генерацию...");

        const prompt = "Привет!"; // Используем простой промпт для ускорения генерации
        let generatedText = "";

        // Устанавливаем таймаут для предотвращения зависания
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Генерация превысила лимит времени (1 минута)")), 60000)
        );

        // Используем on_token для обработки токенов в реальном времени
        const generation = model.generate(prompt, {
            maxTokens: 20, // Ограничиваем длину генерации для ускорения
            temp: 0.7,     // Температура
            on_token: (token) => {
                console.log("Получен токен:", token); // Логируем каждый токен
                generatedText += token;
                process.stdout.write(token); // Выводим токены в реальном времени
            }
        });

        await Promise.race([generation, timeout]); // Ждем завершения генерации или таймаута

        console.log("\nГенерация завершена.");
        console.log("Сгенерированный текст:", generatedText || "Текст отсутствует");
    } catch (error) {
        console.error("Ошибка при работе с GPT4All:", error);
    }
}

testGPT4All();