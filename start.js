const { app, bot } = require("./bot");
const logger = require("./modules/logger");

const PORT = process.env.PORT || 3000;

(async () => {
  app.listen(PORT, () => logger.info(`🌍 Web App: http://localhost:${PORT}`));
  await bot.launch();
  logger.info("🤖 Бот запущен!");
})();