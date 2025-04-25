const fs = require('fs-extra');
const path = require('path');
const garbagePath = path.join(__dirname, 'ocr_garbage_dict.json');

// Загружает словарь мусорных строк
async function loadGarbage() {
  try {
    const arr = await fs.readJson(garbagePath);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Добавляет новые строки в словарь (без дублей)
async function addGarbage(lines) {
  const current = await loadGarbage();
  let changed = false;
  for (const l of lines) {
    const clean = l.trim();
    if (clean.length > 0 && !current.includes(clean)) {
      current.push(clean);
      changed = true;
    }
  }
  if (changed) await fs.writeJson(garbagePath, current, { spaces: 2 });
}

// Фильтрует мусорные строки
async function filterGarbage(lines) {
  const garbage = await loadGarbage();
  return lines.filter(l => !garbage.includes(l.trim()));
}

module.exports = { loadGarbage, addGarbage, filterGarbage };
