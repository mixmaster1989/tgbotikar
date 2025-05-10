const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const YaDiskService = require('../services/yadisk_service');

// Мокаем зависимости
jest.mock('fs-extra', () => ({
  createReadStream: jest.fn().mockReturnValue('mock-stream'),
  createWriteStream: jest.fn().mockReturnValue({
    on: jest.fn((event, callback) => {
      if (event === 'finish') setTimeout(callback, 10);
      return this;
    }),
    pipe: jest.fn()
  })
}));

jest.mock('axios', () => ({
  put: jest.fn().mockResolvedValue({ status: 200 }),
  get: jest.fn().mockResolvedValue({
    data: {
      pipe: jest.fn()
    }
  })
}));

describe('YandexDiskService', () => {
  const materialsPath = '/path/to/materials';
  let service;
  
  beforeEach(() => {
    // Создаем экземпляр сервиса перед каждым тестом
    service = new YaDiskService(materialsPath);
    
    // Мокаем console.log для тестов
    console.log = jest.fn();
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with materials path', () => {
      expect(service.materialsPath).toBe(materialsPath);
    });
  });

  describe('log', () => {
    test('should log messages with proper format', () => {
      service.log('info', 'test', 'Test message');
      expect(console.log).toHaveBeenCalledWith(
        '[INFO] [YaDisk/test] Test message',
        ''
      );
      
      const error = new Error('Test error');
      service.log('error', 'test', 'Error message', error);
      expect(console.log).toHaveBeenCalledWith(
        '[ERROR] [YaDisk/test] Error message',
        error
      );
    });
  });

  describe('uploadFile', () => {
    const localPath = '/local/file.txt';
    const remotePath = '/remote/file.txt';
    
    test('should upload file successfully', async () => {
      await expect(service.uploadFile(localPath, remotePath)).resolves.toBe(true);
      
      expect(fs.createReadStream).toHaveBeenCalledWith(localPath);
      expect(axios.put).toHaveBeenCalledWith(remotePath, 'mock-stream');
      
      // Проверяем, что был вызван console.log с успешным сообщением
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[SUCCESS\].*успешно загружен/),
        ''
      );
    });
    
    test('should handle upload errors', async () => {
      // Симулируем ошибку при загрузке
      axios.put.mockRejectedValueOnce(new Error('Upload failed'));
      
      await expect(service.uploadFile(localPath, remotePath)).rejects.toThrow('Upload failed');
      
      // Проверяем, что был вызван console.log с сообщением об ошибке
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[ERROR\].*Ошибка при загрузке файла/),
        expect.any(Error)
      );
    });
  });

  describe('downloadFile', () => {
    const remotePath = '/remote/file.txt';
    const localFileName = 'file.txt';
    
    test('should download file successfully', async () => {
      await expect(service.downloadFile(remotePath, localFileName)).resolves.toBe(true);
      
      // Проверяем, что был вызван console.log с успешным сообщением
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[SUCCESS\].*успешно скачан/),
        ''
      );
    });
  });

  describe('downloadFileByPath', () => {
    const remotePath = 'https://example.com/file.txt';
    const localFileName = 'file.txt';
    const localPath = path.join(materialsPath, localFileName);
    
    test('should download file by path successfully', async () => {
      await expect(service.downloadFileByPath(remotePath, localFileName)).resolves.toBe(localPath);
      
      expect(axios.get).toHaveBeenCalledWith(remotePath, { responseType: 'stream' });
      expect(fs.createWriteStream).toHaveBeenCalledWith(localPath);
      
      // Проверяем, что был вызван console.log с успешным сообщением
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[SUCCESS\].*успешно скачан/),
        ''
      );
    });
    
    test('should handle download errors', async () => {
      // Симулируем ошибку при скачивании
      axios.get.mockRejectedValueOnce(new Error('Download failed'));
      
      await expect(service.downloadFileByPath(remotePath, localFileName)).rejects.toThrow('Download failed');
      
      // Проверяем, что был вызван console.log с сообщением об ошибке
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[ERROR\].*Ошибка при скачивании/),
        expect.any(Error)
      );
    });
    
    test('should handle empty response', async () => {
      // Симулируем пустой ответ
      axios.get.mockResolvedValueOnce(null);
      
      await expect(service.downloadFileByPath(remotePath, localFileName)).rejects.toThrow('Нет данных для скачивания');
    });
  });
});