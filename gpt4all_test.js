const { loadModel, createCompletion } = require("gpt4all");

async function main() {
    // Загрузка модели
    const model = await loadModel("mistral-7b-instruct-v0.1.Q4_0.gguf", {
        verbose: true,
        device: "cpu",
        nCtx: 2048,
    });

    // Создание сессии чата
    const chat = await model.createChatSession({
        temperature: 0.7,
        systemPrompt: "Ты helpful AI ассистент. Отвечай кратко и по существу.",
    });

    // Отправка промпта и получение ответа
    const prompt = "Расскажи короткую историю о программисте";
    const response = await createCompletion(chat, prompt);

    console.log("Ответ модели:");
    console.log(response.choices[0].message.content);

    // Освобождение ресурсов
    model.dispose();
}

main().catch(console.error);
