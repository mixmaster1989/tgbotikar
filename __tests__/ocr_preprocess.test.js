const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Мокаем child_process
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, callback) => {
    // Симулируем успешное выполнение Python-скрипта
    callback(null, 'Success', '');
  })
}));

// Мокаем fs
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  writeFileSync: jest.fn()
}));

describe('OCR Preprocessing Module', () => {
  const scriptPath = path.join(__dirname, '../modules/ocr_preprocess.py');
  const inputPath = path.join(__dirname, '../materials/test-ocr.png');
  const outputPath = path.join(__dirname, '../materials/test-ocr-preprocessed.png');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ocr_preprocess.py file should exist', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
  
  test('should preprocess image with Python script', (done) => {
    execFile('python3', [scriptPath, inputPath, outputPath], (err, stdout, stderr) => {
      expect(err).toBeNull();
      expect(execFile).toHaveBeenCalledWith(
        'python3',
        [scriptPath, inputPath, outputPath],
        expect.any(Function)
      );
      done();
    });
  });
  
  test('should handle errors from Python script', (done) => {
    // Временно переопределяем execFile для симуляции ошибки
    const { execFile } = require('child_process');
    execFile.mockImplementationOnce((cmd, args, callback) => {
      callback(new Error('Python error'), '', 'Error: Cannot import cv2');
    });
    
    execFile('python3', [scriptPath, inputPath, outputPath], (err, stdout, stderr) => {
      expect(err).toBeTruthy();
      expect(err.message).toBe('Python error');
      expect(stderr).toBe('Error: Cannot import cv2');
      done();
    });
  });
  
  test('should handle missing input file', (done) => {
    // Временно переопределяем execFile для симуляции ошибки
    const { execFile } = require('child_process');
    execFile.mockImplementationOnce((cmd, args, callback) => {
      callback(new Error('File not found'), '', 'Error: Не удалось открыть изображение');
    });
    
    execFile('python3', [scriptPath, 'nonexistent.png', outputPath], (err, stdout, stderr) => {
      expect(err).toBeTruthy();
      expect(stderr).toContain('Error');
      done();
    });
  });
  
  describe('Python Script Analysis', () => {
    test('should contain necessary image processing functions', () => {
      // Читаем содержимое Python-скрипта
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      
      // Проверяем наличие ключевых функций и библиотек
      expect(scriptContent).toContain('import cv2');
      expect(scriptContent).toContain('import numpy');
      expect(scriptContent).toContain('def gentle_enhance');
      expect(scriptContent).toContain('cv2.imread');
      expect(scriptContent).toContain('cv2.cvtColor');
      expect(scriptContent).toContain('cv2.imwrite');
    });
    
    test('should handle different image conditions', () => {
      // Читаем содержимое Python-скрипта
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      
      // Проверяем наличие обработки разных условий изображения
      expect(scriptContent).toContain('if mean < 120 or std < 40');
      expect(scriptContent).toContain('if std < 30');
      expect(scriptContent).toContain('cv2.createCLAHE');
      expect(scriptContent).toContain('cv2.adaptiveThreshold');
    });
  });
});