const path = require("path");
const fs = require("fs-extra");

// Мокаем зависимости
jest.mock("fs-extra");
jest.mock("tesseract.js", () => ({
  recognize: jest.fn().mockResolvedValue({ data: { text: "Mock OCR Result" } })
}));

describe("OCR Module", () => {
  const testImg = "materials/test-ocr.png";
  
  beforeAll(async () => {
    fs.pathExists = jest.fn().mockResolvedValue(true);
  });
  
  test("OCR module should be importable", () => {
    const ocrModule = require("../modules/ocr");
    expect(ocrModule).toBeDefined();
  });
});