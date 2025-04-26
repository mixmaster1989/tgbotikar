const path = require("path");
const fs = require("fs-extra");
const cacheExport = require("../modules/cache_export");
const cache = require("../modules/cache");

describe("Cache export module", () => {
  const localPath = path.join(__dirname, "..", "cache", "dataset.test.json");
  const question = "Тестовый вопрос для экспорта " + Date.now();
  const answer = "Тестовый ответ для экспорта";

  beforeEach((done) => {
    const db = require('sqlite3').verbose();
    const database = new db.Database(path.join(__dirname, '..', 'database.sqlite'));
    database.run("DELETE FROM gpt_cache WHERE prompt = ?", [question], done);
  });

  afterEach(() => {
    jest.clearAllMocks && jest.clearAllMocks();
  });

  it("should export cache to JSON after saving new entry", (done) => {
    expect(typeof cache.saveToCacheHistory).toBe('function');
    expect(typeof cacheExport.exportCacheToJsonFile).toBe('function');
    cache.saveToCacheHistory(question, answer);

    cacheExport.exportCacheToJsonFile(localPath, (err) => {
      expect(err).toBeFalsy();
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
    const db = require('sqlite3').verbose();
    const database = new db.Database(path.join(__dirname, '..', 'database.sqlite'));
    database.run("DELETE FROM gpt_cache WHERE prompt = ?", [question], done);
  });

  afterEach(() => {
    jest.clearAllMocks && jest.clearAllMocks();
  });

  it('should save and find answer in cache', (done) => {
    expect(typeof cache.saveToCacheHistory).toBe('function');
    expect(typeof cache.fuzzyFindInCache).toBe('function');
    cache.saveToCacheHistory(question, answer);

    setTimeout(() => {
      cache.fuzzyFindInCache(question, (err, found) => {
        expect(found).toBe(answer);
        done();
      });
    }, 200);
  });
});