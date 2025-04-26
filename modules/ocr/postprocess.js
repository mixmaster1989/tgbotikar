// Семантическая сборка и финальная сборка для Telegram (выделено из bot.js)
const fuzzysort = require('fuzzysort');

function semanticOcrAssemble(results) {
  function splitToBlocks(text) {
    return text
      .split(/[\n\r\f\v\u2028\u2029\u0085]+/)
      .flatMap(line =>
        line
          .split(/\s{2,}|\||:|—|–|—|\.|,|;/)
          .map(x => x.trim())
      )
      .filter(Boolean);
  }
  function isClean(line) {
    const words = (line.match(/[а-яА-ЯёЁ]{4,}/g) || []);
    const letterFrac = (line.replace(/[^а-яА-ЯёЁ]/g, '').length / (line.length || 1));
    return words.length >= 2 && letterFrac > 0.6;
  }
  let allBlocks = [];
  results.forEach(r => {
    allBlocks = allBlocks.concat(splitToBlocks(r.text));
  });
  allBlocks = allBlocks.filter(isClean);
  const freq = {};
  allBlocks.forEach(line => { freq[line] = (freq[line] || 0) + 1; });
  allBlocks = [...new Set(allBlocks)];
  allBlocks.sort((a, b) => freq[b] - freq[a] || b.length - a.length);
  const finalLines = [];
  allBlocks.forEach(line => {
    if (!finalLines.some(existing => {
      const res = fuzzysort.single(line, [existing], { threshold: -30 });
      return res && res.score > -30;
    })) {
      finalLines.push(line);
    }
  });
  const keywords = [
    'ИП', '1С', 'БУХГАЛТЕРИЯ', 'Денежный ящик', 'Форт', 'позиционный', 'руб', 'Подпись', 'дата', 'автоматизация', 'принтер', 'сканер', 'весовое', 'терминал', 'POS'
  ];
  finalLines.sort((a, b) => {
    const ka = keywords.findIndex(k => a.toLowerCase().includes(k.toLowerCase()));
    const kb = keywords.findIndex(k => b.toLowerCase().includes(k.toLowerCase()));
    if (ka !== kb) return (ka === -1 ? 100 : ka) - (kb === -1 ? 100 : kb);
    return b.length - a.length;
  });
  return finalLines.join('\n');
}

function humanReadableAssemble(text) {
  const keyPhrases = [
    "1С БУХГАЛТЕРИЯ",
    "АВТОМАТИЗАЦИЯ ТОРГОВЛИ",
    "ПРИНТЕРЫ ЭТИКЕТОК",
    "СКАНЕРЫ ШТРИХ-КОДА",
    "ВЕСОВОЕ ОБОРУДОВАНИЕ",
    "ТЕРМИНАЛЫ СБОРА ДАННЫХ",
    "POS-системы"
  ];
  const lines = text.split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(Boolean);
  const uniq = new Set();
  const result = [];
  for (const phrase of keyPhrases) {
    let best = '';
    let bestScore = -100;
    for (const line of lines) {
      const words = phrase.split(' ');
      let score = 0;
      for (const w of words) if (line.includes(w)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    }
    if (bestScore >= 2 && !uniq.has(phrase)) {
      result.push(phrase);
      uniq.add(phrase);
    }
  }
  if (result.length === 0) {
    const filtered = lines.filter(line =>
      line.length >= 8 &&
      /[А-ЯЁ]{2,}/.test(line) &&
      /[A-ZА-ЯЁ0-9]/.test(line) &&
      !/^[-_=]+$/.test(line) &&
      line.replace(/[^А-ЯЁ]/g, '').length >= 0.5 * line.length
    );
    const uniqFiltered = [...new Set(filtered)];
    if (uniqFiltered.length === 0) {
      const anyLines = [...new Set(lines.filter(line => line.length >= 5))];
      return anyLines.slice(0, 3).join('\n');
    }
    return uniqFiltered.sort((a, b) => b.length - a.length).slice(0, 5).join('\n');
  }
  return result.join('\n');
}

module.exports = {
  semanticOcrAssemble,
  humanReadableAssemble
};
