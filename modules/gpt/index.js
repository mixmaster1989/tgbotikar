// Импортируем функции для работы с GPT и кэшем
const { initGPT4AllModel } = require("../gpt4all_test");
const { saveToCacheAndSync, fuzzyFindInYandexDisk } = require("../cache");

// Импортируем клавиатуру главного меню
const { mainMenuKeyboard } = require("../utils");

// Импортируем логгер для записи ошибок и информации
const logger = require("../logger");

// Переменная для хранения модели GPT (ленивая инициализация)
let gpt4allModel = null;

// Функция для регистрации обработчиков, связанных с GPT
function registerGptHandlers(bot) {
  // Состояния пользователей и их контексты
  const userStates = {};
  const userContexts = {};

  // Обработчик кнопки "Задать вопрос ИИ" — ожидает ввода вопроса
  bot.action("ask_ai", async (ctx) => {
    // Устанавливаем состояние пользователя
    userStates[ctx.from.id] = "awaiting_ai_prompt";

    // Инициализируем контекст пользователя, если его нет
    if (!userContexts[ctx.from.id]) userContexts[ctx.from.id] = [];

    // Просим пользователя ввести вопрос
    await ctx.reply("Введите ваш вопрос для ИИ:");
  });

  // Обработчик текстовых сообщений — отвечает на вопросы пользователей
  bot.on("text", async (ctx) => {
    const userId = ctx.from.id;

    // Проверяем, находится ли пользователь в режиме общения с ИИ
    if (userStates[userId] === "awaiting_ai_prompt" || userStates[userId] === "chatting_ai") {
      // Переключаем состояние пользователя в режим общения
      userStates[userId] = "chatting_ai";

      // Добавляем сообщение пользователя в контекст
      if (!userContexts[userId]) userContexts[userId] = [];
      userContexts[userId].push({ role: "user", content: ctx.message.text });

      // Логируем вопрос пользователя
      logger.info(`[AI Q] Пользователь ${userId} задал вопрос: "${ctx.message.text}"`);
      await ctx.reply("Ищу ответ в локальном кэше...");

      // Ищем ответ в кэше на Яндекс.Диске
      const yadiskAnswer = await fuzzyFindInYandexDisk(ctx.message.text);
      if (yadiskAnswer) {
        // Если ответ найден, отправляем его пользователю
        ctx.reply("🔎 Ответ из кэша на Яндекс.Диске:\n" + yadiskAnswer);
        return;
      }

      try {
        // Если модель еще не инициализирована, загружаем ее
        if (!gpt4allModel) gpt4allModel = await initGPT4AllModel();

        // Формируем контекст для модели
        const contextWindow = 5; // Ограничиваем длину контекста для ускорения
        const context = userContexts[userId].slice(-contextWindow);
        const prompt = context.map(m => (m.role === "user" ? `Пользователь: ${m.content}` : `ИИ: ${m.content}`)).join('\n') + "\nИИ:";

        // Устанавливаем таймаут для генерации
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Генерация превысила лимит времени (1 минута)")), 60000)
        );

        // Генерируем ответ с помощью модели
        const generation = gpt4allModel.generate(prompt, {
          maxTokens: 50, // Ограничиваем длину генерации
          temp: 0.7,
          on_token: (token) => process.stdout.write(token) // Логируем токены
        });

        const result = await Promise.race([generation, timeout]); // Ждем завершения генерации или таймаута

        // Добавляем ответ в контекст
        userContexts[userId].push({ role: "assistant", content: result });

        // Сохраняем вопрос и ответ в кэш
        saveToCacheAndSync(ctx.message.text, result, ctx);

        // Отправляем ответ пользователю
        ctx.reply(result || "Пустой ответ от модели.");
      } catch (error) {
        // Логируем ошибку и отправляем сообщение пользователю
        ctx.reply("Ошибка генерации ответа: " + error.message);
      }
    }
  });
}

// Экспортируем функцию для регистрации обработчиков
module.exports = { registerGptHandlers };
