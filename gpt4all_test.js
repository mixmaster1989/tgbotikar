const gpt4all = require("gpt4all");
const path = require("path");
const os = require("os");
const fs = require("fs");

async function testGpt4All() {
  const modelFileName = "mistral-7b-instruct-v0.1.Q4_0.gguf";
  const modelPath = path.join(os.homedir(), ".cache", "gpt4all", modelFileName);

  if (!fs.existsSync(modelPath)) {
    console.log("Модель не найдена, пожалуйста, скачайте вручную:");
    console.log(`wget -P ~/.cache/gpt4all https://gpt4all.io/models/gguf/${modelFileName}`);
    return;
  }

  try {
    const instance = new gpt4all.GPT4All(modelFileName, {
      modelPath: path.dirname(modelPath),
      verbose: true,
    });

    console.log("Загрузка модели...");
    await instance.open();

    console.log("Отправка тестового запроса...");
    const response = await instance.chat("Привет, что ты умеешь?");
    console.log("Ответ модели:", response);

    await instance.close();
  } catch (err) {
    console.error("Ошибка в тесте GPT4All:", err);
  }
}

testGpt4All();
