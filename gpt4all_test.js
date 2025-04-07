const { GPT4All } = require("gpt4all");

async function testGpt4All() {
  const modelPath = '/home/user1/.cache/gpt4all/mistral-7b-instruct-v0.1.Q4_0.gguf';
  const model = await GPT4All.load(modelPath, {
    device: "cpu",
    nCtx: 512,  // Уменьшили размер контекста
    ngl: 20,    // Уменьшили количество токенов для генерации
    verbose: true,
  });

  const prompt = "Привет, как ты?";

  console.log("Отправляем запрос модели...");
  
  // Генерация ответа с выводом токенов по мере их получения
  await model.createCompletion({
    prompt: prompt,
    onToken: (token) => process.stdout.write(token),  // Выводим каждый токен сразу
  });

  console.log("\nЗавершение генерации...");
}

testGpt4All().catch((error) => {
  console.error("Ошибка в тесте GPT4All:", error);
});
