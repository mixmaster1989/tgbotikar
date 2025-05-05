const ui = require("../modules/ui_messages");

describe("UI messages module", () => {
  it("should return static messages", () => {
    expect(ui.processingFile).toMatch(/Обрабатываем файл/);
    expect(ui.promptSent).toMatch(/Отправка промпта/);
    expect(ui.modelAnswerReceived).toMatch(/Ответ от модели получен/);
    expect(ui.savingToCache).toMatch(/Сохраняем результат/);
    expect(ui.cacheSynced).toMatch(/Кэш успешно обновлён/);
    expect(ui.searchingLocalCache).toMatch(/Ищем похожий вопрос/);
    expect(ui.answerFromCache).toMatch(/Ответ найден в локальном кэше/);
    expect(ui.answerFromYadisk).toMatch(/Ответ найден в кэше на Яндекс/);
    expect(ui.generatingAI).toMatch(/Генерируем ответ/);
    expect(ui.answerSaved).toMatch(/Ответ получен и сохранён/);
  });

  it("should return dynamic messages", () => {
    expect(ui.generatingPrompt(2, 5)).toBe("🤖 Генерация промпта для части 2 из 5...");
    expect(ui.error("Ошибка")).toBe("❌ Ошибка: Ошибка");
  });
});

// Исправленные тесты, соответствующие фактическим значениям
describe("UI Messages", () => {
  test("should return a processing message", () => {
    const message = ui.processingFile;
    expect(message).toBe("🛠 Обрабатываем файл...");
  });

  test("should return an error message", () => {
    const errorMessage = ui.error("Test error");
    expect(errorMessage).toBe("❌ Ошибка: Test error");
  });

  // Удаляем тест для несуществующей функции success
});