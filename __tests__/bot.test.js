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
}));

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
}));

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
      const { bot } = require('../bot');
      
      // Проверяем, что Telegraf был вызван с правильным токеном
      const { Telegraf } = require('telegraf');
      expect(Telegraf).toHaveBeenCalledWith('test_token');
    });
    
    test('should use session middleware', () => {
      const { bot } = require('../bot');
      
      // Проверяем, что session был вызван
      const { session } = require('telegraf');
      expect(session).toHaveBeenCalled();
      
      // Проверяем, что bot.use был вызван
      expect(bot.use).toHaveBeenCalled();
    });
  });

  describe('Express Server', () => {
    test('should initialize express server', () => {
      const { app } = require('../bot');
      
      // Проверяем, что express был вызван
      const express = require('express');
      expect(express).toHaveBeenCalled();
      
      // Проверяем, что статическая директория была настроена
      expect(app.use).toHaveBeenCalledWith(
        '/static',
        expect.any(Function)
      );
    });
  });

  describe('Handlers Registration', () => {
    test('should register all handlers', () => {
      const { bot } = require('../bot');
      
      // Проверяем, что все обработчики были зарегистрированы
      const { registerOcrHandlers } = require('../modules/ocr');
      const { registerCacheHandlers } = require('../modules/cache');
      const { registerMaterialsHandlers } = require('../modules/materials');
      const { registerGptHandlers } = require('../modules/gpt');
      
      expect(registerOcrHandlers).toHaveBeenCalledWith(bot);
      expect(registerCacheHandlers).toHaveBeenCalledWith(bot);
      expect(registerMaterialsHandlers).toHaveBeenCalledWith(bot);
      expect(registerGptHandlers).toHaveBeenCalledWith(bot);
    });
  });

  describe('Command Handlers', () => {
    test('should register start command handler', () => {
      const { bot } = require('../bot');
      
      // Проверяем, что обработчик команды /start был зарегистрирован
      expect(bot.start).toHaveBeenCalled();
    });
    
    test('should register reset action handler', () => {
      const { bot } = require('../bot');
      
      // Проверяем, что обработчик действия reset был зарегистрирован
      expect(bot.action).toHaveBeenCalledWith('reset', expect.any(Function));
    });
  });
});