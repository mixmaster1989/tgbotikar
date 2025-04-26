const path = require("path");
const fs = require("fs-extra");
const { recognizeText } = require("../modules/ocr");
const { semanticOcrAssemble, humanReadableAssemble } = require("../modules/ocr/postprocess");

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
  }, 420000); // 7 минут

  it("semanticOcrAssemble корректно собирает результат", () => {
    const results = [{ text: 'БУХГАЛТЕРИЯ 1С\nИП Иванов' }, { text: 'ИП Иванов\nБУХГАЛТЕРИЯ 1С' }];
    const out = semanticOcrAssemble(results);
    expect(out).toMatch(/БУХГАЛТЕРИЯ 1С/);
    expect(out).toMatch(/ИП Иванов/);
  });

  it("humanReadableAssemble возвращает читаемый текст", () => {
    const input = 'строка1\nстрока2';
    const out = humanReadableAssemble(input);
    expect(out).toContain('строка1');
    expect(out).toContain('строка2');
  });
});
