const fs = require("fs-extra");
const path = require("path");
const libre = require('libreoffice-convert');

// Мокаем зависимости
jest.mock("fs-extra");
jest.mock("libreoffice-convert");

describe("DOCX to PDF Conversion Module", () => {
  // Импортируем модуль после моков
  const { convertDocxToPdf } = require("../modules/docx2pdf");
  
  const docxPath = path.join(__dirname, "..", "materials", "test.docx");
  const pdfPath = path.join(__dirname, "..", "cache", "test.pdf");
  
  beforeEach(() => {
    // Настраиваем моки для каждого теста
    fs.readFile = jest.fn().mockResolvedValue(Buffer.from("mock docx content"));
    fs.outputFile = jest.fn().mockResolvedValue(undefined);
    libre.convert = jest.fn((docxBuf, format, options, callback) => {
      callback(null, Buffer.from("mock pdf content"));
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("convertDocxToPdf", () => {
    test("should be a function", () => {
      expect(typeof convertDocxToPdf).toBe("function");
    });
    
    test("should convert DOCX to PDF successfully", async () => {
      await convertDocxToPdf(docxPath, pdfPath);
      
      // Проверяем, что файл был прочитан
      expect(fs.readFile).toHaveBeenCalledWith(docxPath);
      
      // Проверяем, что libre.convert был вызван с правильными параметрами
      expect(libre.convert).toHaveBeenCalledWith(
        expect.any(Buffer),
        '.pdf',
        undefined,
        expect.any(Function)
      );
      
      // Проверяем, что результат был записан
      expect(fs.outputFile).toHaveBeenCalledWith(pdfPath, expect.any(Buffer));
    });
    
    test("should handle file read errors", async () => {
      // Симулируем ошибку чтения файла
      fs.readFile = jest.fn().mockRejectedValue(new Error("File not found"));
      
      await expect(convertDocxToPdf(docxPath, pdfPath)).rejects.toThrow("File not found");
      expect(fs.readFile).toHaveBeenCalledWith(docxPath);
      expect(libre.convert).not.toHaveBeenCalled();
      expect(fs.outputFile).not.toHaveBeenCalled();
    });
    
    test("should handle conversion errors", async () => {
      // Симулируем ошибку конвертации
      libre.convert = jest.fn((docxBuf, format, options, callback) => {
        callback(new Error("Conversion failed"), null);
      });
      
      await expect(convertDocxToPdf(docxPath, pdfPath)).rejects.toThrow("Conversion failed");
      expect(fs.readFile).toHaveBeenCalledWith(docxPath);
      expect(libre.convert).toHaveBeenCalled();
      expect(fs.outputFile).not.toHaveBeenCalled();
    });
    
    test("should handle file write errors", async () => {
      // Симулируем ошибку записи файла
      fs.outputFile = jest.fn().mockRejectedValue(new Error("Write error"));
      
      await expect(convertDocxToPdf(docxPath, pdfPath)).rejects.toThrow("Write error");
      expect(fs.readFile).toHaveBeenCalledWith(docxPath);
      expect(libre.convert).toHaveBeenCalled();
      expect(fs.outputFile).toHaveBeenCalled();
    });
  });
});