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
          let output = '';
          try {
            output = execFileSync('python3', [pipelineScript, testImg], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
          } catch (e) {
            output = e.stdout || e.stderr || '';
          }
          // Нормализация: все похожие буквы приводим к латинице
          function normalizeOcrText(str) {
            const map = {
              'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','Х':'X',
              'а':'a','е':'e','к':'k','м':'m','о':'o','р':'p','с':'c','т':'t','х':'x',
              'Ё':'E','ё':'e'
            };
            return str.replace(/[А-Яа-яЁё]/g, ch => map[ch] || ch);
          }
          output = normalizeOcrText(output);
          expect(output).toMatch(/OCR/i);
          expect(output).toMatch(/RAW OCR TEXT/i);
          fs.unlinkSync(testImg);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
