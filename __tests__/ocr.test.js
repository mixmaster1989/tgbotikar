const path = require("path");
const fs = require("fs-extra");
const Tesseract = require("tesseract.js");

// Мокаем зависимости
jest.mock("fs-extra");
jest.mock("tesseract.js", () => ({
  recognize: jest.fn().mockResolvedValue({ data: { text: "Mock OCR Result" } })
}));
jest.mock("sharp", () => {
  return jest.fn().mockReturnValue({
    grayscale: jest.fn().mockReturnThis(),
    modulate: jest.fn().mockReturnThis(),
    normalize: jest.fn().mockReturnThis(),
    sharpen: jest.fn().mockReturnThis(),
    median: jest.fn().mockReturnThis(),
    greyscale: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue({
      data: Buffer.from([100, 150, 200, 250]),
      info: { width: 2, height: 2, channels: 1 }
    }),
    toFile: jest.fn().mockResolvedValue("output-path")
  });
});
jest.mock("child_process", () => ({
  execFile: jest.fn((cmd, args, callback) => {
    callback(null);
  }),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    unref: jest.fn()
  })),
  execSync: jest.fn(() => "")
}));
jest.mock("axios", () => ({
  post: jest.fn().mockResolvedValue({
    data: {
      matches: [
        {
          offset: 0,
          length: 5,
          replacements: [{ value: "Исправленный" }]
        }
      ]
    }
  })
}));

describe("OCR Module", () => {
  const ocrModule = require("../modules/ocr");
  const testImg = "materials/test-ocr.png";
  const processedImg = "materials/test-ocr_weak_weak.png";
  
  beforeAll(() => {
    fs.pathExists = jest.fn().mockResolvedValue(true);
    fs.readFile = jest.fn().mockResolvedValue(Buffer.from("test image data"));
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Module Structure", () => {
    test("should export required functions", () => {
      expect(ocrModule).toBeDefined();
      expect(typeof ocrModule.recognizeTextTesseract).toBe("function");
      expect(typeof ocrModule.recognizeTextWithTemplateTesseract).toBe("function");
      expect(typeof ocrModule.smartJoinAndCorrect).toBe("function");
      expect(typeof ocrModule.preprocessImage).toBe("function");
      expect(typeof ocrModule.postprocessLanguageTool).toBe("function");
    });
    
    test("should export preMap and postMap objects", () => {
      expect(ocrModule.preMap).toBeDefined();
      expect(ocrModule.postMap).toBeDefined();
      expect(typeof ocrModule.preMap).toBe("object");
      expect(typeof ocrModule.postMap).toBe("object");
    });
  });

  describe("recognizeTextTesseract", () => {
    test("should recognize text from image", async () => {
      const result = await ocrModule.recognizeTextTesseract(testImg);
      expect(result).toBe("Mock OCR Result");
      expect(Tesseract.recognize).toHaveBeenCalledWith(testImg, "rus", { logger: expect.any(Function) });
    });
    
    test("should handle errors", async () => {
      Tesseract.recognize.mockRejectedValueOnce(new Error("Tesseract error"));
      await expect(ocrModule.recognizeTextTesseract(testImg)).rejects.toThrow("Tesseract error");
    });
  });

  describe("recognizeTextWithTemplateTesseract", () => {
    test("should process image with template", async () => {
      const result = await ocrModule.recognizeTextWithTemplateTesseract(testImg, "weak", "weak");
      expect(result).toBe("Mock OCR Result");
    });
    
    test("should handle preprocessing errors", async () => {
      // Мокаем ошибку в preMap
      const originalPreMap = ocrModule.preMap.weak;
      ocrModule.preMap.weak = jest.fn().mockRejectedValueOnce(new Error("Preprocessing error"));
      
      const result = await ocrModule.recognizeTextWithTemplateTesseract(testImg, "weak", "weak");
      expect(result).toContain("Ошибка в шаблоне");
      expect(result).toContain("Preprocessing error");
      
      // Восстанавливаем оригинальную функцию
      ocrModule.preMap.weak = originalPreMap;
    });
  });

  describe("smartJoinAndCorrect", () => {
    test("should join lines and correct text", () => {
      const input = "строка1\nстрока2\nстрока3";
      const result = ocrModule.smartJoinAndCorrect(input);
      
      // Проверяем, что результат содержит все строки (с учетом капитализации)
      expect(result.toLowerCase()).toContain("строка1");
      expect(result.toLowerCase()).toContain("строка2");
      expect(result.toLowerCase()).toContain("строка3");
      
      // Проверяем, что первая буква первой строки заглавная
      expect(result[0]).toBe(result[0].toUpperCase());
    });
    
    test("should handle empty input", () => {
      const result = ocrModule.smartJoinAndCorrect("");
      expect(result).toBe("");
    });
  });

  describe("postprocessLanguageTool", () => {
    test("should correct text using LanguageTool", async () => {
      const input = "текст с ошибкой";
      const result = await ocrModule.postprocessLanguageTool(input);
      
      // Проверяем, что текст был исправлен (без учета пробелов)
      expect(result.replace(/\s+/g, "")).toBe("Исправленныйсошибкой");
    });
    
    test("should handle LanguageTool errors", async () => {
      const axios = require("axios");
      axios.post.mockRejectedValueOnce(new Error("LanguageTool error"));
      
      await expect(ocrModule.postprocessLanguageTool("test")).rejects.toThrow("LanguageTool error");
    });
  });
});