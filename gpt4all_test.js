const { loadModel, createCompletion } = require("gpt4all");

async function testGpt4All() {
    try {
        const model = await loadModel("mistral-7b-instruct-v0.1.Q4_0.gguf", {
            device: "cpu",
            nCtx: 2048,
            verbose: true,
        });

        const chat = await model.createChatSession({
            temperature: 0.7,
            systemPrompt: "Ты дружелюбный помощник.",
        });

        const prompt = "Придумай короткую мотивационную фразу на день.";
        const response = await createCompletion(chat, prompt);

        console.log("\nОтвет от модели:");
        console.log(response.choices[0].message.content);

        model.dispose();
    } catch (err) {
        console.error("Ошибка в тесте GPT4All:", err);
    }
}

testGpt4All();
