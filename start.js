const { app, bot } = require("./bot");

// Указываем порт для веб-сервера
const PORT = process.env.PORT || 3000;

// Запускаем веб-сервер
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

// Запускаем бота
bot.launch().then(() => {
    console.log("Бот успешно запущен!");
}).catch((err) => {
    console.error("Ошибка при запуске бота:", err);
});

// Обрабатываем завершение процесса для корректного завершения работы бота
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));