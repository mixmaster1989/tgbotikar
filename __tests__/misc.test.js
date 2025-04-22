const { mainMenuKeyboard, parseDocxToText } = require("../bot");
const logger = require("../modules/logger");
const fs = require("fs-extra");
const path = require("path");

jest.mock('pdf-poppler', () => ({
  convert: jest.fn(),
}));

describe("mainMenuKeyboard", () => {
  it("возвращает корректную структуру клавиатуры", () => {
    const keyboard = mainMenuKeyboard();
    expect(keyboard.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
    expect(keyboard.reply_markup.inline_keyboard[0][0].text).toBeDefined();
  });
});

describe("parseDocxToText", () => {
  it("выбрасывает ошибку для несуществующего файла", async () => {
    await expect(parseDocxToText("no_such_file.docx")).rejects.toThrow();
  });

  // Для этого теста нужен реальный docx-файл
  it("корректно извлекает текст из docx", async () => {
    const docxPath = path.join(__dirname, "..", "materials", "test.docx");
    if (!(await fs.pathExists(docxPath))) return;
    const text = await parseDocxToText(docxPath);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("logger", () => {
  it("логирует info без ошибок", () => {
    expect(() => logger.info("test info")).not.toThrow();
  });
  it("логирует error без ошибок", () => {
    expect(() => logger.error("test error")).not.toThrow();
  });
});