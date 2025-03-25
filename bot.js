require("dotenv").config();
const { Telegraf } = require("telegraf");
const { Database } = require("sqlite3").verbose();

// Инициализация базы данных SQLite
const db = new Database("database.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT
  )`);
});
db.serialize(() => {
  db.each(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='materials'",
    (err, row) => {
      if (err) {
        console.error("Ошибка при проверке таблицы:", err);
      } else if (row) {
        console.log("Таблица materials существует.");
      } else {
        console.log("Таблица materials не найдена.");
      }
    }
  );
});

// Создание экземпляра бота с вашим токеном
const bot = new Telegraf(process.env.BOT_TOKEN);

// Inline клавиатуры
const mainMenuInlineKeyboard = {
  inline_keyboard: [
    [{ text: "🧠 Тесты", callback_data: "tests" }],
    [{ text: "📚 Материалы", callback_data: "materials" }],
    [{ text: "🏆 Мои результаты", callback_data: "results" }],
  ],
};

const materialsMenuInlineKeyboard = {
  inline_keyboard: [
    [{ text: "Добавить материал", callback_data: "add_material" }],
    [{ text: "Назад", callback_data: "back_to_main" }],
  ],
};

// Приветственное сообщение
bot.start(async (ctx) => {
  await ctx.telegram.sendPhoto(
    ctx.chat.id,
    "https://20.img.avito.st/image/1/Celhwra_pQAXbDcIf54Yl-thowrfoaqS3WGnBtlnpwDVJw"
  );
  await ctx.reply("Приветствую на обучающем портале ИКАР!", {
    reply_markup: mainMenuInlineKeyboard,
  });
});

// Обработчик для inline кнопок
bot.action("tests", (ctx) => {
  ctx.reply("Вы выбрали раздел «Тесты».");
});

bot.action("materials", (ctx) => {
  ctx.reply("Вы выбрали раздел «Материалы». Выберите действие:", {
    reply_markup: materialsMenuInlineKeyboard,
  });
});

bot.action("results", (ctx) => {
  ctx.reply("Вы выбрали раздел «Мои результаты».");
});

bot.action("add_material", async (ctx) => {
  // написать логику add_material
});

bot.action("back_to_main", (ctx) => {
  ctx.reply("Выберите раздел:", {
    reply_markup: mainMenuInlineKeyboard,
  });
});
// Обработчик для кнопки "Добавить материал"
const handleAddMaterial = async (msg) => {
    const chatId = msg.chat.id;
    let material = {};

    // Запросить название статьи
    bot.sendMessage(chatId, "Пожалуйста, введите название статьи.")
        .then(() => {
            bot.once("message", (msg) => {
                material.title = msg.text;

                // Запросить текст статьи
                bot.sendMessage(chatId, "Пожалуйста, введите текст статьи.")
                    .then(() => {
                        bot.once("message", (msg) => {
                            material.content = msg.text;

                            // Запросить фото
                            bot.sendMessage(chatId, "Пожалуйста, отправьте фото для статьи.")
                                .then(() => {
                                    bot.once("photo", (msg) => {
                                        material.photo = msg.photo[msg.photo.length - 1].file_id;

                                        // Сохранить данные в базу
                                        db.run("INSERT INTO materials (title, content, photo) VALUES (?, ?, ?)",
                                            [material.title, material.content, material.photo], (err) => {
                                                if (err) {
                                                    console.error("Ошибка при добавлении материала:", err);
                                                    bot.sendMessage(chatId, "Ошибка при добавлении материала.");
                                                } else {
                                                    bot.sendMessage(chatId, "Материал успешно добавлен!");
                                                }
                                            });
                                    });
                                });
                        });
                    });
            });
        });
};
bot.onText(/\/start|add_material/, handleAddMaterial);
// Поиск по базе знаний
bot.on("text", async (ctx) => {
  const query = ctx.message.text;

  try {
    const results = await searchInDatabase(query);
    if (results.length > 0) {
      ctx.reply(results.join("\n"));
    } else {
      ctx.reply("По вашему запросу ничего не найдено.");
    }
  } catch (err) {
    ctx.reply("Произошла ошибка при поиске.");
    console.error(err);
  }
});

// Функция для поиска в базе данных
async function searchInDatabase(query) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM materials WHERE content LIKE '%${query}%'`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map((row) => row.content));
        }
      }
    );
  });
}

// Запуск бота
bot.launch();

// API для составления тестов и дашборда
const express = require("express");
const app = express();

app.get("/tests", (req, res) => {
  res.send("Логика для генерации теста");
});

app.get("/results", (req, res) => {
  res.send("Логика для получения результатов тестов");
});

app.listen(3000, () => console.log("API server started on port 3000"));
