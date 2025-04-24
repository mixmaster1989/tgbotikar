const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('ocr_pipeline.py', () => {
  const testImg = path.join(__dirname, 'test_img.jpg');
  const pipelineScript = path.join(__dirname, '../modules/ocr_pipeline.py');

  beforeAll(() => {
    // Простой чёрно-белый png для smoke-теста (создаём если нет)
    if (!fs.existsSync(testImg)) {
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(200, 60);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,60);
      ctx.fillStyle = '#000'; ctx.font = '20px Arial';
      ctx.fillText('Тест OCR', 20, 35);
      const out = fs.createWriteStream(testImg);
      const stream = canvas.createJPEGStream();
      stream.pipe(out);
    }
  });

  it('распознаёт текст без ошибок', () => {
    const cmd = `python3 "${pipelineScript}" "${testImg}"`;
    let output = '';
    try {
      output = execSync(cmd, { encoding: 'utf8' });
    } catch (e) {
      output = e.stdout || e.stderr || '';
    }
    expect(output).toMatch(/Тест/i);
    expect(output).toMatch(/OCR/i);
    expect(output).toMatch(/RAW OCR TEXT/);
  });
});
