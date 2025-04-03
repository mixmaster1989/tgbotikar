const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const fetch = require("node-fetch");
const fs = require('fs-extra');
const path = require('path');
const mammoth = require('mammoth');
require('dotenv').config();

// Путь к папке с материалами
const materialsPath = path.join(__dirname, 'materials');

// Функция для получения структуры папок и файлов
async function getMaterialsStructure() {
    const categories = await fs.readdir(materialsPath);
    const structure = {};

    for (const category of categories) {
        const categoryPath = path.join(materialsPath, category);
        if (await fs.stat(categoryPath).then(stat => stat.isDirectory())) {
            structure[category] = {};
            const sections = await fs.readdir(categoryPath);

            for (const section of sections) {
                const sectionPath = path.join(categoryPath, section);
                if (await fs.stat(sectionPath).then(stat => stat.isDirectory())) {
                    const files = await fs.readdir(sectionPath);
                    structure[category][section] = files.filter(file => file.endsWith('.docx'));
                }
            }
        }
    }

    return structure;
}

// Функция для парсинга текста из .docx файла
async function parseDocx(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim(); // Возвращаем текст без лишних пробелов
}

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
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
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure).map(category => [
        Markup.button.callback(category, `category:${category}`)
    ]);
    buttons.push([Markup.button.callback('« На главную', 'main_menu')]);

    await ctx.editMessageText('Выберите категорию:',
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка выбора категории
bot.action(/^category:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const structure = await getMaterialsStructure();
    const sections = structure[category];

    const buttons = Object.keys(sections).map(section => {
        const sanitizedCategory = category.replace(/[^a-zA-Z0-9:_-]/g, '');
        const sanitizedSection = section.replace(/[^a-zA-Z0-9:_-]/g, '');
        return [Markup.button.callback(section, `section:${sanitizedCategory}:${sanitizedSection}`.slice(0, 64))];
    });
    buttons.push([Markup.button.callback('« Назад к категориям', 'materials')]);
    buttons.push([Markup.button.callback('« На главную', 'main_menu')]);

    await ctx.editMessageText(`Категория: ${category}\nВыберите раздел:`,
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка выбора раздела
bot.action(/^section:(.+):(.+)$/, async (ctx) => {
    const [category, section] = ctx.match.slice(1);
    const structure = await getMaterialsStructure();
    const materials = structure[category]?.[section];

    if (!materials) {
        return ctx.reply('Invalid section or category.');
    }

    const buttons = materials.map(material => [
        Markup.button.callback(material, `material:${category}:${section}:${material}`.slice(0, 64))
    ]);
    buttons.push([Markup.button.callback('« Назад к разделам', `category:${category}`)]);
    buttons.push([Markup.button.callback('« На главную', 'main_menu')]);

    await ctx.editMessageText(`Раздел: ${section}\nВыберите материал:`,
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка выбора материала
bot.action(/^material:(.+):(.+):(.+)$/, async (ctx) => {
    const [category, section, material] = ctx.match.slice(1);
    const filePath = path.join(materialsPath, category, section, material);

    try {
        const content = await parseDocx(filePath);
        await ctx.reply(`Материал: ${material}\n\n${content}`);
    } catch (err) {
        console.error(`Ошибка при чтении файла ${filePath}:`, err);
        await ctx.reply('Ошибка при чтении материала.');
    }
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
    buttons.push([
        Markup.button.callback('« Назад к категориям', 'materials'),
        Markup.button.callback('« На главную', 'main_menu')
    ]);

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
    buttons.push([
        Markup.button.callback('« Назад к разделам', `category:${section.category_id}`),
        Markup.button.callback('« На главную', 'main_menu')
    ]);

    await ctx.deleteMessage();
    await ctx.reply('Выберите статью:',
        Markup.inlineKeyboard(buttons)
    );
});

// Просмотр статьи
bot.action(/^article:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const articleId = parseInt(ctx.match[1]);
    const article = await getArticleById(articleId);
    const section = await getSectionById(article.section_id);

    let caption = `${article.title}\n\n${article.description}`;
    const buttons = [
        [Markup.button.callback('« Назад к статьям', `section:${article.section_id}`)],
        [Markup.button.callback('« На главную', 'main_menu')]
    ];

    if (article.image_path) {
        await ctx.deleteMessage();

        // Отправляем текст отдельно, если он слишком длинный
        if (caption.length > 1024) {
            await ctx.reply(`${article.title}\n\n${article.description}`);
            caption = ""; // Очищаем caption для фотографии
        }

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

// Обработчик кнопки "На главную"
bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Выберите действие:',
        Markup.inlineKeyboard([
            [Markup.button.callback('Тесты', 'tests')],
            [Markup.button.callback('Материалы', 'materials')],
            [Markup.button.callback('Мои результаты', 'results')],
            [Markup.button.callback('🗑 Очистить базу', 'clear_db')]
        ])
    );
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
    console.log("Обработчик 'add_article' вызван."); // Логируем вызов обработчика
    await ctx.answerCbQuery();
    const sectionId = parseInt(ctx.match[1]);
    console.log(`Добавление статьи в раздел с ID: ${sectionId}`); // Логируем ID раздела
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
        buttons.push([Markup.button.callback('« На главную', 'main_menu')]);

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
        buttons.push([
            Markup.button.callback('« Назад к категориям', 'materials'),
            Markup.button.callback('« На главную', 'main_menu')
        ]);

        await ctx.reply('Раздел добавлен!');
        await ctx.reply('Выберите раздел:',
            Markup.inlineKeyboard(buttons)
        );
        return;
    }

    // Добавление статьи - этап 1: заголовок
    if (ctx.session?.addingArticle && !ctx.session.articleTitle) {
        ctx.session.articleTitle = ctx.message.text;
        console.log(`Заголовок статьи установлен: ${ctx.session.articleTitle}`); // Логируем заголовок
        await ctx.reply('Введите описание статьи:');
        return;
    }

    // Добавление статьи - этап 2: описание
    if (ctx.session?.addingArticle && ctx.session.articleTitle && !ctx.session.articleDescription) {
        ctx.session.articleDescription = ctx.message.text;
        console.log(`Описание статьи установлено: ${ctx.session.articleDescription}`); // Логируем описание
        await ctx.reply('Отправьте фотографию для статьи (или отправьте любой текст, чтобы пропустить):');
        return;
    }

    // Добавление статьи - этап 3: пропуск фото
    if (ctx.session?.addingArticle && ctx.session.articleTitle && ctx.session.articleDescription) {
        const sectionId = ctx.session.addingArticle;
        console.log(`Добавление статьи без фото в раздел с ID: ${sectionId}`); // Логируем ID раздела
        await addArticle(
            ctx.session.articleTitle,
            ctx.session.articleDescription,
            null,
            sectionId
        );

        console.log(`Статья добавлена: { title: ${ctx.session.articleTitle}, description: ${ctx.session.articleDescription}, sectionId: ${sectionId} }`); // Логируем данные статьи

        const section = await getSectionById(sectionId);
        const articles = await getArticles(sectionId);
        const buttons = articles.map(article => [
            Markup.button.callback(article.title, `article:${article.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить статью', `add_article:${sectionId}`)]);
        buttons.push([
            Markup.button.callback('« Назад к разделам', `category:${section.category_id}`),
            Markup.button.callback('« На главную', 'main_menu')
        ]);

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
        const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const fileName = `${Date.now()}.jpg`;
        const filePath = path.join('uploads', fileName);

        console.log(`Получена фотография для статьи. Сохраняем файл: ${fileName}`); // Логируем имя файла

        const fileLink = await ctx.telegram.getFileLink(photo);
        const response = await fetch.default(fileLink);
        const buffer = await response.buffer();
        await fs.writeFile(filePath, buffer);

        console.log(`Фотография сохранена: ${filePath}`); // Логируем путь сохраненного файла

        await addArticle(
            ctx.session.articleTitle,
            ctx.session.articleDescription,
            filePath,
            sectionId
        );

        console.log(`Статья добавлена с фото: { title: ${ctx.session.articleTitle}, description: ${ctx.session.articleDescription}, imagePath: ${filePath}, sectionId: ${sectionId} }`); // Логируем данные статьи

        const section = await getSectionById(sectionId);
        const articles = await getArticles(sectionId);
        const buttons = articles.map(article => [
            Markup.button.callback(article.title, `article:${article.id}`)
        ]);
        buttons.push([Markup.button.callback('Добавить статью', `add_article:${sectionId}`)]);
        buttons.push([
            Markup.button.callback('« Назад к разделам', `category:${section.category_id}`),
            Markup.button.callback('« На главную', 'main_menu')
        ]);

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
