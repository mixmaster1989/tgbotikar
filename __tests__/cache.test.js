const fs = require("fs-extra");
const path = require("path");
const cache = require("../modules/cache");
const sqlite3 = require("sqlite3");

// Мокаем базу данных для изоляции тестов
jest.mock("sqlite3", () => {
  const mockDb = {
    prepare: jest.fn().mockReturnValue({
      run: jest.fn((prompt, response, callback) => {
        if (callback) callback(null);
      }),
      finalize: jest.fn()
    }),
    all: jest.fn((query, callback) => {
      const mockData = [
        { id: 1, prompt: "Тестовый вопрос", response: "Тестовый ответ" }
      ];
      // Добавляем тестовые данные динамически
      if (global.testPrompt && global.testResponse) {
        mockData.push({ 
          id: 2, 
          prompt: global.testPrompt, 
          response: global.testResponse 
        });
      }
      callback(null, mockData);
    })
  };
  
  return {
    verbose: jest.fn().mockReturnValue({
      Database: jest.fn().mockReturnValue(mockDb)
    })
  };
});

describe("Cache Module", () => {
  const testPrompt = "Тестовый вопрос " + Date.now();
  const testResponse = "Тестовый ответ";
  
  // Сохраняем тестовые данные глобально для использования в моке
  beforeAll(() => {
    global.testPrompt = testPrompt;
    global.testResponse = testResponse;
  });
  
  afterAll(() => {
    delete global.testPrompt;
    delete global.testResponse;
  });

  describe("saveToCacheHistory", () => {
    test("should be a function", () => {
      expect(typeof cache.saveToCacheHistory).toBe('function');
    });
    
    test("should save data to cache", () => {
      cache.saveToCacheHistory(testPrompt, testResponse);
      
      // Проверяем, что prepare был вызван с правильным SQL запросом
      const db = require("sqlite3").verbose().Database();
      expect(db.prepare).toHaveBeenCalledWith(
        "INSERT INTO gpt_cache (prompt, response) VALUES (?, ?)"
      );
    });
  });

  describe("getAllCacheQuestions", () => {
    test("should be a function", () => {
      expect(typeof cache.getAllCacheQuestions).toBe('function');
    });
    
    test("should return array of cache entries", (done) => {
      cache.getAllCacheQuestions((err, rows) => {
        expect(err).toBeNull();
        expect(Array.isArray(rows)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
        
        // Проверяем структуру данных
        const firstRow = rows[0];
        expect(firstRow).toHaveProperty('id');
        expect(firstRow).toHaveProperty('prompt');
        expect(firstRow).toHaveProperty('response');
        
        done();
      });
    });
  });

  describe("fuzzyFindInCache", () => {
    test("should be a function", () => {
      expect(typeof cache.fuzzyFindInCache).toBe('function');
    });
    
    test("should find similar question in cache", (done) => {
      cache.fuzzyFindInCache(testPrompt, (err, response) => {
        expect(err).toBeNull();
        // В нашем моке мы настроили возврат testResponse для testPrompt
        expect(response).toBeDefined();
        done();
      });
    });
    
    test("should handle non-matching questions", (done) => {
      // Мокаем fuzzysort для этого конкретного теста
      const originalFuzzysort = require("fuzzysort");
      jest.mock("fuzzysort", () => ({
        go: jest.fn().mockReturnValue([])
      }));
      
      // Перезагружаем модуль кэша с новым моком
      jest.resetModules();
      const cacheWithMock = require("../modules/cache");
      
      cacheWithMock.fuzzyFindInCache("Несуществующий вопрос", (err, response) => {
        expect(err).toBeNull();
        expect(response).toBeNull();
        
        // Восстанавливаем оригинальный fuzzysort
        jest.unmock("fuzzysort");
        done();
      });
    });
  });
});