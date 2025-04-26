// Главная цепочка обработки OCR
// Здесь orchestrate весь процесс: вызовы шаблонов, постобработка, финальная сборка

const { selectBestOcrResult } = require('./scoring');
const { filterGarbage, addGarbage } = require('./garbage');

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
}

module.exports = {
  processOcrPipeline
};
