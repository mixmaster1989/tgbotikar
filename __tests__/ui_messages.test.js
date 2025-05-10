const ui = require("../modules/ui_messages");

describe("UI Messages Module", () => {
  describe("Static messages", () => {
    test("processingFile should contain correct text", () => {
      expect(ui.processingFile).toBe("🛠 Обрабатываем файл...");
    });

    test("promptSent should contain correct text", () => {
      expect(ui.promptSent).toBe("🤖 Отправка промпта в модель...");
    });

    test("modelAnswerReceived should contain correct text", () => {
      expect(ui.modelAnswerReceived).toBe("✅ Ответ от модели получен.");
    });

    test("savingToCache should contain correct text", () => {
      expect(ui.savingToCache).toBe("💾 Сохраняем результат в кэш и на Яндекс.Диск...");
    });

    test("cacheSynced should contain correct text", () => {
      expect(ui.cacheSynced).toBe("✅ Кэш успешно обновлён и синхронизирован!");
    });

    test("searchingLocalCache should contain correct text", () => {
      expect(ui.searchingLocalCache).toBe("🔎 Ищем похожий вопрос в локальном кэше...");
    });

    test("searchingYadisk should contain correct text", () => {
      expect(ui.searchingYadisk).toBe("⏳ Поиск ответа на Яндекс.Диске...");
    });

    test("answerFromCache should contain correct text", () => {
      expect(ui.answerFromCache).toBe("✅ Ответ найден в локальном кэше!");
    });

    test("answerFromYadisk should contain correct text", () => {
      expect(ui.answerFromYadisk).toBe("✅ Ответ найден в кэше на Яндекс.Диске!");
    });

    test("generatingAI should contain correct text", () => {
      expect(ui.generatingAI).toBe("🤖 Генерируем ответ с помощью ИИ...");
    });

    test("answerSaved should contain correct text", () => {
      expect(ui.answerSaved).toBe("✅ Ответ получен и сохранён в кэш!");
    });
  });

  describe("Dynamic messages", () => {
    test("generatingPrompt should format message with part and total", () => {
      expect(ui.generatingPrompt(2, 5)).toBe("🤖 Генерация промпта для части 2 из 5...");
      expect(ui.generatingPrompt(1, 3)).toBe("🤖 Генерация промпта для части 1 из 3...");
      expect(ui.generatingPrompt(10, 10)).toBe("🤖 Генерация промпта для части 10 из 10...");
    });

    test("error should format error message", () => {
      expect(ui.error("Тестовая ошибка")).toBe("❌ Ошибка: Тестовая ошибка");
      expect(ui.error("Файл не найден")).toBe("❌ Ошибка: Файл не найден");
      expect(ui.error("")).toBe("❌ Ошибка: ");
    });
  });

  describe("Module structure", () => {
    test("should export an object with all required message properties", () => {
      const expectedProperties = [
        'processingFile',
        'generatingPrompt',
        'promptSent',
        'modelAnswerReceived',
        'savingToCache',
        'cacheSynced',
        'searchingLocalCache',
        'searchingYadisk',
        'answerFromCache',
        'answerFromYadisk',
        'generatingAI',
        'answerSaved',
        'error'
      ];

      expectedProperties.forEach(prop => {
        expect(ui).toHaveProperty(prop);
      });
    });

    test("function properties should be functions", () => {
      expect(typeof ui.generatingPrompt).toBe('function');
      expect(typeof ui.error).toBe('function');
    });

    test("string properties should be strings", () => {
      const stringProps = [
        'processingFile',
        'promptSent',
        'modelAnswerReceived',
        'savingToCache',
        'cacheSynced',
        'searchingLocalCache',
        'searchingYadisk',
        'answerFromCache',
        'answerFromYadisk',
        'generatingAI',
        'answerSaved'
      ];

      stringProps.forEach(prop => {
        expect(typeof ui[prop]).toBe('string');
      });
    });
  });
});