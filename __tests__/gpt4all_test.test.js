// Мокаем gpt4all
jest.mock('gpt4all', () => ({
  loadModel: jest.fn().mockResolvedValue({
    generate: jest.fn().mockImplementation((prompt, options) => {
      // Если передан callback on_token, вызываем его несколько раз
      if (options && typeof options.on_token === 'function') {
        options.on_token('Привет');
        options.on_token(', ');
        options.on_token('это');
        options.on_token(' тестовый');
        options.on_token(' ответ');
        options.on_token('!');
      }
      return Promise.resolve('Привет, это тестовый ответ!');
    })
  })
}));

describe('GPT4All Test Module', () => {
  // Сохраняем оригинальные console.log и console.error
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write;
  
  beforeEach(() => {
    // Мокаем console.log и console.error для тестов
    console.log = jest.fn();
    console.error = jest.fn();
    process.stdout.write = jest.fn();
    
    // Очищаем кэш модуля перед каждым тестом
    jest.resetModules();
  });
  
  afterEach(() => {
    // Восстанавливаем оригинальные функции
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
  });

  test('should load GPT4All model', async () => {
    // Импортируем функцию для тестирования
    const gpt4all_test = require('../gpt4all_test');
    const gpt4all = require('gpt4all');
    
    // Проверяем, что loadModel был вызван с правильным именем модели
    expect(gpt4all.loadModel).toHaveBeenCalledWith('Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf');
  });
  
  test('should generate text with the model', async () => {
    // Импортируем функцию для тестирования
    const gpt4all_test = require('../gpt4all_test');
    
    // Даем время на выполнение асинхронной функции
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Проверяем, что логи содержат ожидаемые сообщения
    expect(console.log).toHaveBeenCalledWith('Инициализация модели...');
    expect(console.log).toHaveBeenCalledWith('Модель загружена. Начинаю генерацию...');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Генерация завершена'));
    
    // Проверяем, что токены были выведены
    expect(process.stdout.write).toHaveBeenCalledWith('Привет');
    expect(process.stdout.write).toHaveBeenCalledWith(', ');
    expect(process.stdout.write).toHaveBeenCalledWith('это');
    expect(process.stdout.write).toHaveBeenCalledWith(' тестовый');
    expect(process.stdout.write).toHaveBeenCalledWith(' ответ');
    expect(process.stdout.write).toHaveBeenCalledWith('!');
  });
  
  test('should handle errors during model loading', async () => {
    // Временно переопределяем loadModel для симуляции ошибки
    const gpt4all = require('gpt4all');
    gpt4all.loadModel.mockRejectedValueOnce(new Error('Failed to load model'));
    
    // Импортируем функцию для тестирования
    const gpt4all_test = require('../gpt4all_test');
    
    // Даем время на выполнение асинхронной функции
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Проверяем, что ошибка была обработана
    expect(console.error).toHaveBeenCalledWith(
      'Ошибка при работе с GPT4All:',
      expect.objectContaining({ message: 'Failed to load model' })
    );
  });
  
  test('should handle timeout during generation', async () => {
    // Мокаем Promise.race для симуляции таймаута
    const originalPromiseRace = Promise.race;
    Promise.race = jest.fn().mockRejectedValue(
      new Error("Генерация превысила лимит времени (1 минута)")
    );
    
    // Временно переопределяем loadModel для этого теста
    const gpt4all = require('gpt4all');
    gpt4all.loadModel.mockResolvedValueOnce({
      generate: jest.fn().mockImplementation(() => {
        // Возвращаем промис, который никогда не разрешается
        return new Promise(() => {});
      })
    });
    
    // Импортируем функцию для тестирования
    const gpt4all_test = require('../gpt4all_test');
    
    // Даем время на выполнение асинхронной функции
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Проверяем, что ошибка таймаута была обработана
    expect(console.error).toHaveBeenCalledWith(
      'Ошибка при работе с GPT4All:',
      expect.objectContaining({ message: expect.stringContaining('лимит времени') })
    );
    
    // Восстанавливаем оригинальный Promise.race
    Promise.race = originalPromiseRace;
  }, 5000); // Устанавливаем разумный таймаут
});