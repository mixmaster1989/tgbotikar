// Загружаем переменные окружения из файла .env
require("dotenv").config();

// Импортируем необходимые модули из библиотеки Telegraf
const { Telegraf, session } = require("telegraf");

// Импортируем модуль Express для создания веб-сервера
const express = require("express");

// Импортируем обработчики для различных функций бота
const { registerOcrHandlers } = require("./modules/ocr"); // Обработчики для OCR
const { registerCacheHandlers } = require("./modules/cache"); // Обработчики для работы с кэшем
const { registerMaterialsHandlers } = require("./modules/materials"); // Обработчики для работы с материалами
const { registerGptHandlers } = require("./modules/gpt"); // Обработчики для работы с GPT
const { mainMenuKeyboard } = require("./modules/utils"); // Клавиатура главного меню

// Получаем токен бота из переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;

// Создаем экземпляр бота
const bot = new Telegraf(BOT_TOKEN);

// Включаем поддержку сессий для хранения данных пользователей
bot.use(session());

// Создаем экземпляр веб-сервера
const app = express();

// Настраиваем статическую папку для сервера
app.use("/static", express.static(__dirname + "/static"));

// Регистрируем обработчики для различных функций
registerOcrHandlers(bot); // Регистрация обработчиков OCR
registerCacheHandlers(bot); // Регистрация обработчиков кэша
registerMaterialsHandlers(bot); // Регистрация обработчиков материалов
registerGptHandlers(bot); // Регистрация обработчиков GPT

// Обработчик команды /start — приветственное сообщение
bot.start((ctx) => ctx.reply("Добро пожаловать! Выберите раздел:", mainMenuKeyboard()));

// Обработчик кнопки "Сбросить" — очищает историю
bot.action("reset", async (ctx) => ctx.reply("История сброшена.", mainMenuKeyboard()));

// Экспортируем сервер и бота для использования в других файлах
module.exports = { app, bot };
