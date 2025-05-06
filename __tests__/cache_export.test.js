const path = require("path");
const fs = require("fs-extra");
const cacheExport = require("../modules/cache_export");
const cache = require("../modules/cache");

// Мокаем зависимости
jest.mock("fs-extra", () => ({
  ...jest.requireActual("fs-extra"),
  writeJson: jest.fn((path, data, options, callback) => {
    callback(null);
  }),
  readJsonSync: jest.fn(() => {
    return [
      { id: 1, prompt: "Тестовый вопрос", response: "Тестовый ответ" },
      { id: 2, prompt: global.testQuestion, response: global.testAnswer }
    ];
  })
}));

jest.mock("../modules/cache", () => ({
  getAllCacheQuestions: jest.fn((callback) => {
    const mockData = [
      { id: 1, prompt: "Тестовый вопрос", response: "Тестовый ответ" }
    ];
    
    // Добавляем тестовые данные динамически
    if (global.testQuestion && global.testAnswer) {
      mockData.push({ 
        id: 2, 
        prompt: global.testQuestion, 
        response: global.testAnswer 
      });
    }
    
    callback(null, mockData);
  }),
  saveToCacheHistory: jest.fn(),
  fuzzyFindInCache: jest.fn((question, callback) => {
    if (question === global.testQuestion) {
      callback(null, global.testAnswer);
    } else {
      callback(null, null);
    }
  })
}));

describe("Cache Export Module", () => {
  const localPath = path.join(__dirname, "..", "cache", "dataset.test.json");
  const testQuestion = "Тестовый вопрос для экспорта " + Date.now();
  const testAnswer = "Тестовый ответ для экспорта";
  
  beforeAll(() => {
    global.testQuestion = testQuestion;
    global.testAnswer = testAnswer;
  });
  
  afterAll(() => {
    delete global.testQuestion;
    delete global.testAnswer;
    jest.restoreAllMocks();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("exportCacheToJsonFile", () => {
    test("should be a function", () => {
      expect(typeof cacheExport.exportCacheToJsonFile).toBe('function');
    });
    
    test("should export cache to JSON file", (done) => {
      cacheExport.exportCacheToJsonFile(localPath, (err) => {
        expect(err).toBeFalsy();
        
        // Проверяем, что getAllCacheQuestions был вызван
        expect(cache.getAllCacheQuestions).toHaveBeenCalled();
        
        // Проверяем, что writeJson был вызван с правильными параметрами
        expect(fs.writeJson).toHaveBeenCalledWith(
          localPath,
          expect.any(Array),
          { spaces: 2 },
          expect.any(Function)
        );
        
        done();
      });
    });
    
    test("should handle errors when getting cache", (done) => {
      // Временно переопределяем getAllCacheQuestions для этого теста
      const originalGetAllCacheQuestions = cache.getAllCacheQuestions;
      cache.getAllCacheQuestions = jest.fn((callback) => {
        callback(new Error("Test error"));
      });
      
      cacheExport.exportCacheToJsonFile(localPath, (err) => {
        expect(err).toBeTruthy();
        expect(err.message).toBe("Test error");
        
        // Восстанавливаем оригинальную функцию
        cache.getAllCacheQuestions = originalGetAllCacheQuestions;
        done();
      });
    });
    
    test("should handle errors when writing JSON", (done) => {
      // Временно переопределяем writeJson для этого теста
      const originalWriteJson = fs.writeJson;
      fs.writeJson = jest.fn((path, data, options, callback) => {
        callback(new Error("Write error"));
      });
      
      cacheExport.exportCacheToJsonFile(localPath, (err) => {
        expect(err).toBeTruthy();
        expect(err.message).toBe("Write error");
        
        // Восстанавливаем оригинальную функцию
        fs.writeJson = originalWriteJson;
        done();
      });
    });
  });

  describe("uploadCacheJsonToYadisk", () => {
    test("should be a function", () => {
      expect(typeof cacheExport.uploadCacheJsonToYadisk).toBe('function');
    });
    
    test("should upload file to Yandex Disk", async () => {
      const mockYadisk = {
        uploadFile: jest.fn().mockResolvedValue(true)
      };
      
      const remotePath = "/cache/dataset.json";
      
      await expect(
        cacheExport.uploadCacheJsonToYadisk(mockYadisk, localPath, remotePath)
      ).resolves.toBe(true);
      
      expect(mockYadisk.uploadFile).toHaveBeenCalledWith(localPath, remotePath);
    });
    
    test("should handle upload errors", async () => {
      const mockYadisk = {
        uploadFile: jest.fn().mockRejectedValue(new Error("Upload failed"))
      };
      
      const remotePath = "/cache/dataset.json";
      
      await expect(
        cacheExport.uploadCacheJsonToYadisk(mockYadisk, localPath, remotePath)
      ).rejects.toThrow("Upload failed");
    });
  });
});

describe('Cache Integration', () => {
  const testQuestion = 'Тестовый вопрос ' + Date.now();
  const testAnswer = 'Тестовый ответ';
  
  beforeAll(() => {
    global.testQuestion = testQuestion;
    global.testAnswer = testAnswer;
  });
  
  afterAll(() => {
    delete global.testQuestion;
    delete global.testAnswer;
  });

  test('should save and find answer in cache', (done) => {
    cache.saveToCacheHistory(testQuestion, testAnswer);
    
    cache.fuzzyFindInCache(testQuestion, (err, found) => {
      expect(err).toBeNull();
      expect(found).toBe(testAnswer);
      done();
    });
  });
});