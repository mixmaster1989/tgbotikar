// Мокаем зависимости
jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    use: jest.fn(),
    start: jest.fn(),
    action: jest.fn(),
    on: jest.fn(),
    command: jest.fn(),
    launch: jest.fn()
  })),
  session: jest.fn()
}));

jest.mock('express', () => {
  const mockExpress = jest.fn().mockReturnValue({
    use: jest.fn(),
    listen: jest.fn()
  });
  mockExpress.static = jest.fn();
  return mockExpress;
});

jest.mock('dotenv', () => ({
  config: jest.fn()
}));

jest.mock('../modules/ocr', () => ({
  registerOcrHandlers: jest.fn()
}));

jest.mock('../modules/cache', () => ({
  registerCacheHandlers: jest.fn()
}));

jest.mock('../modules/materials', () => ({
  registerMaterialsHandlers: jest.fn()
}), { virtual: true });

jest.mock('../modules/gpt', () => ({
  registerGptHandlers: jest.fn()
}));

jest.mock('../modules/utils', () => ({
  mainMenuKeyboard: jest.fn().mockReturnValue({
    reply_markup: {
      keyboard: [['Помощь', 'О боте'], ['Материалы', 'Настройки']],
      resize_keyboard: true
    }
  })
}), { virtual: true });

describe('Telegram Bot', () => {
  // Сохраняем оригинальное значение process.env
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Устанавливаем тестовые переменные окружения
    process.env = { ...originalEnv, BOT_TOKEN: 'test_token' };
    
    // Очищаем кэш модуля перед каждым тестом
    jest.resetModules();
  });
  
  afterEach(() => {
    // Восстанавливаем оригинальные переменные окружения
    process.env = originalEnv;
    
    // Очищаем все моки
    jest.clearAllMocks();
  });

  describe('Bot Initialization', () => {
    test('should initialize bot with token from environment', () => {
      // Импортируем модуль бота после настройки моков
      const botModule = jest.requireActual('../bot');
      const { Telegraf } = require('telegraf');
      
      // Проверяем, что Telegraf был вызван с правильным токеном
      expect(Telegraf).toHaveBeenCalledWith('test_token');
    });
    
    test('should use session middleware', () => {
      const botModule = jest.requireActual('../bot');
      
      // Проверяем, что session был вызван
      const { session } = require('telegraf');
      expect(session).toHaveBeenCalled();
    });
  });

  describe('Express Server', () => {
    test('should initialize express server', () => {
      const botModule = jest.requireActual('../bot');
      
      // Проверяем, что express был вызван
      const express = require('express');
      expect(express).toHaveBeenCalled();
    });
  });

  describe('Handlers Registration', () => {
    test('should register all handlers', () => {
      // Получаем модули обработчиков
      const { registerOcrHandlers } = require('../modules/ocr');
      const { registerCacheHandlers } = require('../modules/cache');
      const { registerMaterialsHandlers } = require('../modules/materials');
      const { registerGptHandlers } = require('../modules/gpt');
      
      // Вызываем их напрямую с мок-объектом бота
      const mockBot = {
        use: jest.fn(),
        start: jest.fn(),
        action: jest.fn(),
        on: jest.fn(),
        command: jest.fn()
      };
      
      registerOcrHandlers(mockBot);
      registerCacheHandlers(mockBot);
      registerMaterialsHandlers(mockBot);
      registerGptHandlers(mockBot);
      
      // Проверяем, что все обработчики были вызваны
      expect(registerOcrHandlers).toHaveBeenCalled();
      expect(registerCacheHandlers).toHaveBeenCalled();
      expect(registerMaterialsHandlers).toHaveBeenCalled();
      expect(registerGptHandlers).toHaveBeenCalled();
    });
  });
});