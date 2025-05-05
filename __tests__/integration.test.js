const { registerOcrHandlers } = require("../modules/ocr");
const { saveToCacheAndSync } = require("../modules/cache");

jest.mock("../modules/cache"); // Мокаем кэш

describe("Integration Tests", () => {
  const mockBot = {
    on: jest.fn(),
    reply: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should save OCR results to cache", async () => {
    const mockCtx = {
      reply: jest.fn(),
      session: { lastPhotoPath: "/path/to/photo.jpg" },
    };

    saveToCacheAndSync.mockResolvedValue(true);

    registerOcrHandlers(mockBot);
    const photoHandler = mockBot.on.mock.calls.find(([event]) => event === "photo")[1];
    await photoHandler(mockCtx);

    expect(saveToCacheAndSync).toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining("Выберите способ обработки OCR:"));
  });

  test("should handle errors during OCR and cache interaction", async () => {
    const mockCtx = {
      reply: jest.fn(),
      session: { lastPhotoPath: "/path/to/photo.jpg" },
    };

    saveToCacheAndSync.mockRejectedValue(new Error("Mock cache error"));

    registerOcrHandlers(mockBot);
    const photoHandler = mockBot.on.mock.calls.find(([event]) => event === "photo")[1];
    await photoHandler(mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith("Ошибка при распознавании: Mock cache error");
  });
});
