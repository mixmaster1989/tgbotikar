const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('easyocr_pipeline.py', () => {
  it('распознаёт текст без ошибок', () => {
    // Генерируем простое тестовое изображение с текстом "Тест OCR"
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(400, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 100);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('Тест OCR', 30, 65);
    const testImg = path.join(__dirname, 'test_easyocr_img.png');
    const out = fs.createWriteStream(testImg);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    return new Promise((resolve, reject) => {
      out.on('finish', () => {
        try {
          const pipelineScript = path.join(__dirname, '../modules/easyocr_pipeline.py');
          const cmd = `python3 "${pipelineScript}" "${testImg}"`;
          let output = '';
          try {
            output = execFileSync('python3', [pipelineScript, testImg], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
          } catch (e) {
            output = e.stdout || e.stderr || '';
          }
          // Фиксируем возможную латиницу вместо кириллицы
          function fixLatinCyrillic(str) {
            const latinToCyrillic = {
              'A': 'А', 'B': 'В', 'E': 'Е', 'K': 'К', 'M': 'М', 'H': 'Н', 'O': 'О', 'P': 'Р', 'C': 'С', 'T': 'Т', 'X': 'Х',
              'a': 'а', 'b': 'в', 'e': 'е', 'k': 'к', 'm': 'м', 'h': 'н', 'o': 'о', 'p': 'р', 'c': 'с', 't': 'т', 'x': 'х'
            };
            return str.replace(/[A-Za-z]/g, ch => latinToCyrillic[ch] || ch);
          }
          output = fixLatinCyrillic(output);
          expect(output).toMatch(/Тест/i);
          expect(output).toMatch(/OCR/i);
          expect(output).toMatch(/RAW OCR TEXT/);
          fs.unlinkSync(testImg);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
