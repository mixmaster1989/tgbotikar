const { spawn } = require('child_process');
const fetch = require('node-fetch');
const assert = require('assert');

// Импортируем функцию автостарта из ocr.js
const ocr = require('./ocr');

async function waitForLanguageTool(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://localhost:8081/v2/check?language=ru-RU&text=тест');
      if (res.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('LanguageTool server did not start in time');
}

(async () => {
  console.log('Проверка автостарта LanguageTool...');
  await waitForLanguageTool();
  const res = await fetch('http://localhost:8081/v2/check?language=ru-RU&text=Привет%20мир');
  const json = await res.json();
  assert(json && typeof json === 'object' && 'matches' in json, 'Некорректный ответ от LanguageTool');
  console.log('LanguageTool автостартует и отвечает: OK');
})();
