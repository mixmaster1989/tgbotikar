// Подключаем мок вместо реального модуля
jest.mock("../gpt4all_test", () => require("./gpt4all_test.mock"));

const gpt4all = require("../gpt4all_test");

describe("GPT4All Model", () => {
  test("should initialize the model", async () => {
    const model = await gpt4all.loadModel();
    expect(model).toBeDefined();
    expect(gpt4all.loadModel).toHaveBeenCalled();
  });

  test("should generate text with mocked model", async () => {
    const model = await gpt4all.loadModel();
    const onTokenMock = jest.fn();
    const response = await model.generate("Привет!", { on_token: onTokenMock });

    expect(response).toBe("Это тестовый ответ от модели.");
    expect(onTokenMock).toHaveBeenCalledTimes(5); // Проверяем, что on_token вызван 5 раз (по количеству слов)
  });
});
