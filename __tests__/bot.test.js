const path = require("path");
const fs = require("fs-extra");
const botModule = require("../bot");
const { saveToCacheAndSync } = botModule;

jest.mock("../modules/ui_messages", () => ({
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
}));

jest.mock("../modules/cache_export", () => ({
  exportCacheToJsonFile: jest.fn((localPath, cb) => cb(null)),
  uploadCacheJsonToYadisk: jest.fn(() => Promise.resolve(true)),
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe("bot.js интеграционный тест", () => {
  it("mainMenuKeyboard возвращает корректную клавиатуру", () => {
    expect(typeof botModule.mainMenuKeyboard).toBe('function');
    const keyboard = botModule.mainMenuKeyboard();
    expect(keyboard.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });

  it("splitTextByLength корректно разбивает текст", () => {
    expect(typeof botModule.splitTextByLength).toBe('function');
    const text = "a".repeat(1500);
    const parts = botModule.splitTextByLength(text, 700);
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(700);
    expect(parts[1].length).toBe(700);
    expect(parts[2].length).toBe(100);
  });

  it("parseDocxToText выбрасывает ошибку для несуществующего файла", async () => {
    expect(typeof botModule.parseDocxToText).toBe('function');
    await expect(botModule.parseDocxToText("no_such_file.docx")).rejects.toThrow();
  });

  it("saveToCacheAndSync вызывает экспорт и загрузку кэша", async () => {
    const question = "Тестовый вопрос " + Date.now();
    const answer = "Тестовый ответ";
    const ctx = { reply: jest.fn() };
    await saveToCacheAndSync(question, answer, ctx);
    await new Promise(r => setTimeout(r, 100));
    expect(ctx.reply).toHaveBeenCalledWith("✅ Кэш успешно обновлён и синхронизирован!");
  });

  it("fuzzyFindInYandexDisk возвращает null при ошибке", async () => {
    // Мокаем yadisk, если функция экспортируется
    if (botModule.yadisk) {
      botModule.yadisk.downloadFileByPath = async () => { throw new Error("fail"); };
      const result = await botModule.fuzzyFindInYandexDisk("test");
      expect(result).toBeNull();
    }
  });

  // Можно добавить тесты для processCacheQueue, если экспортируете и мокаем зависимость
});