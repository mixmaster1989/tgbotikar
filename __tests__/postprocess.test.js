const { smartJoinAndCorrect } = require('../modules/ocr');

describe('OCR постобработка', () => {
  it('склеивает строки и исправляет простые опечатки с правильным регистром', () => {
    const input = `РЫЬА\nмолоко\nЭто\nтест\nпрошл\n`; // "прошл" не исправится, а "РЫЬА" — да
    const output = smartJoinAndCorrect(input);
    expect(output).toMatch(/Рыба/); // Первая буква строки с большой
    expect(output).toMatch(/Молоко/);
    expect(output).not.toMatch(/РЫЬА/);
    expect(output).toMatch(/Это тест прошл/); // строки склеены
    // Проверка, что первая буква строки всегда большая
    for (const line of output.split(/\r?\n/)) {
      if (line.length > 0) expect(line[0]).toMatch(/[А-ЯЁ]/);
    }
  });
});
