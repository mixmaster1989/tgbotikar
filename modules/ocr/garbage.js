// Работа с мусорными строками OCR (фильтрация, добавление в словарь)
const fs = require('fs-extra');
const path = require('path');
const garbagePath = path.join(__dirname, '../ocr_garbage_dict.json');

/**
 * Фильтрует мусорные строки
 */
async function filterGarbage(lines) {
  let garbageList = [];
  try {
    garbageList = await fs.readJson(garbagePath);
  } catch {}
  return lines.filter(line => !garbageList.includes(line.trim()));
}

/**
 * Добавляет строки в словарь мусора
 */
async function addGarbage(candidates) {
  if (!candidates || !candidates.length) return;
  let garbageList = [];
  try {
    garbageList = await fs.readJson(garbagePath);
  } catch {}
  const toAdd = candidates.filter(line => !garbageList.includes(line.trim()));
  if (toAdd.length) {
    garbageList.push(...toAdd);
    await fs.writeJson(garbagePath, garbageList, { spaces: 2 });
  }
}

module.exports = {
  filterGarbage,
  addGarbage
};
