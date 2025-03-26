require("dotenv").config();
const { Telegraf, session, Scenes } = require("telegraf");
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
        // Проверяем наличие столбца photo в таблице materials
        db.get("PRAGMA table_info(materials)", (err, row) => {
          if (err) {
            console.error("Ошибка при проверке столбца:", err);
          } else {
            let photoColumnExists = false;
            for (let i = 0; i < row.length; i++) {
              if (row[i].name === "photo") {
                photoColumnExists = true;
                break;
              }
            }
            if (!photoColumnExists) {
              // Если столбец photo не существует, добавляем его
              db.run("ALTER TABLE materials ADD COLUMN photo TEXT", (err) => {
                if (err) {
                  console.error("Ошибка при добавлении столбца photo:", err);
                } else {
                  console.log("Столбец photo успешно добавлен.");
                }
              });
          }
        }
      });
    }
  }
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

bot.action("materials", async (ctx) => {
  ctx.reply("Вы выбрали раздел «Материалы». Выберите действие:", {
    reply_markup: materialsMenuInlineKeyboard,
  });
  await sendMaterialsList(ctx);
});

bot.action("results", (ctx) => {
  ctx.reply("Вы выбрали раздел «Мои результаты».");
});

// Привязываем обработчик к кнопке

bot.action("back_to_main", (ctx) => {
  ctx.reply("Выберите раздел:", {
    reply_markup: mainMenuInlineKeyboard,
  });
});
// Обработчик для кнопки "Добавить материал"
// Создаём сцену для добавления материала
const addMaterialScene = new Scenes.BaseScene("ADD_MATERIAL");

addMaterialScene.enter(async (ctx) => {
  ctx.session.material = {}; // Создаём объект для хранения данных
  await ctx.reply("Введите название статьи:");
});

addMaterialScene.on("text", async (ctx) => {
  if (!ctx.session.material.title) {
    ctx.session.material.title = ctx.message.text;
    await ctx.reply("Введите текст статьи:");
  } else if (!ctx.session.material.content) {
    ctx.session.material.content = ctx.message.text;
    await ctx.reply("Отправьте фото для статьи:");
  }
});

addMaterialScene.on("photo", async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  ctx.session.material.photo = photo;

  // Сохранение в базу данных
  db.run(
    "INSERT INTO materials (title, content, photo) VALUES (?, ?, ?)",
    [
      ctx.session.material.title,
      ctx.session.material.content,
      ctx.session.material.photo,
    ],
  (err) => {
    if (err) {
      console.error("Ошибка при добавлении материала:", err);
      ctx.reply("Ошибка при добавлении материала.");
    } else {
      ctx.reply("Материал успешно добавлен!");
    }
  }
);

// После добавления материала отправляем список всех материалов
await sendMaterialsList(ctx);

await ctx.scene.leave(); // Выход из сцены
}); // Закрытие addMaterialScene.on("photo")

// Обработчик для открытия материала по нажатию кнопки
bot.action(/open_material_(\d+)/, async (ctx) => {
  const materialId = ctx.match[1];
  db.get("SELECT * FROM materials WHERE id = ?", [materialId], (err, row) => {
    if (err) {
      console.error("Ошибка при получении материала:", err);
      ctx.reply("Произошла ошибка при получении материала.");
    } else {
      ctx.replyWithPhoto(row.photo, {
        caption: `${row.title}\n\n${row.content}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Назад", callback_data: "back_to_materials" }],
          ],
        },
      });
    }
  });
});
// Обработчик кнопки "Назад" для возврата к списку материалов
bot.action("back_to_materials", async (ctx) => {
  await sendMaterialsList(ctx);
});
// Функция для отправки списка всех материалов
async function sendMaterialsList(ctx) {
  db.all("SELECT * FROM materials", (err, rows) => {
    if (err) {
      console.error("Ошибка при получении списка материалов:", err);
      ctx.reply("Произошла ошибка при получении списка материалов.");
    } else {
      const keyboard = rows.map((row) => [
        {
          text: row.title,
          callback_data: `open_material_${row.id}`,
        },
      ]);
      ctx.reply("Выберите материал:", {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    }
  });
}

// Обработчик для открытия материала по нажатию кнопки
bot.action(/open_material_(\d+)/, async (ctx) => {
  const materialId = ctx.match[1];
  db.get("SELECT * FROM materials WHERE id = ?", [materialId], (err, row) => {
    if (err) {
      console.error("Ошибка при получении материала:", err);
      ctx.reply("Произошла ошибка при получении материала.");
    } else {
      ctx.replyWithPhoto(row.photo, {
        caption: `${row.title}\n\n${row.content}`,
      });
    }
  });
});
// Подключаем сцену к Stage
const stage = new Scenes.Stage([addMaterialScene]);

bot.use(session());
bot.use(stage.middleware());

// Обработчик нажатия кнопки "Добавить материал"
bot.action("add_material", async (ctx) => {
  await ctx.scene.enter("ADD_MATERIAL");
});

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
