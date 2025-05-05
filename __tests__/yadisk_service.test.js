const path = require('path');
const fs = require('fs');

// Простой тест для проверки наличия файла сервиса
describe('YandexDiskService', () => {
  const servicePath = path.join(__dirname, '../services/yadisk_service.js');
  
  test('service file should exist', () => {
    const fileExists = fs.existsSync(servicePath);
    expect(fileExists).toBe(true);
  });
});