const { processOcrPipeline, cleanTextWithGpt4all } = require('../modules/ocr/pipeline');

// Мокаем зависимости
jest.mock('../modules/ocr/scoring', () => ({
  selectBestOcrResult: jest.fn((results, semantic, cleaned, human) => {
    return "строка1\nстрока2\nстрока3";
  })
}));

jest.mock('../modules/ocr/garbage', () => ({
  filterGarbage: jest.fn(async (lines) => lines),
  addGarbage: jest.fn(async () => {})
}));

// Мокаем модуль bot.js
jest.mock('../../bot', () => ({
  gpt4allModel: {
    generate: jest.fn().mockResolvedValue("Очищенный текст")
  }
}), { virtual: true });

// Мокаем gpt4all
jest.mock('gpt4all', () => ({
  loadModel: jest.fn().mockResolvedValue({
    generate: jest.fn().mockResolvedValue("Очищенный текст из gpt4all")
  })
}), { virtual: true });

describe("OCR Pipeline Module", () => {
  // Мок для Telegraf context
  const mockCtx = {
    from: { id: 123 },
    chat: { id: 456 },
    reply: jest.fn().mockResolvedValue({}),
    replyWithHTML: jest.fn().mockResolvedValue({}),
    telegram: {
      editMessageText: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({})
    }
  };
  
  // Мок для GPT4All модели
  const mockGpt4allModel = {
    generate: jest.fn().mockResolvedValue("Очищенный текст")
  };
  
  // Тестовые данные
  const allResults = [
    { tplName: "template1", text: "строка1" },
    { tplName: "template2", text: "строка2" },
    { tplName: "template3", text: "строка3" }
  ];
  const semanticResult = "строка1\nстрока2\nстрока3";
  const cleanedSemantic = "строка1\nстрока2\nстрока3";
  const humanResult = "строка1\nстрока2\nстрока3";
  const userStates = {};
  const userLastOcr = {};
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Мокаем setTimeout
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  describe("cleanTextWithGpt4all", () => {
    test("should clean text using GPT4All model", async () => {
      const text = "текст с мусором";
      const result = await cleanTextWithGpt4all(text, mockGpt4allModel);
      
      expect(result).toBe("Очищенный текст");
      expect(mockGpt4allModel.generate).toHaveBeenCalledWith(
        expect.stringContaining(text),
        expect.objectContaining({
          maxTokens: expect.any(Number),
          temp: expect.any(Number)
        })
      );
    });
    
    test("should throw error if model is not initialized", async () => {
      await expect(cleanTextWithGpt4all("текст", null))
        .rejects.toThrow("Модель GPT4All не инициализирована");
    });
    
    test("should throw error if model doesn't support generate", async () => {
      const invalidModel = {};
      await expect(cleanTextWithGpt4all("текст", invalidModel))
        .rejects.toThrow("Модель GPT4All не поддерживает generate");
    });
    
    test("should handle different return types from generate", async () => {
      // Модель возвращает объект с text
      const objectModel = {
        generate: jest.fn().mockResolvedValue({ text: "Результат в объекте" })
      };
      
      const result = await cleanTextWithGpt4all("текст", objectModel);
      expect(result).toBe("Результат в объекте");
    });
  });

  describe("processOcrPipeline", () => {
    test("should process OCR results and update user state", async () => {
      // Мокируем setTimeout для ускорения теста
      jest.useFakeTimers();
      
      const processPromise = processOcrPipeline(
        mockCtx,
        allResults,
        semanticResult,
        cleanedSemantic,
        humanResult,
        userStates,
        userLastOcr
      );
      
      // Быстро продвигаем все таймеры
      jest.runAllTimers();
      
      await processPromise;
      
      // Восстанавливаем таймеры
      jest.useRealTimers();
      
      // Проверяем, что был вызван selectBestOcrResult
      const { selectBestOcrResult } = require('../modules/ocr/scoring');
      expect(selectBestOcrResult).toHaveBeenCalledWith(
        expect.arrayContaining(["строка1", "строка2", "строка3"]),
        semanticResult,
        cleanedSemantic,
        humanResult
      );
      
      // Проверяем, что был вызван filterGarbage
      const { filterGarbage } = require('../modules/ocr/garbage');
      expect(filterGarbage).toHaveBeenCalled();
      
      // Проверяем, что был отправлен ответ пользователю
      expect(mockCtx.replyWithHTML).toHaveBeenCalledWith(
        expect.stringContaining("Итоговый текст с фото")
      );
      
      // Проверяем, что состояние пользователя обновлено
      expect(userStates[mockCtx.from.id]).toBe('awaiting_original');
      expect(userLastOcr[mockCtx.from.id]).toBeDefined();
      
      // Проверяем, что был запущен процесс нейронной обработки
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("нейронная обработка")
      );
    }, 60000); // Увеличиваем таймаут до 60 секунд
    
    test("should handle errors during neural processing", async () => {
      // Временно переопределяем модули для симуляции ошибок
      const botModule = require('../../bot');
      const originalGpt4allModel = botModule.gpt4allModel;
      botModule.gpt4allModel = undefined;
      
      const gpt4all = require('gpt4all');
      const originalLoadModel = gpt4all.loadModel;
      gpt4all.loadModel = jest.fn().mockRejectedValue(new Error("Model loading failed"));
      
      await processOcrPipeline(
        mockCtx,
        allResults,
        semanticResult,
        cleanedSemantic,
        humanResult,
        userStates,
        userLastOcr
      );
      
      // Проверяем, что была отправлена ошибка
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Не удалось получить очищенный вариант")
      );
      
      // Восстанавливаем оригинальные функции
      botModule.gpt4allModel = originalGpt4allModel;
      gpt4all.loadModel = originalLoadModel;
    });
  });
});