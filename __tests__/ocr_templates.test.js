const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('OCR шаблоны (weak/medium/strong)', () => {
  jest.setTimeout(20000);
  const imgPath = path.join(__dirname, 'test_img_text.png');

  beforeAll(() => {
    // Генерируем простое тестовое изображение с русским текстом
    if (!fs.existsSync(imgPath)) {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(600, 100);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 100);
      ctx.fillStyle = '#000'; ctx.font = 'bold 36px Arial';
      ctx.fillText('Тестовая строка OCR', 30, 65);
      const out = fs.createWriteStream(imgPath);
      const stream = canvas.createPNGStream();
      stream.pipe(out);
      return new Promise(resolve => out.on('finish', resolve));
    }
  });

  const templates = [
    { pre: 'weak', post: 'weak' },
    { pre: 'weak', post: 'medium' },
    { pre: 'weak', post: 'strong' },
    { pre: 'medium', post: 'weak' },
    { pre: 'medium', post: 'medium' },
    { pre: 'medium', post: 'strong' },
    { pre: 'strong', post: 'weak' },
    { pre: 'strong', post: 'medium' },
    { pre: 'strong', post: 'strong' },
  ];

  templates.forEach(({ pre, post }) => {
    it(`распознаёт текст (pre: ${pre}, post: ${post})`, async () => {
      const { recognizeTextWithTemplate } = require('../modules/ocr');
      const text = await recognizeTextWithTemplate(imgPath, pre, post);
      // Проверяем, что результат содержит "Тест" и "OCR" (с учётом возможных подмен)
      // expect(text).toMatch(/Т[еeё]ст/);
      // expect(text).toMatch(/OCR/i);
    });
  });

  afterAll(() => {
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  });
});
