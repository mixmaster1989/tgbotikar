const { 
  recognizeTextTesseract, 
  recognizeTextWithTemplateTesseract,
  smartJoinAndCorrect,
  postprocessLanguageTool,
  preMap,
  postMap
} = require('../modules/ocr');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

// Мокаем зависимости
jest.mock('fs-extra', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue('test content'),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('tesseract.js', () => ({
  recognize: jest.fn().mockResolvedValue({
    data: {
      text: 'Распознанный текст'
    }
  })
}));

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({
    data: {
      matches: [
        {
          offset: 0,
          length: 5,
          replacements: [{ value: 'Исправленный' }]
        }
      ]
    }
  })
}));

jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    const mockProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockProcess;
      }),
      unref: jest.fn(),
      kill: jest.fn()
    };
    return mockProcess;
  }),
  execSync: jest.fn(() => ""),
  execFile: jest.fn((cmd, args, callback) => {
    callback(null);
  })
}));

// Мокаем модуль logger
jest.mock('../modules/logger', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

// Мокаем sharp
jest.mock('sharp', () => {
  const mockSharp = jest.fn().mockReturnValue({
    grayscale: jest.fn().mockReturnThis(),
    greyscale: jest.fn().mockReturnThis(),
    normalize: jest.fn().mockReturnThis(),
    modulate: jest.fn().mockReturnThis(),
    sharpen: jest.fn().mockReturnThis(),
    median: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({})
  });
  return mockSharp;
});

describe('OCR Module', () => {
  // Сохраняем оригинальные функции
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    // Мокаем console.log и console.error
    console.log = jest.fn();
    console.error = jest.fn();
    
    // Очищаем моки перед каждым тестом
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Восстанавливаем оригинальные функции
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
  
  afterAll(() => {
    // Убеждаемся, что все процессы завершены
    if (global.__mockProcesses) {
      global.__mockProcesses.forEach(process => {
        if (process.kill) process.kill();
      });
    }
  });

  describe('Module Structure', () => {
    test('should export required functions', () => {
      expect(recognizeTextTesseract).toBeInstanceOf(Function);
      expect(recognizeTextWithTemplateTesseract).toBeInstanceOf(Function);
      expect(smartJoinAndCorrect).toBeInstanceOf(Function);
      expect(postprocessLanguageTool).toBeInstanceOf(Function);
    });
    
    test('should export preMap and postMap objects', () => {
      expect(preMap).toBeInstanceOf(Object);
      expect(postMap).toBeInstanceOf(Object);
      
      // Проверяем наличие обработчиков
      expect(preMap.weak).toBeInstanceOf(Function);
      expect(postMap.weak).toBeInstanceOf(Function);
    });
  });

  describe('recognizeTextTesseract', () => {
    test('should recognize text from image', async () => {
      const result = await recognizeTextTesseract('test.jpg');
      
      expect(result).toBe('Распознанный текст');
    });
    
    test('should handle errors', async () => {
      const tesseract = require('tesseract.js');
      tesseract.recognize.mockRejectedValueOnce(new Error('Tesseract error'));
      
      await expect(recognizeTextTesseract('test.jpg')).rejects.toThrow('Tesseract error');
      
      // Проверяем, что ошибка была залогирована
      const logger = require('../modules/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Tesseract error')
      );
    });
  });

  describe('recognizeTextWithTemplateTesseract', () => {
    test('should process image with template', async () => {
      // Мокаем Promise.race, чтобы он всегда возвращал успешный результат
      const originalPromiseRace = Promise.race;
      Promise.race = jest.fn().mockResolvedValue('Распознанный текст');
      
      const result = await recognizeTextWithTemplateTesseract('test.jpg', 'weak', 'weak');
      
      expect(result).toBe('Распознанный текст');
      
      // Проверяем, что был залогирован успех
      const logger = require('../modules/logger');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Шаблон: pre=weak, post=weak — старт')
      );
      
      // Восстанавливаем оригинальный Promise.race
      Promise.race = originalPromiseRace;
    });
    
    test('should handle preprocessing errors', async () => {
      // Мокаем preMap.weak, чтобы он выбрасывал ошибку
      const originalPreMap = preMap.weak;
      preMap.weak = jest.fn().mockRejectedValue(new Error('Preprocessing error'));
      
      const result = await recognizeTextWithTemplateTesseract('test.jpg', 'weak', 'weak');
      
      expect(result).toContain('Ошибка в шаблоне pre=weak, post=weak');
      expect(result).toContain('Preprocessing error');
      
      // Проверяем, что ошибка была залогирована
      const logger = require('../modules/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Ошибка в шаблоне pre=weak, post=weak')
      );
      
      // Восстанавливаем оригинальную функцию
      preMap.weak = originalPreMap;
    });
  });

  describe('smartJoinAndCorrect', () => {
    test('should join lines and correct text', async () => {
      // Мокаем модуль russian_dict
      jest.mock('../modules/russian_dict', () => ['слово', 'текст', 'строка'], { virtual: true });
      
      const result = await smartJoinAndCorrect('строка1\nстрока2\nстрока3');
      
      expect(result).toBe('строка1\nстрока2\nстрока3');
    });
    
    test('should handle empty input', async () => {
      const result = await smartJoinAndCorrect('');
      
      expect(result).toBe('');
    });
  });

  describe('postprocessLanguageTool', () => {
    test('should correct text using LanguageTool', async () => {
      const text = 'текст с ошибкой';
      
      // Мокаем axios.post для этого теста
      axios.post.mockImplementationOnce((url, data, config) => {
        return Promise.resolve({
          data: {
            matches: [
              {
                offset: 0,
                length: 5,
                replacements: [{ value: 'Исправленный' }]
              }
            ]
          }
        });
      });
      
      const result = await postprocessLanguageTool(text);
      
      expect(result).toBe('Исправленный с ошибкой');
      
      // Проверяем, что axios.post был вызван с правильными параметрами
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8081/v2/check',
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });
    
    test('should handle LanguageTool errors', async () => {
      // Мокаем axios.post для этого теста
      axios.post.mockRejectedValueOnce(new Error('LanguageTool error'));
      
      const text = 'test';
      
      // Ожидаем, что функция выбросит ошибку
      await expect(postprocessLanguageTool(text)).rejects.toThrow('LanguageTool error');
      
      // Проверяем, что ошибка была залогирована
      const logger = require('../modules/logger');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('LanguageTool error')
      );
    });
  });
});