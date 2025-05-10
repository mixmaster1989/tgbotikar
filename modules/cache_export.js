const path = require("path");
const fs = require("fs-extra");
const { getAllCacheQuestions } = require("./cache");
const logger = require("./logger");

// Экспорт кэша из базы в локальный JSON-файл
function exportCacheToJsonFile(localPath, callback) {
  getAllCacheQuestions((err, rows) => {
    if (err) {
      logger.error("Ошибка при получении кэша для экспорта: " + err.message);
      return callback(err);
    }
    fs.writeJson(localPath, rows, { spaces: 2 }, (writeErr) => {
      if (writeErr) {
        logger.error("Ошибка при записи кэша в JSON: " + writeErr.message);
      } else {
        logger.info(`Кэш успешно экспортирован в файл: ${localPath}`);
      }
      callback(writeErr);
    });
  });
}

// Загрузка JSON-файла на Яндекс.Диск
async function uploadCacheJsonToYadisk(yadiskInstance, localPath, remotePath) {
  try {
    await yadiskInstance.uploadFile(localPath, remotePath);
    logger.info(`Файл кэша успешно загружен на Яндекс.Диск: ${remotePath}`);
    return true;
  } catch (err) {
    logger.error(`Ошибка загрузки кэша на Яндекс.Диск: ${err.message}`);
    throw err;
  }
}

module.exports = {
  exportCacheToJsonFile,
  uploadCacheJsonToYadisk,
};