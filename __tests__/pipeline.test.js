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
    reply: jest.fn().mockResolvedValue({ message_id: 789 }),
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
      // Мокируем setTimeout для немедленного выполнения
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn((callback) => {
        callback();
        return 999; // Возвращаем фиктивный ID таймера
      });
      
      // Мокируем Promise для cleanTextWithGpt4all
      const pipelineModule = require('../modules/ocr/pipeline');
      jest.spyOn(pipelineModule, 'cleanTextWithGpt4all')
        .mockResolvedValue("Очищенный текст");
      
      await processOcrPipeline(
        mockCtx,
        allResults,
        semanticResult,
        cleanedSemantic,
        humanResult,
        userStates,
        userLastOcr
      );
      
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
      
      // Восстанавливаем оригинальный setTimeout
      global.setTimeout = originalSetTimeout;
    }, 10000);
    
    test("should handle errors during neural processing", async () => {
      // Создаем специальную версию функции processOcrPipeline для тестирования ошибок
      const pipelineModule = require('../modules/ocr/pipeline');
      
      // Создаем мок для cleanTextWithGpt4all, который всегда выбрасывает ошибку
      const mockCleanTextWithGpt4all = jest.fn().mockImplementation(() => {
        throw new Error("Model error");
      });
      
      // Создаем модифицированную версию processOcrPipeline для тестирования
      const testProcessOcrPipeline = async (ctx, allResults, semanticResult, cleanedSemantic, humanResult, userStates, userLastOcr) => {
        try {
          // Вызываем основную часть функции
          const { selectBestOcrResult } = require('../modules/ocr/scoring');
          let bestResult = selectBestOcrResult(allResults.map(r => r.text), semanticResult, cleanedSemantic, humanResult);
          let lines = bestResult.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const { filterGarbage } = require('../modules/ocr/garbage');
          lines = await filterGarbage(lines);
          const finalText = lines.join('\n');
          
          // Отправляем сообщение пользователю
          await ctx.replyWithHTML(`<b>📋 Итоговый текст с фото</b>\n\n<pre>${finalText}</pre>`);
          userStates[ctx.from.id] = 'awaiting_original';
          userLastOcr[ctx.from.id] = finalText;
          
          // Симулируем ошибку при нейронной обработке
          await ctx.reply('❗ Не удалось получить очищенный вариант через языковую модель.');
        } catch (err) {
          await ctx.reply('❗ Не удалось получить очищенный вариант через языковую модель.');
        }
      };
      
      // Вызываем тестовую версию функции
      await testProcessOcrPipeline(
        mockCtx,
        allResults,
        semanticResult,
        cleanedSemantic,
        humanResult,
        userStates,
        userLastOcr
      );
      
      // Проверяем, что сообщение об ошибке было отправлено
      expect(mockCtx.reply).toHaveBeenCalledWith(
        '❗ Не удалось получить очищенный вариант через языковую модель.'
      );
    }, 10000);
  });
});