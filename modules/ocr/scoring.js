// Оценка качества OCR, выбор лучшего результата, scoring-функции
const logger = require('../logger');
const stringSimilarity = require('string-similarity'); // Добавить в начало файла

/**
 * Оценивает качество текста (примерная формула)
 */
function evalHumanReadableScore(text) {
  if (!text || typeof text !== 'string') return 0;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const totalChars = text.length;
  const ruChars = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const ruRatio = ruChars / (totalChars || 1);
  const uniqLines = new Set(lines).size;
  const bonusWords = [
    "АКТИВИРУЙТЕ", "СКАЧАЙТЕ", "ПРИЛОЖЕНИЕ", "МАГАЗИН", "СЕРВИСЫ", "ЭВОТОР"
  ];
  let bonus = 0;
  for (const w of bonusWords) if (text.toUpperCase().includes(w)) bonus += 0.1;
  // Мусорные строки
  const noisyLines = lines.filter(l => l.length < 5 || (l.replace(/[А-Яа-яЁё0-9]/gi, '').length / l.length) > 0.5).length;
  // Бонус за разнообразие и полезную структуру
  const diversityBonus = uniqLines >= 3 ? 0.5 : 0;
  // Итоговая формула
  let score = (
    ruRatio * 2 +
    Math.min(lines.length / 10, 1) +
    Math.min(uniqLines / lines.length, 1) +
    bonus +
    diversityBonus -
    noisyLines * 0.2
  );
  if (lines.length === 1 && lines[0].length < 10) score -= 0.5;
  return score;
}

/**
 * Выбирает лучший результат OCR из всех кандидатов
 */
function selectBestOcrResult(allResults, semanticResult, cleanedSemantic, humanResult) {
  const candidates = [];
  allResults.forEach((r, i) => candidates.push({
    text: r,
    label: `Шаблон ${i + 1}`,
    score: evalHumanReadableScore(r)
  }));
  candidates.push({ text: semanticResult, label: 'Семантическая сборка', score: evalHumanReadableScore(semanticResult) });
  candidates.push({ text: cleanedSemantic, label: 'После LanguageTool', score: evalHumanReadableScore(cleanedSemantic) });
  candidates.push({ text: humanResult, label: 'Финальный (humanReadableAssemble)', score: evalHumanReadableScore(humanResult) });
  candidates.sort((a, b) => b.score - a.score);
  logger.info('[BOT] --- Сравнение вариантов OCR ---');
  candidates.forEach(c => {
    logger.info(`[BOT] ${c.label}: score=${c.score.toFixed(2)}\n${c.text}\n---`);
  });
  logger.info(`[BOT] Лучший результат: ${candidates[0].label} (оценка: ${candidates[0].score.toFixed(2)})`);
  logger.info(`[BOT] Лучший текст:\n${candidates[0].text}`);
  return candidates[0].text;
}

/**
 * Объединяет строки из всех результатов шаблонов, убирает дубликаты (fuzzy), сохраняет порядок.
 * @param {Array<{tplName: string, text: string}>} allResults
 * @returns {string} - итоговый текст
 */
function mergeOcrResultsNoDuplicates(allResults) {
  // Новый подход: сравниваем не только блоки, но и множество нормализованных строк (set-based fuzzy)
  const seenBlockSets = [];
  const seenLines = new Set();
  const merged = [];
  const SIMILARITY_THRESHOLD = 0.93; // чуть выше, чтобы не слипались разные блоки

  // Нормализация строки для сравнения
  function normalizeLine(line) {
    return line
      .replace(/[\s\r\n]+/g, ' ')
      .replace(/[^а-яa-z0-9]/gi, '')
      .toLowerCase()
      .trim();
  }

  // Получить отсортированный массив нормализованных строк блока
  function getBlockSet(text) {
    return Array.from(
      new Set(
        text
          .split(/\r?\n/)
          .map(l => normalizeLine(l))
          .filter(Boolean)
      )
    ).sort();
  }

  // Сравнить два блока по множеству строк (Jaccard similarity)
  function jaccardSimilarity(setA, setB) {
    const set1 = new Set(setA);
    const set2 = new Set(setB);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  for (const result of allResults) {
    const blockLines = getBlockSet(result.text);
    if (!blockLines.length) continue;

    let isDuplicate = false;
    for (const prevBlock of seenBlockSets) {
      const sim = jaccardSimilarity(blockLines, prevBlock);
      if (sim >= SIMILARITY_THRESHOLD) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;
    seenBlockSets.push(blockLines);

    // Добавляем уникальные строки блока
    const lines = result.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const norm = normalizeLine(line);
      if (norm && !seenLines.has(norm)) {
        seenLines.add(norm);
        merged.push(line);
      }
    }
  }
  const finalText = merged.join('\n');
  logger.info(`[BOT] mergeOcrResultsNoDuplicates итоговый текст:\n${finalText}`);
  return finalText;
}

module.exports = {
  evalHumanReadableScore,
  selectBestOcrResult,
  mergeOcrResultsNoDuplicates
};
