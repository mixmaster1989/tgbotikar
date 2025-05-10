// Импортируем модули для работы с файлами и путями
const fs = require("fs-extra");
const path = require("path");
const tesseract = require("tesseract.js");

// Импортируем Markup для создания кнопок в Telegraf
const { Markup } = require("telegraf");

// Импортируем функции для работы с OCR
const { getTemplates } = require("./templates"); // Получение шаблонов OCR
const { mergeOcrResultsNoDuplicates } = require("./scoring"); // Объединение результатов OCR без дубликатов

// Импортируем логгер для записи ошибок и информации
const logger = require("../logger");

// Определяем путь к временной папке для сохранения изображений
const tempPath = path.join(__dirname, "..", "..", "temp");

// Функция для регистрации обработчиков OCR
function registerOcrHandlers(bot) {
  // Обработчик загрузки фото пользователем
  bot.on("photo", async (ctx) => {
    // Получаем последнее фото из массива (самое большое по размеру)
    const photo = ctx.message.photo.pop();

    // Получаем уникальный идентификатор файла
    const fileId = photo.file_id;

    // Получаем ссылку на файл с помощью Telegram API
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Формируем путь для сохранения файла во временной папке
    const filePath = path.join(tempPath, `${ctx.from.id}_${Date.now()}.jpg`);

    // Убеждаемся, что временная папка существует
    await fs.ensureDir(tempPath);

    // Загружаем файл по ссылке
    const res = await fetch(fileLink.href);
    const buffer = await res.arrayBuffer();

    // Сохраняем файл на диск
    await fs.writeFile(filePath, Buffer.from(buffer));

    // Сохраняем путь к последнему фото в сессии пользователя
    ctx.session.lastPhotoPath = filePath;

    // Отправляем пользователю сообщение с кнопкой для выбора способа обработки OCR
    await ctx.reply("Выберите способ обработки OCR:", Markup.inlineKeyboard([
      [{ text: 'Распознать всеми шаблонами', callback_data: 'ocr_all_templates' }]
    ]));
  });

  // Обработчик кнопки "Распознать всеми шаблонами"
  bot.action("ocr_all_templates", async (ctx) => {
    try {
      // Получаем путь к последнему фото из сессии пользователя
      const filePath = ctx.session && ctx.session.lastPhotoPath;

      // Проверяем, существует ли файл
      if (!filePath || !fs.existsSync(filePath)) {
        await ctx.reply("Нет последнего фото для распознавания.");
        return;
      }

      // Получаем список шаблонов для OCR
      const templates = getTemplates();

      // Массив для хранения результатов OCR
      const allResults = [];

      // Обрабатываем фото каждым шаблоном
      for (const tpl of templates) {
        // Импортируем функцию для распознавания текста с использованием шаблона
        const { recognizeTextWithTemplateTesseract } = require("./pipeline");

        // Распознаем текст с текущим шаблоном
        const tesseractText = await recognizeTextWithTemplateTesseract(filePath, tpl.pre, tpl.post);

        // Сохраняем результат в массив
        allResults.push({ tplName: tpl.name, text: tesseractText });
      }

      // Объединяем результаты всех шаблонов, удаляя дубликаты
      const mergedText = mergeOcrResultsNoDuplicates(allResults);

      // Отправляем пользователю итоговый текст
      await ctx.replyWithHTML(`<b>📋 Итоговый текст:</b>\n\n<pre>${mergedText}</pre>`);
    } catch (e) {
      // Логируем ошибку и отправляем сообщение пользователю
      logger.error("Ошибка OCR: " + e.message);
      await ctx.reply("Ошибка при распознавании: " + e.message);
    }
  });
}

async function recognizeTextWithTemplateTesseract(imagePath, preProcessing, postProcessing) {
    try {
        const imageBuffer = await fs.readFile(imagePath);
        const { data: { text } } = await tesseract.recognize(imageBuffer, "eng", {
            preProcessing,
            postProcessing
        });
        return text;
    } catch (error) {
        console.error("Ошибка при распознавании текста:", error);
        throw error;
    }
}

// Экспортируем функцию для регистрации обработчиков
module.exports = { 
  registerOcrHandlers,
  recognizeTextWithTemplateTesseract
};
