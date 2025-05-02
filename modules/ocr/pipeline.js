// Главная цепочка обработки OCR
// Здесь orchestrate весь процесс: вызовы шаблонов, постобработка, финальная сборка

const { selectBestOcrResult } = require('./scoring');
const { filterGarbage, addGarbage } = require('./garbage');

/**
 * Очистка текста от мусора с помощью языковой модели GPT4All.
 * @param {string} text - исходный текст для очистки
 * @param {object} gpt4allModel - инициализированная модель GPT4All
 * @returns {Promise<string>} - очищенный текст
 */
async function cleanTextWithGpt4all(text, gpt4allModel) {
  if (!gpt4allModel) throw new Error("Модель GPT4All не инициализирована");
  const prompt = `Очисти от мусора, выведи очищенный вариант:\n${text}`;
  const options = {
    maxTokens: 200,
    temp: 0.3,
    topK: 20,
    topP: 0.7,
  };
  // Если у модели есть generate(prompt, options), используем его
  if (typeof gpt4allModel.generate === "function") {
    // В некоторых реализациях generate возвращает { text }, в некоторых — строку
    const result = await gpt4allModel.generate(prompt, options);
    return typeof result === "string" ? result : (result.text || "");
  }
  throw new Error("Модель GPT4All не поддерживает generate");
}

/**
 * Основная функция обработки OCR, вызывается из bot.js
 * @param {Object} ctx - Telegraf context
 * @param {Array} allResults - массив результатов по шаблонам [{tplName, text}]
 * @param {string} semanticResult - результат семантической сборки
 * @param {string} cleanedSemantic - результат после LanguageTool
 * @param {string} humanResult - финальная сборка для Telegram
 * @param {Object} userStates - объект состояния пользователей
 * @param {Object} userLastOcr - объект последних OCR результатов
 */
async function processOcrPipeline(ctx, allResults, semanticResult, cleanedSemantic, humanResult, userStates, userLastOcr) {
  let bestResult = selectBestOcrResult(allResults.map(r => r.text), semanticResult, cleanedSemantic, humanResult);
  let lines = bestResult.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  lines = await filterGarbage(lines);
  const importantWords = ['активируйте', 'скачайте', 'приложение', 'магазин', 'сервис', 'эво', 'касовые', 'подробнее', 'адрес', 'телефон', 'инн'];
  let garbageCandidates = [];
  const filtered = lines.filter(line => {
    const clean = line.trim();
    if (clean.length < 5) {
      garbageCandidates.push(line);
      return false;
    }
    if ((clean.match(/[А-Яа-яЁё]/g) || []).length < 3 && !importantWords.some(w => clean.toLowerCase().includes(w))) {
      garbageCandidates.push(line);
      return false;
    }
    return true;
  });
  await addGarbage(garbageCandidates);
  const finalText = filtered.join('\n');
  await ctx.replyWithHTML(
    `<b>📋 Итоговый текст с фото (максимально близко к оригиналу)</b>\n\n<pre>${finalText}</pre>`
  );
  userStates[ctx.from.id] = 'awaiting_original';
  userLastOcr[ctx.from.id] = finalText;
  await ctx.reply('Если у вас есть оригинальный текст, отправьте его сюда для сравнения и улучшения качества распознавания.');

  // --- Новый этап: очистка текста языковой моделью ---
  try {
    // Получаем gpt4allModel из bot.js через глобальную область (если экспортируется) или через require
    let gpt4allModel;
    try {
      // Попытка получить модель из bot.js (если она экспортируется)
      gpt4allModel = require('../../bot').gpt4allModel;
      if (!gpt4allModel) throw new Error();
    } catch {
      // Если не экспортируется, пробуем инициализировать здесь (может быть дольше)
      const gpt4all = require("gpt4all");
      const modelName = "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf";
      gpt4allModel = await gpt4all.loadModel(modelName);
    }
    const cleaned = await cleanTextWithGpt4all(finalText, gpt4allModel);
    await ctx.replyWithHTML(`<b>🧹 Очищенный вариант:</b>\n\n<pre>${cleaned.trim()}</pre>`);
  } catch (err) {
    await ctx.reply('❗ Не удалось получить очищенный вариант через языковую модель.');
  }
}

module.exports = {
  processOcrPipeline,
  cleanTextWithGpt4all // экспортируем для тестов/других модулей
};
