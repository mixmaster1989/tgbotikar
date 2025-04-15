const fs = require("fs");
const path = require("path");
const { Markup } = require("telegraf");
const { yadisk, db } = require("./services");
const { generateAIQuestions, parseDocxToText, parseTestResponse } = require("./utils");

async function syncMaterials() {
  try {
    console.log("Начинаем синхронизацию с Яндекс.Диском...");
    const response = await fetch("https://cloud-api.yandex.net/v1/disk/resources/files", {
      headers: { Authorization: `OAuth ${process.env.YA_DISK_TOKEN}` },
    });

    if (!response.ok) throw new Error("Ошибка при синхронизации с Яндекс.Диском");

    const data = await response.json();
    console.log(`Синхронизация завершена. Найдено файлов: ${data.items.length}`);
    return data.items.map(item => item.name);
  } catch (err) {
    console.error("Ошибка синхронизации материалов:", err);
    return [];
  }
}

function saveToCache(question, answer) {
  try {
    console.log("Сохраняем вопрос-ответ в кэш...");
    const stmt = db.prepare("INSERT OR REPLACE INTO gpt_cache (prompt, response) VALUES (?, ?)");
    stmt.run(question, answer);
    stmt.finalize();
    console.log("Вопрос-ответ успешно сохранены в кэш.");
  } catch (err) {
    console.error("Ошибка сохранения в кэш:", err);
  }
}

async function generateCache(ctx) {
  try {
    console.log("Запуск генерации кэша...");
    const files = await syncMaterials();
    if (!files.length) {
      console.log("Нет материалов для генерации кэша.");
      return ctx.reply("Нет материалов для генерации кэша.");
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = path.join(process.env.MATERIALS_PATH, randomFile);

    console.log(`Выбран файл для генерации: ${randomFile}`);
    const content = await parseDocxToText(filePath);
    console.log("Текст статьи успешно извлечён.");

    const questionResponse = await generateAIQuestions(content);
    const parsed = parseTestResponse(questionResponse);

    // Сохраняем в кэш
    saveToCache(parsed.question, parsed.correct);

    // Сохраняем на Яндекс.Диск
    const jsonFilePath = path.join(__dirname, "cache", `${randomFile.replace(".docx", "")}.json`);
    const jsonData = {
      question: parsed.question,
      answers: parsed.answers,
      correct: parsed.correct,
    };
    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData, null, 2));

    console.log(`Файл JSON успешно сохранён на диск: ${jsonFilePath}`);
    await yadisk.uploadFile(jsonFilePath, `/cache/${path.basename(jsonFilePath)}`);
    console.log("Файл успешно загружен на Яндекс.Диск.");

    await ctx.reply("Кэш сгенерирован и сохранён.");
    await ctx.reply("Выберите действие:", mainMenuKeyboard());
  } catch (err) {
    console.error("Ошибка при генерации кэша:", err);
    await ctx.reply("Произошла ошибка при генерации кэша.");
  }
}

// Обработчик для кнопки "Генерация кэша"
bot.action("generate_cache", generateCache);

// Обработчик для кнопки "Просмотр кэша"
bot.action("cache_ops", async (ctx) => {
  try {
    console.log("Загружаем список кэшей с Я.Диска...");
    const files = await yadisk.syncMaterials();
    const cacheFiles = files.filter(file => file.endsWith(".json"));
    if (cacheFiles.length === 0) {
      console.log("Нет сохранённого кэша.");
      return ctx.reply("Нет сохранённого кэша.");
    }

    console.log(`Найдено файлов кэша: ${cacheFiles.length}`);
    const buttons = cacheFiles.map(f => [Markup.button.callback(f, `open_cache_${f}`)]);
    buttons.push([Markup.button.callback("🔄 Резет", "reset")]);

    await ctx.reply("Выберите кэш:", Markup.inlineKeyboard(buttons));
  } catch (err) {
    console.error("Ошибка загрузки кэша с Я.Диска:", err);
    await ctx.reply("Произошла ошибка при загрузке кэша.");
  }
});

// Обработчик для открытия выбранного кэша
bot.action(/open_cache_(.+)/, async (ctx) => {
  const fileName = ctx.match[1];
  const filePath = path.join(__dirname, "cache", fileName);
  try {
    console.log(`Открываем файл кэша: ${fileName}`);
    await ctx.replyWithDocument({ source: filePath, filename: fileName });
  } catch (err) {
    console.error("Ошибка при отправке файла:", err);
    await ctx.reply("Произошла ошибка при отправке файла.");
  }
});
