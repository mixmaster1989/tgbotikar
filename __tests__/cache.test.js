const fs = require("fs-extra");
const path = require("path");
const cache = require("../modules/cache");

// Добавим afterEach для очистки mocks
afterEach(() => {
  jest.clearAllMocks && jest.clearAllMocks();
});

describe("modules/cache.js", () => {
  const testPrompt = "Тестовый вопрос " + Date.now();
  const testResponse = "Тестовый ответ";

  afterAll(async () => {
    // Очистить тестовые записи (по необходимости)
    // Можно реализовать удаление из базы, если потребуется
  });

  it("saveToCacheHistory добавляет запись в кэш", done => {
    expect(typeof cache.saveToCacheHistory).toBe('function');
    expect(typeof cache.getAllCacheQuestions).toBe('function');
    cache.saveToCacheHistory(testPrompt, testResponse);
    // Даем sqlite немного времени на запись
    setTimeout(() => {
      cache.getAllCacheQuestions((err, rows) => {
        expect(err).toBeNull();
        const found = rows.find(r => r.prompt === testPrompt && r.response === testResponse);
        expect(found).toBeDefined();
        done();
      });
    }, 200);
  });

  it("getAllCacheQuestions возвращает массив записей", done => {
    cache.getAllCacheQuestions((err, rows) => {
      expect(err).toBeNull();
      expect(Array.isArray(rows)).toBe(true);
      done();
    });
  });

  it("fuzzyFindInCache находит похожий вопрос", done => {
    expect(typeof cache.fuzzyFindInCache).toBe('function');
    cache.fuzzyFindInCache(testPrompt, (err, response) => {
      expect(err).toBeNull();
      expect(response).toBe(testResponse);
      done();
    });
  });
});