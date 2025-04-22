const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fuzzysort = require("fuzzysort");
const logger = require("./logger");

const db = new sqlite3.Database(path.join(__dirname, "..", "database.sqlite"));

function saveToCacheHistory(file, summary) {
  const stmt = db.prepare("INSERT INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(file, summary, function (err) {
    if (err) {
      logger.error("Ошибка при сохранении в кэш: " + err.message);
    } else {
      logger.info(`Запись добавлена в кэш: "${file}"`);
    }
  });
  stmt.finalize();
}

function getAllCacheQuestions(callback) {
  db.all("SELECT id, prompt, response FROM gpt_cache", (err, rows) => {
    if (err) {
      logger.error("Ошибка при получении всех вопросов из кэша: " + err.message);
      return callback(err, []);
    }
    logger.info(`Получено ${rows.length} записей из кэша`);
    callback(null, rows);
  });
}

function fuzzyFindInCache(question, callback) {
  getAllCacheQuestions((err, rows) => {
    if (err) {
      logger.error("Ошибка fuzzy поиска в кэше: " + err.message);
      return callback(err, null);
    }
    const results = fuzzysort.go(question, rows, { key: 'prompt', threshold: -1000 });
    if (results.length > 0 && results[0].score > -1000) {
      logger.info(`Fuzzy найдено совпадение для "${question}"`);
      callback(null, results[0].obj.response);
    } else {
      logger.info(`Fuzzy совпадений не найдено для "${question}"`);
      callback(null, null);
    }
  });
}

module.exports = {
  saveToCacheHistory,
  getAllCacheQuestions,
  fuzzyFindInCache,
};