// __tests__/bot.test.js
const fs = require('fs');
const path = require('path');

describe('Bot', () => {
  test('bot.js file should exist', () => {
    const botPath = path.join(__dirname, '../bot.js');
    expect(fs.existsSync(botPath)).toBe(true);
  });
});