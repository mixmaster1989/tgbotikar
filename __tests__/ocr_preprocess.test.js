// __tests__/ocr_preprocess.test.js
const path = require('path');
const fs = require('fs');

describe('ocr_preprocess.py', () => {
  test('ocr_preprocess.py file should exist', () => {
    const scriptPath = path.join(__dirname, '../modules/ocr_preprocess.py');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});