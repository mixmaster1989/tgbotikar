const gpt4all = {
  loadModel: jest.fn().mockResolvedValue({
    generate: jest.fn((prompt, options) => {
      const mockResponse = "Это тестовый ответ от модели.";
      if (options.on_token) {
        // Эмулируем вызов on_token для каждого слова
        mockResponse.split(" ").forEach((token) => options.on_token(token + " "));
      }
      return Promise.resolve(mockResponse);
    }),
  }),
};

module.exports = gpt4all;
