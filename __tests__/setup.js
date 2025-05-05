// Настройка глобальных моков для Jest

// Мокаем модули, которые вызывают проблемы
jest.mock('canvas', () => ({
  createCanvas: jest.fn(() => ({
    getContext: jest.fn(() => ({
      fillStyle: '',
      fillRect: jest.fn(),
      fillText: jest.fn(),
      font: ''
    })),
    createPNGStream: jest.fn(() => ({
      pipe: jest.fn()
    }))
  }))
}), { virtual: true });

// Мокаем модуль cache для интеграционных тестов
jest.mock('../modules/cache', () => {
  const originalModule = jest.requireActual('../modules/cache');
  return {
    ...originalModule,
    saveToCacheAndSync: jest.fn().mockResolvedValue(true),
    fuzzyFindInYandexDisk: jest.fn().mockResolvedValue(null)
  };
});

// Глобальные настройки для всех тестов
beforeAll(() => {
  // Подавляем вывод консоли во время тестов, если нужно
  // jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  // Восстанавливаем консоль, если нужно
  // console.log.mockRestore();
});