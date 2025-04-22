const path = require("path");
const fs = require("fs-extra");
const { exportCacheToJsonFile } = require("../modules/cache_export");
const { saveToCacheHistory } = require("../modules/cache");

describe("Cache export module", () => {
  const localPath = path.join(__dirname, "..", "cache", "dataset.test.json");

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