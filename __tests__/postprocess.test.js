const { smartJoinAndCorrect } = require('../modules/ocr');

describe('OCR постобработка', () => {
  it('склеивает строки и исправляет простые опечатки с естественным регистром', () => {
    const input = `РЫЬА\nмолоко\nЭто\nтест\nпрошл\n`; // "прошл" не исправится, а "РЫЬА" — да
    const output = smartJoinAndCorrect(input);
    // Только первая буква строки с большой, остальные — как в обычном тексте
    expect(output).toMatch(/^Рыба молоко Это тест прошл[иь]?/); // строка склеена, первая буква большая
    expect(output).not.toMatch(/РЫЬА/);
    // Проверка, что только первая буква строки заглавная
    for (const line of output.split(/\r?\n/)) {
      if (line.length > 0) {
        expect(line[0]).toMatch(/[А-ЯЁ]/);
        expect(line.slice(1)).not.toMatch(/[А-ЯЁ]{2,}/); // нет лишних заглавных подряд
      }
    }
  });
});
