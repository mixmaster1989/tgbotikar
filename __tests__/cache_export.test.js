const path = require("path");
const fs = require("fs-extra");
const { exportCacheToJsonFile } = require("../modules/cache_export");
const { saveToCacheHistory, fuzzyFindInCache } = require("../modules/cache");
const db = require('sqlite3').verbose();
const database = new db.Database(path.join(__dirname, '..', 'database.sqlite'));

describe("Cache export module", () => {
  const localPath = path.join(__dirname, "..", "cache", "dataset.test.json");

  beforeEach((done) => {
    database.run("DELETE FROM gpt_cache WHERE prompt = ?", [question], done);
  });

  it("should export cache to JSON after saving new entry", (done) => {
    const question = "Тестовый вопрос для экспорта";
    const answer = "Тестовый ответ для экспорта";

    // Сохраняем в кэш
    saveToCacheHistory(question, answer);

    // Экспортируем в JSON
    exportCacheToJsonFile(localPath, (err) => {
      expect(err).toBeFalsy();
      // Проверяем, что файл создан и содержит нужные данные
      const data = fs.readJsonSync(localPath);
      const found = data.find(r => r.prompt === question && r.response === answer);
      expect(found).toBeTruthy();
      done();
    });
  });
});

describe('Cache module', () => {
  const question = 'Тестовый вопрос ' + Date.now();
  const answer = 'Тестовый ответ';

  beforeEach((done) => {
    database.run("DELETE FROM gpt_cache WHERE prompt = ?", [question], done);
  });

  it('should save and find answer in cache', (done) => {
    saveToCacheHistory(question, answer);

    setTimeout(() => {
      fuzzyFindInCache(question, (err, found) => {
        expect(found).toBe(answer);
        done();
      });
    }, 200);
  });
});