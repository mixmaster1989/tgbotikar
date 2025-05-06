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

// Мокаем child_process для предотвращения запуска реальных процессов
jest.mock('child_process', () => {
  const originalModule = jest.requireActual('child_process');
  return {
    ...originalModule,
    spawn: jest.fn((command, args, options) => {
      // Создаем мок для процесса
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        unref: jest.fn(),
        kill: jest.fn()
      };
      
      // Сохраняем процесс в глобальной переменной для последующего завершения
      if (!global.__mockProcesses) {
        global.__mockProcesses = [];
      }
      global.__mockProcesses.push(mockProcess);
      
      return mockProcess;
    }),
    execSync: jest.fn(() => "")
  };
});

// Глобальные настройки для всех тестов
beforeAll(() => {
  // Инициализируем массив для хранения мок-процессов
  global.__mockProcesses = [];
  
  // Мокаем setTimeout для предотвращения утечек таймеров
  const originalSetTimeout = global.setTimeout;
  global.__originalSetTimeout = originalSetTimeout;
  global.setTimeout = jest.fn((callback, delay) => {
    if (delay > 1000) {
      // Для длительных таймаутов вызываем колбэк сразу
      callback();
      return 999;
    }
    // Для коротких таймаутов используем оригинальный setTimeout
    return originalSetTimeout(callback, delay);
  });
});

afterAll(() => {
  // Завершаем все мок-процессы
  if (global.__mockProcesses) {
    global.__mockProcesses.forEach(process => {
      if (process.kill) process.kill();
    });
    global.__mockProcesses = [];
  }
  
  // Восстанавливаем оригинальный setTimeout
  if (global.__originalSetTimeout) {
    global.setTimeout = global.__originalSetTimeout;
  }
  
  // Очищаем все таймеры
  jest.useRealTimers();
});