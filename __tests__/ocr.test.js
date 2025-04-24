const path = require("path");
const fs = require("fs-extra");
const { recognizeText } = require("../modules/ocr");

describe("modules/ocr.js", () => {
  const testImg = path.join(__dirname, "..", "materials", "test-ocr.png");

  beforeAll(async () => {
    if (!(await fs.pathExists(testImg))) {
      throw new Error("Для теста нужен файл materials/test-ocr.png с текстом для OCR");
    }
  });

  it("распознаёт текст на тестовом изображении", async () => {
    const text = await recognizeText(testImg);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    // Можно добавить проверку на наличие ожидаемой подстроки:
    // expect(text).toMatch(/ожидаемый_текст/i);
  }, 20000); // OCR может быть медленным
});
