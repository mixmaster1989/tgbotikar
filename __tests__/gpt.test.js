const { registerGptHandlers } = require("../modules/gpt");
const { initGPT4AllModel } = require("../gpt4all_test");

jest.mock("../gpt4all_test"); // Мокаем GPT4All

describe("GPT Module", () => {
  const mockBot = {
    action: jest.fn(),
    on: jest.fn(),
    reply: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should handle AI question input", async () => {
    const mockCtx = { reply: jest.fn(), from: { id: 123 } };
    registerGptHandlers(mockBot);

    const askAiHandler = mockBot.action.mock.calls.find(([action]) => action === "ask_ai")[1];
    await askAiHandler(mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith("Введите ваш вопрос для ИИ:");
  });

  test("should handle GPT generation errors", async () => {
    const mockCtx = { reply: jest.fn(), from: { id: 123 }, message: { text: "Test question" } };
    initGPT4AllModel.mockRejectedValue(new Error("Mock GPT error"));

    registerGptHandlers(mockBot);
    const textHandler = mockBot.on.mock.calls.find(([event]) => event === "text")[1];
    await textHandler(mockCtx);

    expect(mockCtx.reply).toHaveBeenCalledWith("Ошибка генерации ответа: Mock GPT error");
  });
});
