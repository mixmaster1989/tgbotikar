// Импортируем модули для работы с файлами и путями
const fs = require("fs-extra");
const path = require("path");

// Импортируем Markup для создания кнопок в Telegraf
const { Markup } = require("telegraf");

// Импортируем логгер для записи ошибок и информации
const logger = require("../logger");

// Импортируем функцию для конвертации DOCX в PDF
const { convertDocxToPdf } = require("../docx2pdf");

// Импортируем клавиатуру главного меню
const { mainMenuKeyboard } = require("../utils");

// Определяем пути к папкам с материалами и кэшем
const materialsPath = path.join(__dirname, "..", "..", "materials");
const cachePath = path.join(__dirname, "..", "..", "cache");

// Функция для регистрации обработчиков, связанных с материалами
function registerMaterialsHandlers(bot) {
  // Обработчик кнопки "Материалы" — показывает список доступных файлов
  bot.action("materials", async (ctx) => {
    try {
      // Читаем список файлов в папке материалов
      const files = await fs.readdir(materialsPath);

      // Фильтруем только файлы с расширением .docx
      const docxFiles = files.filter(f => f.endsWith(".docx"));

      // Если файлов нет, отправляем сообщение пользователю
      if (!docxFiles.length) return ctx.reply("Нет доступных материалов.");

      // Создаем кнопки для каждого файла
      const buttons = docxFiles.map(f => [Markup.button.callback(f, `material_${encodeURIComponent(f)}`)]);

      // Отправляем пользователю список файлов с кнопками
      await ctx.reply("Выберите материал:", Markup.inlineKeyboard(buttons));
    } catch (err) {
      // Логируем ошибку и отправляем сообщение пользователю
      logger.error("Ошибка при получении списка материалов: " + err.message);
      await ctx.reply("Ошибка при получении списка материалов.");
    }
  });

  // Обработчик выбора конкретного материала — конвертирует DOCX в PDF и отправляет пользователю
  bot.action(/material_(.+)/, async (ctx) => {
    // Декодируем имя файла из кнопки
    const fileName = decodeURIComponent(ctx.match[1]);

    // Определяем пути к исходному DOCX и результирующему PDF
    const docxPath = path.join(materialsPath, fileName);
    const pdfName = fileName.replace(/\.docx$/i, ".pdf");
    const pdfPath = path.join(cachePath, pdfName);

    try {
      // Убираем кнопки после выбора файла
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(null);

      // Сообщаем пользователю, что файл обрабатывается
      await ctx.reply("Обрабатываю файл...");

      // Конвертируем DOCX в PDF
      await convertDocxToPdf(docxPath, pdfPath);

      // Отправляем PDF пользователю
      await ctx.replyWithDocument({ source: pdfPath, filename: pdfName });

      // Показываем клавиатуру главного меню
      await ctx.reply("Выберите действие:", mainMenuKeyboard());
    } catch (err) {
      // Логируем ошибку и отправляем сообщение пользователю
      logger.error("Ошибка при конвертации или отправке PDF: " + err.message);
      await ctx.reply("Ошибка при конвертации или отправке PDF: " + err.message);
      await ctx.reply("Выберите действие:", mainMenuKeyboard());
    }
  });
}

// Экспортируем функцию для регистрации обработчиков
module.exports = { registerMaterialsHandlers };
