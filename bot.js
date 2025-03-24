const { Telegraf } = require('telegraf');
const { Database } = require('sqlite3').verbose();
const db = new Database('database.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT
  )`);
});
db.serialize(() => {
  db.each("SELECT name FROM sqlite_master WHERE type='table' AND name='materials'", (err, row) => {
    if (err) {
      console.error('Ошибка при проверке таблицы:', err);
    } else if (row) {
      console.log('Таблица materials существует.');
    } else {
      console.log('Таблица materials не найдена.');
    }
  });
});

// Подключение к базе данных SQLite
//const db = new SQLite.Database('database.sqlite');

// Создание экземпляра бота с вашим токеном
const bot = new Telegraf('');

// Приветственное сообщение
bot.start(async (ctx) => {
// Отправка изображения логотипа
  await ctx.telegram.sendPhoto(ctx.chat.id, 'https://20.img.avito.st/image/1/Celhwra_pQAXbDcIf54Yl-thowrfoaqS3WGnBtlnpwDVJw');
  await ctx.reply('Приветствую на обучающем портале ИКАР!');
  return ctx.reply('Выберите раздел:', { reply_markup: { keyboard: mainMenu, resize_keyboard: true } });
});


// Кнопки меню
const mainMenu = [
   ['🧠 Тесты'],
  ['📚 Материалы'],
  ['🏆 Мои результаты'],
];

bot.on('text', (ctx) => {
  if (ctx.message.text === '/menu') {
    return ctx.reply('Выберите раздел:', { reply_markup: { keyboard: mainMenu, resize_keyboard: true } });
  }
});

// Обработчик для кнопки «Тесты»
bot.on('text', (ctx) => {
  if (ctx.message.text === 'Тесты') {
    return ctx.reply('Вы выбрали раздел «Тесты».');
  }
});

// Обработчик для кнопки «Материалы»
bot.on('text', (ctx) => {
  if (ctx.message.text === 'Материалы') {
    return ctx.reply('Вы выбрали раздел «Материалы».');
  }
});

// Обработчик для кнопки «Мои результаты»
bot.on('text', (ctx) => {
  if (ctx.message.text === 'Мои результаты') {
    return ctx.reply('Вы выбрали раздел «Мои результаты».');
  }
});

// Поиск по базе знаний
bot.on('text', async (ctx) => {
  const query = ctx.message.text;
  // Выполните поиск в базе данных SQLite
  const results = await searchInDatabase(query);
  // Отправьте результаты пользователю
  ctx.reply(results.join('\n'));
});

// Добавление материала
bot.on('text', async (ctx) => {
  if (ctx.message.text === 'Добавить материал') {
    // Логика для добавления материала
const materialsMenu = [
  ['📝 Добавить материал'],
];

bot.on('text', (ctx) => {
  if (ctx.message.text === '/menu') {
    return ctx.reply('Выберите раздел:', { reply_markup: { keyboard: mainMenu, resize_keyboard: true } });
  } else if (ctx.message.text === 'Материалы') {
    return ctx.reply('Вы выбрали раздел «Материалы». Выберите действие:', { reply_markup: { keyboard: materialsMenu, resize_keyboard: true } });
  }
});

bot.on('text', async (ctx) => {
  if (ctx.message.text === 'Добавить материал') {
    // Здесь будет логика для добавления материала
    try {
      const newMaterialId = await addMaterial('Пример заголовка', 'Пример содержимого');
      ctx.reply(`Материал добавлен. ID материала: ${newMaterialId}`);
    } catch (err) {
      ctx.reply('Ошибка при добавлении материала.');
      console.error(err);
    }
  }
});

async function addMaterial(title, content) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO materials (title, content) VALUES (?, ?)');
    stmt.run(title, content, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(stmt.lastID);
      }
    });
    stmt.finalize();
  });
}
// Функция для поиска в базе данных
async function searchInDatabase(query) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM materials WHERE content LIKE '%${query}%'`, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.map(row => row.content));
      }
    });
  });
}

// Запуск бота
bot.launch();

// API для составления тестов и дашборда
const express = require('express');
const app = express();

app.get('/tests', (req, res) => {
  // Логика для генерации теста
});

app.get('/results', (req, res) => {
  // Логика для получения результатов тестов
});

app.listen(3000, () => console.log('API server started on port 3000'));
