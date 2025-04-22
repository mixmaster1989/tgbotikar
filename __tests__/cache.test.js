const { saveToCacheHistory, fuzzyFindInCache } = require('../modules/cache');

describe('Cache module', () => {
  it('should save and find answer in cache', (done) => {
    const question = 'Тестовый вопрос';
    const answer = 'Тестовый ответ';

    // Сохраняем в кэш
    saveToCacheHistory(question, answer);

    // Ищем в кэше
    setTimeout(() => { // Ждём, чтобы запись точно попала в БД
      fuzzyFindInCache(question, (err, found) => {
        expect(found).toBe(answer);
        done();
      });
    }, 200);
  });
});