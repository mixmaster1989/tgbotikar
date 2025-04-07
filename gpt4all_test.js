const { loadModel, createCompletion } = require("gpt4all");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const { promisify } = require("util");
const pipeline = promisify(require("stream").pipeline);

async function waitForFileDownload(filePath, maxWaitTime = 600000) {
  // 10 минут максимум
  const startTime = Date.now();
  while (true) {
    if (fs.existsSync(filePath) && !filePath.endsWith(".part")) {
      return true;
    }

    if (Date.now() - startTime > maxWaitTime) {
      throw new Error(`Превышено время ожидания загрузки файла: ${filePath}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000)); // Ждем 5 секунд
  }
}

function diagnosePaths(outputPath) {
  const pathOptions = [
    {
      name: "Домашняя директория (os.homedir())",
      path: path.join(
        os.homedir(),
        ".cache",
        "gpt4all",
        path.basename(outputPath)
      ),
    },
    {
      name: "Текущий путь",
      path: outputPath,
    },
    {
      name: "Абсолютный путь из outputPath",
      path: path.resolve(outputPath),
    },
    {
      name: "Директория проекта",
      path: path.join(process.cwd(), "models", path.basename(outputPath)),
    },
  ];

  console.log("Варианты путей для загрузки модели:");
  pathOptions.forEach((option, index) => {
    console.log(`${index + 1}. ${option.name}:`);
    console.log(`   ${option.path}`);
    console.log(
      `   Существует: ${
        fs.existsSync(path.dirname(option.path)) ? "Да" : "Нет"
      }`
    );
  });

  return pathOptions;
}

async function downloadModelFile(url, outputPath) {
  console.log(`Начало загрузки модели: ${url}`);
  console.log(`Путь сохранения: ${outputPath}`);

  // Диагностика путей перед загрузкой
  const pathOptions = diagnosePaths(outputPath);

  // Создаем директорию, если она не существует
  const modelDir = path.dirname(outputPath);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  // Создаем точный путь для временного файла в том же каталоге
  const partFilePath = path.join(modelDir, path.basename(outputPath) + ".part");
  console.log(`Временный файл: ${partFilePath}`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let downloadedBytes = 0;
    let totalBytes = 0;

    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки: ${response.statusCode}`));
          return;
        }

        totalBytes = parseInt(response.headers["content-length"], 10);
        console.log(`Размер файла: ${totalBytes} байт`);

        const writeStream = fs.createWriteStream(partFilePath);

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(2);
          const elapsedTime = (Date.now() - startTime) / 1000;
          const speed = (downloadedBytes / elapsedTime / 1024 / 1024).toFixed(
            2
          );

          process.stdout.write(
            `Загружено: ${percent}% (${downloadedBytes}/${totalBytes} байт), Скорость: ${speed} МБ/с\r`
          );
        });

        response.pipe(writeStream);

        writeStream.on("finish", () => {
          writeStream.close();
          // Переименовываем part-файл в финальный
          fs.renameSync(partFilePath, outputPath);
          console.log(`\nЗагрузка завершена: ${outputPath}`);
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

// Функция для проверки и загрузки модели
const fs = require('fs');
const modelPath = '/home/user1/.cache/gpt4all/mistral-7b-instruct-v0.1.Q4_0.gguf';

if (!fs.existsSync(modelPath)) {
    console.log('Модель не найдена, загружаем...');
    // Код для загрузки модели
} else {
    console.log('Модель найдена, продолжаем работу...');
}

async function ensureModelDownloaded() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const modelPath = path.join(modelDir, "mistral-7b-instruct-v0.1.Q4_0.gguf");
  const modelUrl =
    "https://gpt4all.io/models/gguf/mistral-7b-instruct-v0.1.Q4_0.gguf";

  // Создаем директорию, если она не существует
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  if (!fs.existsSync(modelPath)) {
    console.log("Модель не найдена. Начинаем загрузку...");
    try {
      await downloadModelFile(modelUrl, modelPath);
    } catch (error) {
      console.error("Не удалось загрузить модель:", error);
      throw error;
    }
  } else {
    console.log("Модель уже существует:", modelPath);
  }
}

async function testGPT4All() {
  let model = null;
  try {
    console.log("Инициализация GPT4All...");
    const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
    const modelPath = path.join(modelDir, "mistral-7b-instruct-v0.1.Q4_0.gguf");
    const configPath = path.join(modelDir, "models3.json");

    console.log("Полный путь к модели:", modelPath);
    console.log("Путь к конфигурации:", configPath);

    // Проверяем существование файлов
    if (!fs.existsSync(modelPath)) {
      console.error(`ОШИБКА: Файл модели не найден по пути: ${modelPath}`);
      console.error("Содержимое директории:", fs.readdirSync(modelDir));
      throw new Error(`Файл модели не найден: ${modelPath}`);
    }

    if (!fs.existsSync(configPath)) {
      console.error(
        `ОШИБКА: Файл конфигурации не найден по пути: ${configPath}`
      );
      throw new Error(`Файл конфигурации не найден: ${configPath}`);
    }

    // Получаем статистику файлов
    const modelStats = fs.statSync(modelPath);
    const configStats = fs.statSync(configPath);
    console.log("Размер файла модели:", modelStats.size, "байт");
    console.log("Размер файла конфигурации:", configStats.size, "байт");

    // Загрузка модели с явным указанием путей
    model = await loadModel(modelPath, {
      verbose: true,
      device: "cpu",
      modelConfigFile: configPath,
      cacheDir: modelDir,
    });

    // Создание chat-сессии
    const chat = await model.createChatSession({
      temperature: 0.7,
      systemPrompt: "Ты helpful AI ассистент. Отвечай кратко и по существу.",
    });

    // Тестовый промпт
    const prompt = "Расскажи короткую историю о программисте";
    console.log(`Отправляем промпт: ${prompt}`);

    const response = await createCompletion(chat, prompt);

    console.log("Ответ модели:");
    console.log(response.choices[0].message.content);

    // Освобождаем ресурсы
    model.dispose();

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Ошибка при работе с GPT4All:", error);
    console.error("Детали ошибки:", error.stack);

    // Освобождаем ресурсы в случае ошибки
    if (model) {
      model.dispose();
    }

    throw error;
  }
}

// Функция для проверки доступности модели
function checkModelAvailability() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const modelPath = path.join(modelDir, "mistral-7b-instruct-v0.1.Q4_0.gguf");
  const configPath = path.join(modelDir, "models3.json");

  console.log("Проверка доступности модели и конфигурации...");
  console.log("Директория моделей:", modelDir);

  try {
    const files = fs.readdirSync(modelDir);
    console.log("Файлы в директории:", files);
  } catch (error) {
    console.error("Ошибка чтения директории:", error);
  }

  if (!fs.existsSync(modelPath)) {
    console.error(`ВНИМАНИЕ: Файл модели не найден: ${modelPath}`);
  } else {
    console.log(`Файл модели найден: ${modelPath}`);
  }

  if (!fs.existsSync(configPath)) {
    console.error(`ВНИМАНИЕ: Файл конфигурации не найден: ${configPath}`);
  } else {
    console.log(`Файл конфигурации найден: ${configPath}`);
  }
}

// Функция для предварительной загрузки конфигурации моделей
async function downloadModelConfig() {
  const modelDir = path.join(os.homedir(), ".cache", "gpt4all");
  const configPath = path.join(modelDir, "models3.json");

  if (!fs.existsSync(configPath)) {
    console.log("Загрузка конфигурации моделей...");
    try {
      const { execSync } = require("child_process");
      execSync(
        `curl -L https://gpt4all.io/models/models3.json -o ${configPath}`
      );
      console.log("Конфигурация моделей загружена");
    } catch (error) {
      console.error("Ошибка загрузки конфигурации:", error);
    }
  }
}

// Немедленный запуск теста при выполнении скрипта
if (require.main === module) {
  (async () => {
    try {
      checkModelAvailability();
      await downloadModelConfig();
      await ensureModelDownloaded();
      await testGPT4All();
      console.log("Тест GPT4All завершен успешно");
    } catch (err) {
      console.error("Ошибка в тесте GPT4All:", err);
    }
  })();
}

// Экспортируем функции для использования в других модулях
module.exports = {
  testGPT4All,
  waitForFileDownload,
  downloadModelConfig,
  checkModelAvailability,
  ensureModelDownloaded,
  downloadModelFile,
};
