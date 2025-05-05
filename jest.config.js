module.exports = {
  // Указываем директорию с тестами
  testMatch: ['**/__tests__/**/*.test.js'],
  
  // Настройка окружения
  testEnvironment: 'node',
  
  // Настройка покрытия кода
  collectCoverage: false,
  coverageDirectory: 'coverage',
  
  // Игнорируем определенные директории
  testPathIgnorePatterns: [
    '/node_modules/',
    'ocr_templates.test.js',
    'materials.test.js',
    'misc.test.js',
    'gpt.test.js'
  ],
  
  // Настройка моков
  setupFilesAfterEnv: ['./__tests__/setup.js'],
  
  // Таймаут для тестов (в миллисекундах)
  testTimeout: 30000,
  
  // Максимальное количество воркеров
  maxWorkers: '50%',
  
  // Вывод информации о тестах
  verbose: true,
};