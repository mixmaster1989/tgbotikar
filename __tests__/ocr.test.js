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
  execSync: jest.fn(() => "")
}));

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
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[Tesseract]'),
        expect.any(Error)
      );
    });
  });

  describe('recognizeTextWithTemplateTesseract', () => {
    test('should process image with template', async () => {
      const result = await recognizeTextWithTemplateTesseract('test.jpg', 'weak', 'weak');
      
      expect(result).toBe('Распознанный текст');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[OCR] Шаблон: pre=weak, post=weak — УСПЕХ')
      );
    });
    
    test('should handle preprocessing errors', async () => {
      // Симулируем ошибку в preMap
      const originalPreMap = preMap.weak;
      preMap.weak = jest.fn().mockImplementation(() => {
        throw new Error('Preprocessing error');
      });
      
      await expect(recognizeTextWithTemplateTesseract('test.jpg', 'weak', 'weak'))
        .rejects.toThrow('Preprocessing error');
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[OCR] Ошибка в шаблоне pre=weak, post=weak'),
        expect.any(Error)
      );
      
      // Восстанавливаем оригинальную функцию
      preMap.weak = originalPreMap;
    });
  });

  describe('smartJoinAndCorrect', () => {
    test('should join lines and correct text', async () => {
      const lines = ['строка1', 'строка2', 'строка3'];
      const result = await smartJoinAndCorrect(lines);
      
      expect(result).toBe('строка1\nстрока2\nстрока3');
    });
    
    test('should handle empty input', async () => {
      const result = await smartJoinAndCorrect([]);
      
      expect(result).toBe('');
    });
  });

  describe('postprocessLanguageTool', () => {
    test('should correct text using LanguageTool', async () => {
      const text = 'текст с ошибкой';
      const result = await postprocessLanguageTool(text);
      
      expect(result).toBe('Исправленный с ошибкой');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8081/v2/check'),
        expect.objectContaining({ text })
      );
    });
    
    test('should handle LanguageTool errors', async () => {
      axios.post.mockRejectedValueOnce(new Error('LanguageTool error'));
      
      const text = 'test';
      const result = await postprocessLanguageTool(text);
      
      expect(result).toBe('test');
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[LanguageTool] Ошибка'),
        expect.any(Error)
      );
    });
  });
});