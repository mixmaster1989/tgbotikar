const { registerMaterialsHandlers } = require("../modules/materials");
const fs = require("fs-extra");
const path = require("path");

jest.mock("fs-extra"); // Мокаем файловую систему

describe("Materials Module", () => {
  const mockBot = {
    action: jest.fn(),
    reply: jest.fn(),
    replyWithDocument: jest.fn(),
    answerCbQuery: jest.fn(),
    editMessageReplyMarkup: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should list available materials", async () => {
    const mockCtx = { reply: jest.fn() };
    const mockFiles = ["file1.docx", "file2.docx"];
    fs.readdir.mockResolvedValue(mockFiles);

    registerMaterialsHandlers(mockBot);
    const materialsHandler = mockBot.action.mock.calls.find(([action]) => action === "materials")[1];
    await materialsHandler(mockCtx);

    expect(fs.readdir).toHaveBeenCalledWith(path.join(__dirname, "..", "..", "materials"));
    expect(mockCtx.reply).toHaveBeenCalledWith(
      "Выберите материал:",
      expect.any(Object) // Проверяем, что передается клавиатура
    );
  });

  test("should handle no materials available", async () => {
    const mockCtx = { reply: jest.fn() };
    fs.readdir.mockResolvedValue([]);

    registerMaterialsHandlers(mockBot);
    const materialsHandler = mockBot.action.mock.calls.find(([action]) => action === "materials")[1];
    await materialsHandler(mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith("Нет доступных материалов.");
  });

  test("should handle errors during material listing", async () => {
    const mockCtx = { reply: jest.fn() };
    fs.readdir.mockRejectedValue(new Error("Mock error"));

    registerMaterialsHandlers(mockBot);
    const materialsHandler = mockBot.action.mock.calls.find(([action]) => action === "materials")[1];
    await materialsHandler(mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith("Ошибка при получении списка материалов.");
  });
});
