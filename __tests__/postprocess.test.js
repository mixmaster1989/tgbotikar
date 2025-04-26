const { smartJoinAndCorrect, semanticOcrAssemble, humanReadableAssemble } = require('../modules/ocr/postprocess');

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

describe('semanticOcrAssemble', () => {
  it('выделяет чистые строки и убирает дубли', () => {
    const results = [
      { text: 'БУХГАЛТЕРИЯ 1С\nИП Иванов\nПодпись' },
      { text: 'ИП Иванов\nБУХГАЛТЕРИЯ 1С' },
      { text: 'Денежный ящик\nБУХГАЛТЕРИЯ 1С' }
    ];
    const out = semanticOcrAssemble(results);
    expect(out).toMatch(/БУХГАЛТЕРИЯ 1С/);
    expect(out).toMatch(/ИП Иванов/);
    expect(out).toMatch(/Денежный ящик/);
    // Дубли убраны
    expect((out.match(/БУХГАЛТЕРИЯ 1С/g) || []).length).toBe(1);
  });
});

describe('humanReadableAssemble', () => {
  it('склеивает строки с сохранением читаемости', () => {
    const input = 'строка1\nстрока2\nстрока3';
    const out = humanReadableAssemble(input);
    expect(out).toContain('строка1');
    expect(out).toContain('строка2');
    expect(out).toContain('строка3');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });
});
