const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fuzzysort = require("fuzzysort");

const db = new sqlite3.Database(path.join(__dirname, "..", "database.sqlite"));

function saveToCacheHistory(file, summary) {
  const stmt = db.prepare("INSERT INTO gpt_cache (prompt, response) VALUES (?, ?)");
  stmt.run(file, summary);
  stmt.finalize();
}

function getAllCacheQuestions(callback) {
  db.all("SELECT prompt, response FROM gpt_cache", (err, rows) => {
    if (err) return callback(err, []);
    callback(null, rows);
  });
}

function fuzzyFindInCache(question, callback) {
  getAllCacheQuestions((err, rows) => {
    if (err) return callback(err, null);
    const results = fuzzysort.go(question, rows, { key: 'prompt', threshold: -1000 });
    if (results.length > 0 && results[0].score > -1000) {
      callback(null, results[0].obj.response);
    } else {
      callback(null, null);
    }
  });
}

module.exports = {
  saveToCacheHistory,
  getAllCacheQuestions,
  fuzzyFindInCache,
};