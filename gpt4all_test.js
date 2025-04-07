const { GPT4All } = require("gpt4all");
const path = require("path");
const os = require("os");
const fs = require("fs");

async function testGpt4All() {
  // Название модели
  const modelFileName = "mistral-7b-instruct-v0.1.Q4_0.gguf";

  // Путь к модели
  const modelPath = path.join(os.homedir(), ".cache", "gpt4all", modelFileName);

  // Проверка наличия модели
  if (!fs.existsSync(modelPath)) {
    console.log("Модель не найдена, пожалуйста, скачайте вручную:");
    console.log(`wget -P ~/.cache/gpt4all https://gpt4all.io/models/gguf/${modelFileName}`);
    return;
  }

  try {
    const gpt4all = new GPT4All(modelFileName, {
      modelPath: path.dirname(modelPath),
      verbose: true,
    });

    console.log("Загрузка модели...");
    await gpt4all.open();

    console.log("Отправка тестового запроса...");
    const response = await gpt4all.chat("Привет, что ты умеешь?");
    console.log("Ответ модели:", response);

    await gpt4all.close();
  } catch (err) {
    console.error("Ошибка в тесте GPT4All:", err);
  }
}

testGpt4All();
