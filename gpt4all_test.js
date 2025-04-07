const { loadModel, createCompletion } = require("gpt4all");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");

async function downloadModelFile(url, outputPath) {
  console.log(`Начало загрузки модели: ${url}`);
  console.log(`Путь сохранения: ${outputPath}`);

  return new Promise((resolve, reject) => {
    const partFilePath = outputPath + ".part";
    const writeStream = fs.createWriteStream(partFilePath);

    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки: ${response.statusCode}`));
          return;
        }

        response.pipe(writeStream);

        writeStream.on("finish", () => {
          writeStream.close();
          fs.renameSync(partFilePath, outputPath);
          console.log(`Загрузка завершена: ${outputPath}`);
          resolve(outputPath);
        });

        writeStream.on("error", (err) => {
          console.error("Ошибка записи файла:", err);
          reject(err);
        });
      })
      .on("error", (err) => {
        console.error("Ошибка загрузки:", err);
        reject(err);
      });
  });
}

async function ensureModelDownloaded() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const modelPath = path.join(modelDir, "mistral-7b-instruct-v0.1.Q4_0.gguf");
  const modelUrl = "https://gpt4all.io/models/gguf/mistral-7b-instruct-v0.1.Q4_0.gguf";
  return downloadModelFile(modelUrl, modelPath);
}

async function downloadModelConfig() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const configPath = path.join(modelDir, "models3.json");
  const { execSync } = require("child_process");
  execSync(`curl -L https://gpt4all.io/models/models3.json -o ${configPath}`);
}

async function testGPT4All() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const modelPath = path.join(modelDir, "mistral-7b-instruct-v0.1.Q4_0.gguf");
  const configPath = path.join(modelDir, "models3.json");

  const model = await loadModel(modelPath, {
    verbose: true,
    device: "cpu",
    modelConfigFile: configPath,
    cacheDir: modelDir,
  });

  const chat = await model.createChatSession({
    temperature: 0.7,
    systemPrompt: "Ты helpful AI ассистент. Отвечай кратко и по существу.",
  });

  const prompt = "Расскажи короткую историю о программисте";
  const response = await createCompletion(chat, prompt);

  console.log("Ответ модели:");
  console.log(response.choices[0].message.content);

  model.dispose();
  return response.choices[0].message.content;
}

if (require.main === module) {
  (async () => {
    try {
      await downloadModelConfig();
      await ensureModelDownloaded();
      await testGPT4All();
      console.log("Тест GPT4All завершен успешно");
    } catch (err) {
      console.error("Ошибка в тесте GPT4All:", err);
    }
  })();
}

module.exports = {
  testGPT4All,
  downloadModelConfig,
  ensureModelDownloaded,
  downloadModelFile,
};
