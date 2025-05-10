module.exports = {
  processingFile: "🛠 Обрабатываем файл...",
  generatingPrompt: (part, total) => `🤖 Генерация промпта для части ${part} из ${total}...`,
  promptSent: "🤖 Отправка промпта в модель...",
  modelAnswerReceived: "✅ Ответ от модели получен.",
  savingToCache: "💾 Сохраняем результат в кэш и на Яндекс.Диск...",
  cacheSynced: "✅ Кэш успешно обновлён и синхронизирован!",
  searchingLocalCache: "🔎 Ищем похожий вопрос в локальном кэше...",
  searchingYadisk: "⏳ Поиск ответа на Яндекс.Диске...",
  answerFromCache: "✅ Ответ найден в локальном кэше!",
  answerFromYadisk: "✅ Ответ найден в кэше на Яндекс.Диске!",
  generatingAI: "🤖 Генерируем ответ с помощью ИИ...",
  answerSaved: "✅ Ответ получен и сохранён в кэш!",
  error: (msg) => `❌ Ошибка: ${msg}`,
  // ...добавляйте по мере необходимости
};