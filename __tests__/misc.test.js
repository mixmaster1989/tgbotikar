const botModule = require("../bot");
const logger = require("../modules/logger");
const fs = require("fs-extra");
const path = require("path");

// Добавим afterEach для очистки mocks
afterEach(() => {
  jest.clearAllMocks && jest.clearAllMocks();
});

describe("mainMenuKeyboard", () => {
  it("возвращает корректную структуру клавиатуры", () => {
    expect(typeof botModule.mainMenuKeyboard).toBe('function');
    const keyboard = botModule.mainMenuKeyboard();
    expect(keyboard.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
    expect(keyboard.reply_markup.inline_keyboard[0][0].text).toBeDefined();
  });
});

describe("parseDocxToText", () => {
  it("выбрасывает ошибку для несуществующего файла", async () => {
    expect(typeof botModule.parseDocxToText).toBe('function');
    await expect(botModule.parseDocxToText("no_such_file.docx")).rejects.toThrow();
  });

  // Для этого теста нужен реальный docx-файл
  it("корректно извлекает текст из docx", async () => {
    const docxPath = path.join(__dirname, "..", "materials", "test.docx");
    if (!(await fs.pathExists(docxPath))) return;
    const text = await botModule.parseDocxToText(docxPath);
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