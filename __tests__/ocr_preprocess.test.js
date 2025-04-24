const { execFile } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

describe('ocr_preprocess.py', () => {
  const input = path.join(__dirname, '..', 'materials', 'test-ocr.png');
  const output = path.join(__dirname, '..', 'materials', 'test-ocr-preprocessed.png');

  beforeAll(async () => {
    if (!(await fs.pathExists(input))) {
      throw new Error('Для теста нужен файл materials/test-ocr.png');
    }
    if (await fs.pathExists(output)) {
      await fs.remove(output);
    }
  });

  it('обрабатывает документ без ошибок и создаёт выходной файл', (done) => {
    execFile('python3', [path.join(__dirname, '../modules/ocr_preprocess.py'), input, output], (err) => {
      expect(err).toBeNull();
      fs.pathExists(output).then(exists => {
        expect(exists).toBe(true);
        done();
      });
    });
  }, 30000);
});
