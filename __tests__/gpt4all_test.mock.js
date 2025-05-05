// Простой тест для проверки наличия файла gpt4all_test.js
const path = require('path');
const fs = require('fs');

describe('GPT4All Mock Tests', () => {
  const gpt4allPath = path.join(__dirname, '../gpt4all_test.js');
  
  test('gpt4all_test.js file should exist', () => {
    const fileExists = fs.existsSync(gpt4allPath);
    expect(fileExists).toBe(true);
  });
});