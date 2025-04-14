const gpt4all = require("gpt4all");

async function testGPT4All() {
    try {
        console.log("Инициализация модели...");
        const model = await gpt4all.loadModel("Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf");

        console.log("Модель загружена. Начинаю генерацию...");

        const prompt = "Привет! Как дела?";
        let generatedText = "";

        // Используем on_token для обработки токенов в реальном времени
        await model.generate(prompt, {
            maxTokens: 50, // Ограничиваем длину генерации
            temp: 0.7,     // Температура
            on_token: (token) => {
                generatedText += token;
                process.stdout.write(token); // Выводим токены в реальном времени
            }
        });

        console.log("\nГенерация завершена.");
        console.log("Сгенерированный текст:", generatedText);
    } catch (error) {
        console.error("Ошибка при работе с GPT4All:", error);
    }
}

testGPT4All();