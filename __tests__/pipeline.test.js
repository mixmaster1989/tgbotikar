const { processOcrPipeline } = require('../modules/ocr/pipeline');

describe('processOcrPipeline', () => {
  let ctx, userStates, userLastOcr;

  beforeEach(() => {
    ctx = { replyWithHTML: jest.fn(), from: { id: 42 } };
    userStates = {};
    userLastOcr = {};
  });

  it('должен отправлять финальный текст и обновлять состояния', async () => {
    // Мокаем зависимости pipeline.js
    jest.mock('../modules/ocr/scoring', () => ({
      selectBestOcrResult: jest.fn(() => 'строка1\nстрока2\nстрока3')
    }));
    jest.mock('../modules/ocr/garbage', () => ({
      filterGarbage: jest.fn(async lines => lines),
      addGarbage: jest.fn()
    }));

    const allResults = [ { text: 'строка1' }, { text: 'строка2' }, { text: 'строка3' } ];
    const semanticResult = 'строка1\nстрока2\nстрока3';
    const cleanedSemantic = 'строка1\nстрока2\nстрока3';
    const humanResult = 'строка1\nстрока2\nстрока3';

    await processOcrPipeline(ctx, allResults, semanticResult, cleanedSemantic, humanResult, userStates, userLastOcr);
    expect(ctx.replyWithHTML).toHaveBeenCalled();
    expect(userStates[42]).toBe('awaiting_original');
    expect(userLastOcr[42]).toContain('строка1');
  });
});
