const { smartJoinAndCorrect } = require('../modules/ocr');

describe('OCR постобработка', () => {
  it('склеивает строки и исправляет простые опечатки', () => {
    const input = `РЫЬА\nмолоко\nЭто\nтест\nпрошл\n`; // "прошл" не исправится, а "РЫЬА" — да
    const output = smartJoinAndCorrect(input);
    expect(output).toMatch(/РЫБА/);
    expect(output).toMatch(/молоко/);
    expect(output).not.toMatch(/РЫЬА/);
    expect(output).toMatch(/Это тест прошл/); // строки склеены
  });
});
