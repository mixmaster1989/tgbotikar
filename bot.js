const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new sqlite3.Database('database.sqlite');

// Создание необходимых директорий
fs.ensureDirSync('uploads');

// Инициализация базы данных
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category_id INTEGER,
        FOREIGN KEY(category_id) REFERENCES categories(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        image_path TEXT,
        section_id INTEGER,
        FOREIGN KEY(section_id) REFERENCES sections(id)
    )`);
});

// Главное меню
bot.command('start', async (ctx) => {
    return await ctx.reply('Выберите действие:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('Тесты', 'tests')],
            [Markup.button.callback('Материалы', 'materials')],
            [Markup.button.callback('Мои результаты', 'results')],
            [Markup.button.callback('🗑 Очистить базу', 'clear_db')]
        ])
    );
});

// Обработка кнопки "Материалы"
bot.action('materials', async (ctx) => {
    await ctx.answerCbQuery();
    const categories = await getCategories();
    const buttons = categories.map(cat => [
        Markup.button.callback(cat.name, `category:${cat.id}`)
    ]);
    buttons.push([Markup.button.callback('Добавить категорию', 'add_category')]);
    
    await ctx.editMessageText('Выберите категорию:', 
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка выбора категории
bot.action(/^category:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = parseInt(ctx.match[1]);
    const sections = await getSections(categoryId);
    
    const buttons = sections.map(section => [
        Markup.button.callback(section.name, `section:${section.id}`)
    ]);
    buttons.push([Markup.button.callback('Добавить раздел', `add_section:${categoryId}`)]);
    buttons.push([Markup.button.callback('« Назад к категориям', 'materials')]);

    await ctx.editMessageText('Выберите раздел:', 
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка выбора раздела
bot.action(/^section:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const sectionId = parseInt(ctx.match[1]);
    const articles = await getArticles(sectionId);
    const section = await getSectionById(sectionId);
    
    const buttons = articles.map(article => [
        Markup.button.callback(article.title, `article:${article.id}`)
    ]);
    buttons.push([Markup.button.callback('Добавить статью', `add_article:${sectionId}`)]);
    buttons.push([Markup.button.callback('« Назад к разделам', `category:${section.category_id}`)]);

    await ctx.editMessageText('Выберите статью:', 
        Markup.inlineKeyboard(buttons)
    );
});

// Просмотр статьи
bot.action(/^article:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const articleId = parseInt(ctx.match[1]);
    const article = await getArticleById(articleId);
    const section = await getSectionById(article.section_id);
    
    const caption = `${article.title}\n\n${article.description}`;
    const buttons = [[
        Markup.button.callback('« Назад к статьям', `section:${article.section_id}`)
    ]];

    if (article.image_path) {
        await ctx.deleteMessage();
        await ctx.replyWithPhoto(
            { source: article.image_path },
            { 
                caption,
                ...Markup.inlineKeyboard(buttons)
            }
        );
    } else {
        await ctx.editMessageText(caption, 
            Markup.inlineKeyboard(buttons)
        );
    }
});

// Очистка базы данных
bot.action('clear_db', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Удаляем все данные из таблиц
    await new Promise((resolve, reject) => {
        db.run('DELETE FROM articles', (err) => {
            if (err) reject(err);
            db.run('DELETE FROM sections', (err) => {
                if (err) reject(err);
                db.run('DELETE FROM categories', (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        });
    });

    // Очищаем папку с загруженными фотографиями
    await fs.emptyDir('uploads');

    await ctx.editMessageText('База данных очищена! Отправьте /start для начала работы');
});

// Добавление категории
bot.action('add_category', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Введите название новой категории:');
    await ctx.deleteMessage();
});

// Добавление раздела
bot.action(/^add_section:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = parseInt(ctx.match[1]);
    ctx.session = { addingSection: categoryId };
    await ctx.reply('Введите название нового раздела:');
    await ctx.deleteMessage();
});

// Добавление статьи
bot.action(/^add_article:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const sectionId = parseInt(ctx.match[1]);
    ctx.session = { addingArticle: sectionId };
    await ctx.reply('Введите заголовок статьи:');
    await ctx.deleteMessage();
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    // Добавление категории
    if (ctx.message.text && !ctx.session) {
        await addCategory(ctx.message.text);
        await ctx.reply('Категория добавлена!');
        const categories = await getCategories();
        const buttons = categories.map(cat => [
            Markup.button.callback(cat.name, `category:${cat.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить категорию', 'add_category')]);
        
        await ctx.reply('Выберите категорию:', 
            Markup.inlineKeyboard(buttons)
        );
        return;
    }

    // Добавление раздела
    if (ctx.session?.addingSection) {
        const categoryId = ctx.session.addingSection;
        await addSection(ctx.message.text, categoryId);
        ctx.session = null;
        
        const sections = await getSections(categoryId);
        const buttons = sections.map(section => [
            Markup.button.callback(section.name, `section:${section.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить раздел', `add_section:${categoryId}`)]);
        buttons.push([Markup.button.callback('« Назад к категориям', 'materials')]);
        
        await ctx.reply('Раздел добавлен!');
        await ctx.reply('Выберите раздел:', 
            Markup.inlineKeyboard(buttons)
        );
        return;
    }

    // Добавление статьи - этап 1: заголовок
    if (ctx.session?.addingArticle && !ctx.session.articleTitle) {
        ctx.session.articleTitle = ctx.message.text;
        await ctx.reply('Введите описание статьи:');
        return;
    }

    // Добавление статьи - этап 2: описание
    if (ctx.session?.addingArticle && ctx.session.articleTitle && !ctx.session.articleDescription) {
        ctx.session.articleDescription = ctx.message.text;
        await ctx.reply('Отправьте фотографию для статьи (или отправьте любой текст, чтобы пропустить):');
        return;
    }

    // Добавление статьи - этап 3: пропуск фото
    if (ctx.session?.addingArticle && ctx.session.articleTitle && ctx.session.articleDescription) {
        const sectionId = ctx.session.addingArticle;
        await addArticle(
            ctx.session.articleTitle,
            ctx.session.articleDescription,
            null,
            sectionId
        );

        const section = await getSectionById(sectionId);
        const articles = await getArticles(sectionId);
        const buttons = articles.map(article => [
            Markup.button.callback(article.title, `article:${article.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить статью', `add_article:${sectionId}`)]);
        buttons.push([Markup.button.callback('« Назад к разделам', `category:${section.category_id}`)]);

        ctx.session = null;
        await ctx.reply('Статья добавлена!');
        await ctx.reply('Выберите статью:', 
            Markup.inlineKeyboard(buttons)
        );
    }
});

// Обработка фотографий для статей
bot.on('photo', async (ctx) => {
    if (ctx.session?.addingArticle && ctx.session.articleTitle && ctx.session.articleDescription) {
        const sectionId = ctx.session.addingArticle;
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        const fileName = `${Date.now()}.jpg`;
        const filePath = path.join('uploads', fileName);
        
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = await response.buffer();
        await fs.writeFile(filePath, buffer);

        await addArticle(
            ctx.session.articleTitle,
            ctx.session.articleDescription,
            filePath,
            sectionId
        );

        const section = await getSectionById(sectionId);
        const articles = await getArticles(sectionId);
        const buttons = articles.map(article => [
            Markup.button.callback(article.title, `article:${article.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить статью', `add_article:${sectionId}`)]);
        buttons.push([Markup.button.callback('« Назад к разделам', `category:${section.category_id}`)]);

        ctx.session = null;
        await ctx.reply('Статья добавлена!');
        await ctx.reply('Выберите статью:', 
            Markup.inlineKeyboard(buttons)
        );
    }
});

// Вспомогательные функции для работы с БД
function getCategories() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM categories', (err, rows) => {
            if (err) reject(err);
            resolve(rows || []);
        });
    });
}

function getCategoryById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM categories WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

function addCategory(name) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO categories (name) VALUES (?)', [name], (err) => {
            if (err) reject(err);
            resolve();
        });
    });
}

function getSections(categoryId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM sections WHERE category_id = ?', [categoryId], (err, rows) => {
            if (err) reject(err);
            resolve(rows || []);
        });
    });
}

function getSectionById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM sections WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

function addSection(name, categoryId) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO sections (name, category_id) VALUES (?, ?)', 
            [name, categoryId], (err) => {
                if (err) reject(err);
                resolve();
            });
    });
}

function getArticles(sectionId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM articles WHERE section_id = ?', [sectionId], (err, rows) => {
            if (err) reject(err);
            resolve(rows || []);
        });
    });
}

function getArticleById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM articles WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

function addArticle(title, description, imagePath, sectionId) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO articles (title, description, image_path, section_id) VALUES (?, ?, ?, ?)',
            [title, description, imagePath, sectionId],
            (err) => {
                if (err) reject(err);
                resolve();
            }
        );
    });
}

bot.launch(() => console.log('Бот запущен!'));
