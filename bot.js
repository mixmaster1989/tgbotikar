require("dotenv").config();
const { Telegraf, session, Scenes } = require("telegraf");
const { Database } = require("sqlite3").verbose();
const fetch = require("node-fetch"); // Для загрузки файлов с Telegram API
const { saveFile, getFile } = require("./fsconf"); // Импортируем модуль fsconf
const fs = require("fs"); // Импортируем модуль fs

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
  db.run(`CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )`);
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

const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🧠 Тесты" }, { text: "📚 Материалы" }, { text: "🏆 Мои результаты" }],
      [{ text: "❌ Очистить материалы" }], // ВРЕМЕННАЯ КНОПКА
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

// Приветственное сообщение
bot.start(async (ctx) => {
  await ctx.reply("Приветствую на обучающем портале ИКАР!", mainMenuKeyboard);
});

bot.hears("🧠 Тесты", (ctx) => {
  ctx.reply("Вы выбрали раздел «Тесты».");
});

bot.hears("📚 Материалы", async (ctx) => {
  ctx.reply("Вы выбрали раздел «Материалы». Выберите действие:", {
    reply_markup: materialsMenuInlineKeyboard,
  });
  await sendMaterialsList(ctx); // Отправляем список материалов
});

bot.hears("🏆 Мои результаты", (ctx) => {
  ctx.reply("Вы выбрали раздел «Мои результаты».");
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
  ctx.session.material = {}; // Инициализируем объект для хранения данных
  await ctx.reply("Это раздел или статья?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Раздел", callback_data: "section" }],
        [{ text: "Статья", callback_data: "article" }],
      ],
    },
  });
});

bot.action("section", async (ctx) => {
  console.log("Обработчик 'section' вызван."); // Логируем вызов обработчика
  if (!ctx.session) ctx.session = {}; // Инициализируем ctx.session, если он отсутствует
  if (!ctx.session.material) ctx.session.material = {}; // Проверяем и инициализируем объект
  ctx.session.material.type = "section";
  console.log("Сессия после установки type:", ctx.session.material); // Логируем состояние
  await ctx.reply("Введите название раздела:");
});

bot.action("article", async (ctx) => {
  if (!ctx.session.material) ctx.session.material = {}; // Проверяем и инициализируем объект
  ctx.session.material.type = "article";
  await ctx.reply("Введите название статьи:");
});

addMaterialScene.on("text", async (ctx) => {
  if (!ctx.session) ctx.session = {}; // Инициализируем сессию, если она отсутствует
  if (!ctx.session.material) ctx.session.material = {}; // Инициализируем объект material, если он отсутствует

  console.log("Получено сообщение:", ctx.message.text); // Логируем текст сообщения
  console.log("Сессия материала перед проверкой:", ctx.session.material); // Логируем объект ctx.session.material

  if (ctx.session.material.type === "section" && !ctx.session.material.name) {
    ctx.session.material.name = ctx.message.text;

    // Сохраняем раздел в базу данных
    db.run(
      "INSERT INTO sections (name) VALUES (?)",
      [ctx.session.material.name],
      (err) => {
        if (err) {
          console.error("Ошибка при добавлении раздела:", err); // Логируем ошибку
          ctx.reply("Ошибка при добавлении раздела.");
        } else {
          console.log("Раздел успешно добавлен:", ctx.session.material.name); // Логируем успех
          ctx.reply(`Раздел "${ctx.session.material.name}" успешно добавлен!`);
          ctx.scene.leave(); // Выходим из сцены
        }
      }
    );
  } else {
    console.log("Условие не выполнено. Состояние ctx.session.material:", ctx.session.material); // Логируем состояние
    ctx.reply("Произошла ошибка. Убедитесь, что вы вводите корректные данные.");
  }
});

bot.action(/section_(\d+)/, (ctx) => {
  ctx.session.material.section_id = ctx.match[1];
  ctx.reply("Раздел выбран. Введите текст статьи.");
});

