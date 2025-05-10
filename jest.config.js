module.exports = {
  // Автоматически очищать моки между каждым тестом
  clearMocks: true,

  // Указываем директорию с тестами
  testMatch: ['**/__tests__/**/*.test.js'],

  // Файл настройки для всех тестов
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],

  // Игнорируем определенные директории
  testPathIgnorePatterns: ['/node_modules/'],

  // Таймаут для тестов (10 секунд)
  testTimeout: 10000,

  // Не запускать тесты параллельно
  maxWorkers: 1,

  // Не запускать тест gpt4all_test.test.js
  testPathIgnorePatterns: [
    '/node_modules/',
    'gpt4all_test.test.js'
  ]
};