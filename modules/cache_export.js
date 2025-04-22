const path = require("path");
const fs = require("fs-extra");
const { getAllCacheQuestions } = require("./cache");

// Экспорт кэша из базы в локальный JSON-файл
function exportCacheToJsonFile(localPath, callback) {
  getAllCacheQuestions((err, rows) => {
    if (err) return callback(err);
    fs.writeJson(localPath, rows, { spaces: 2 }, callback);
  });
}

// Загрузка JSON-файла на Яндекс.Диск
async function uploadCacheJsonToYadisk(yadiskInstance, localPath, remotePath) {
  try {
    await yadiskInstance.uploadFile(localPath, remotePath);
    return true;
  } catch (err) {
    throw err;
  }
}

module.exports = {
  exportCacheToJsonFile,
  uploadCacheJsonToYadisk,
};