addMaterialScene.on("photo", async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  ctx.session.material.photo = photo;

  try {
    // Получаем ссылку на файл через Telegram API
    const fileLink = await ctx.telegram.getFileLink(photo);

    // Загружаем файл
    const response = await fetch(fileLink.href);
    const buffer = await response.buffer();

    // Сохраняем файл на диск
    const fileName = `${photo}.jpg`; // Уникальное имя файла
    await saveFile(buffer, fileName);

    // Сохраняем запись в базу данных
    db.run(
      "INSERT INTO materials (title, content, photo, section_id) VALUES (?, ?, ?, ?)",
      [
        ctx.session.material.title,
        ctx.session.material.content,
        fileName, // Сохраняем имя файла вместо file_id
        ctx.session.material.section_id,
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
  } catch (error) {
    console.error("Ошибка при обработке фото:", error);
    ctx.reply("Произошла ошибка при обработке фото.");
  }
});

// Обработчик для открытия материала по нажатию кнопки
bot.action(/open_material_(\d+)/, async (ctx) => {
  const materialId = ctx.match[1];
  db.get("SELECT * FROM materials WHERE id = ?", [materialId], async (err, row) => {
    if (err) {
      console.error("Ошибка при получении материала:", err);
      await ctx.reply("Произошла ошибка при получении материала.");
    } else {
      const filePath = `fs-files/photo/${row.photo}`;
      if (fs.existsSync(filePath)) {
        // Разбиваем текст на части, если он слишком длинный
        const caption = `${row.title}\n\n${row.content}`;
        const parts = splitText(caption, 1024); // Разбиваем текст на части

        // Отправляем фото с первой частью текста
        await ctx.replyWithPhoto({ source: filePath }, { caption: parts[0] });

        // Отправляем остальные части текста
        for (let i = 1; i < parts.length; i++) {
          await ctx.reply(parts[i]);
        }
      } else {
        await ctx.reply("Файл не найден.");
      }
    }
  });
});

// Функция для разбивки текста на части
function splitText(text, maxLength) {
  const parts = [];
  while (text.length > maxLength) {
    let part = text.slice(0, maxLength);
    const lastSpace = part.lastIndexOf(" ");
    if (lastSpace > -1) {
      part = part.slice(0, lastSpace); // Разбиваем по последнему пробелу
    }
    parts.push(part);
    text = text.slice(part.length).trim();
  }
  parts.push(text); // Добавляем оставшийся текст
  return parts;
}

// Обработчик кнопки "Назад" для возврата к списку материалов
bot.action("back_to_materials", async (ctx) => {
  await sendMaterialsList(ctx);
});
// Функция для отправки списка всех материалов
async function sendMaterialsList(ctx) {
  db.all("SELECT * FROM sections", (err, sections) => {
    if (err) {
      console.error("Ошибка при получении разделов:", err);
      ctx.reply("Произошла ошибка при получении разделов.");
    } else {
      const keyboard = sections.map((section) => [
        { text: section.name, callback_data: `open_section_${section.id}` },
      ]);
      ctx.reply("Выберите раздел:", {
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  });
}

bot.action(/open_section_(\d+)/, (ctx) => {
  const sectionId = ctx.match[1];
  db.all(
    "SELECT * FROM materials WHERE section_id = ?",
    [sectionId],
    (err, rows) => {
      if (err) {
        console.error("Ошибка при получении материалов:", err);
        ctx.reply("Произошла ошибка при получении материалов.");
      } else {
        const keyboard = rows.map((row) => [
          { text: row.title, callback_data: `open_material_${row.id}` },
        ]);
        ctx.reply("Выберите материал:", {
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    }
  );
});

// Функция для получения списка разделов
async function getSections() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM sections", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Подключаем сцену к Stage
const stage = new Scenes.Stage([addMaterialScene]);

bot.use(session());
bot.use(stage.middleware());

// Обработчик нажатия кнопки "Добавить материал"
bot.action("add_material", async (ctx) => {
  await ctx.scene.enter("ADD_MATERIAL");
});

// Обработчик для временной кнопки "Очистить материалы"
bot.hears("❌ Очистить материалы", async (ctx) => {
  try {
    db.run("DELETE FROM materials", (err) => {
      if (err) {
        console.error("Ошибка при очистке материалов:", err);
        ctx.reply("Произошла ошибка при очистке материалов.");
      } else {
        ctx.reply("Все материалы успешно удалены!");
      }
    });
  } catch (error) {
    console.error("Ошибка при обработке команды очистки:", error);
    ctx.reply("Произошла ошибка при очистке материалов.");
  }
});



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
