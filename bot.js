// bot.js — Гибридная версия: кэш + Я.Диск + PDF + генерация промтов/датасета с логированием

const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pTimeout = require('p-timeout');
const { generatePrompt, generateAnswer, similarity } = require('./lib/gen');
const { saveToDataset, getCache, saveToCache } = require('./lib/cache');
const { syncFromYandexDisk, listMaterials, getMaterialText } = require('./lib/yadisk');
const { convertDocxToPdf } = require('./lib/pdf');

const bot = new Telegraf(process.env.BOT_TOKEN);

console.log('[INIT] Бот запускается...');

bot.start(async (ctx) => {
  console.log(`[START] Пользователь ${ctx.from.username} (${ctx.from.id})`);
  ctx.reply('Добро пожаловать! Выберите раздел:', Markup.inlineKeyboard([
    [Markup.button.callback('Материалы', 'materials')],
    [Markup.button.callback('Генерация теста', 'generate_test')],
    [Markup.button.callback('Кэш', 'cache')],
    [Markup.button.callback('Настройки', 'settings')],
    [Markup.button.callback('Резет', 'reset')]
  ]));
});

bot.on('callback_query', async (ctx) => {
  const action = ctx.callbackQuery.data;
  const username = ctx.from.username || ctx.from.first_name;
  console.log(`[CALLBACK_QUERY] ${username} нажал кнопку: ${action}`);

  try {
    if (action === 'generate_test') {
      console.log('[ACTION] Генерация теста запущена');

      await pTimeout(
        generateTestLogic(ctx),
        90_000,
        new Error('Слишком долгий отклик от модели. Превышен таймаут.')
      );

      console.log('[ACTION] Генерация теста завершена');
    } else if (action === 'materials') {
      console.log('[ACTION] Синхронизация материалов с Я.Диска');
      const materials = await syncFromYandexDisk();
      console.log('[INFO] Получено материалов:', materials.length);
      await ctx.reply(`Доступно материалов: ${materials.length}`);
    } else if (action === 'cache') {
      const cache = await getCache();
      console.log(`[INFO] Кэш содержит ${cache.length} элементов`);
      await ctx.reply(`В кэше ${cache.length} элементов.`);
    } else {
      console.log(`[WARN] Неизвестный action: ${action}`);
      ctx.answerCbQuery('Раздел в разработке.');
    }
  } catch (error) {
    console.error('[ERROR] Ошибка при обработке callback_query:', error);
    ctx.reply('Произошла ошибка при выполнении действия. Попробуйте позже.');
  }
});

async function generateTestLogic(ctx) {
  try {
    console.log('[LOGIC] Генерация теста: выбор случайного материала');
    const materials = await listMaterials();
    console.log('[LOGIC] Всего материалов:', materials.length);
    const material = materials[Math.floor(Math.random() * materials.length)];
    const text = await getMaterialText(material.path);
    console.log(`[LOGIC] Выбран материал: ${material.name}`);

    const prompt = await generatePrompt(text);
    console.log('[LOGIC] Сгенерирован промпт:', prompt);

    const answer = await generateAnswer(prompt);
    console.log('[LOGIC] Сгенерирован ответ:', answer);

    await saveToCache({ prompt, answer, source: material.name });
    console.log('[LOGIC] Сохранено в кэш');
    await saveToDataset({ prompt, answer });
    console.log('[LOGIC] Сохранено в датасет');

    await ctx.reply(`Тест сгенерирован из материала: ${material.name}`);
  } catch (err) {
    console.error('[ERROR] Ошибка внутри generateTestLogic:', err);
    await ctx.reply('Ошибка при генерации теста.');
  }
}

bot.launch().then(() => console.log('[LAUNCH] Бот успешно запущен.'));

process.once('SIGINT', () => {
  console.log('[STOP] SIGINT');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('[STOP] SIGTERM');
  bot.stop('SIGTERM');
});
