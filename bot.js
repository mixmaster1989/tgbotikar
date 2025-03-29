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
    console.log('Сканируем папку materials:', materialsPath);
    const categories = await fs.readdir(materialsPath);
    console.log('Найденные элементы в папке materials:', categories);

    const structure = {};

    for (const category of categories) {
        const categoryPath = path.join(materialsPath, category);
        const isDirectory = await fs.stat(categoryPath).then(stat => stat.isDirectory());
        console.log(`Обрабатываем элемент: ${category} (папка: ${isDirectory})`);

        if (isDirectory) {
            structure[category] = {};
            const sections = await fs.readdir(categoryPath);
            console.log(`Найденные элементы в папке ${category}:`, sections);

            for (const section of sections) {
                const sectionPath = path.join(categoryPath, section);
                const isSectionDirectory = await fs.stat(sectionPath).then(stat => stat.isDirectory());
                console.log(`Обрабатываем элемент: ${section} (папка: ${isSectionDirectory})`);

                if (isSectionDirectory) {
                    const files = await fs.readdir(sectionPath);
                    console.log(`Найденные файлы в папке ${section}:`, files);

                    structure[category][section] = files.filter(file => file.endsWith('.docx'));
                    console.log(`Файлы .docx в папке ${section}:`, structure[category][section]);
                }
            }
        } else if (category.endsWith('.docx')) {
            structure[category] = null; // Указываем, что это файл, а не папка
            console.log(`Файл .docx в корне папки materials: ${category}`);
        }
    }

    console.log('Итоговая структура материалов:', structure);
    return structure;
}

// Функция для парсинга текста из .docx файла
async function parseDocx(filePath) {
    const options = {
        styleMap: [
            "p[style-name='Heading 1'] => h1",
            "p[style-name='Heading 2'] => h2",
            "p[style-name='Heading 3'] => h3",
            "b => strong",
            "i => em",
            "ul => ul",
            "ol => ol",
            "li => li"
        ]
    };

    const result = await mammoth.convertToHtml({ path: filePath }, options);
    const htmlContent = result.value.trim();

    const formattedContent = htmlContent
        .replace(/<h1>(.*?)<\/h1>/g, '*$1*')
        .replace(/<h2>(.*?)<\/h2>/g, '_$1_')
        .replace(/<h3>(.*?)<\/h3>/g, '`$1`')
        .replace(/<strong>(.*?)<\/strong>/g, '*$1*')
        .replace(/<em>(.*?)<\/em>/g, '_$1_')
        .replace(/<ul>/g, '')
        .replace(/<\/ul>/g, '')
        .replace(/<ol>/g, '')
        .replace(/<\/ol>/g, '')
        .replace(/<li>(.*?)<\/li>/g, '• $1')
        .replace(/<p>(.*?)<\/p>/g, '$1\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<\/?[^>]+(>|$)/g, '');

    return formattedContent;
}

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
const db = new sqlite3.Database('database.sqlite');

// Создание необходимых директорий
fs.ensureDirSync('uploads');

// Главное меню
function showMainMenu(ctx) {
    return ctx.reply('Выберите действие:',
        Markup.inlineKeyboard([
            [Markup.button.callback('Тесты', 'tests')],
            [Markup.button.callback('Материалы', 'materials')],
            [Markup.button.callback('Мои результаты', 'results')],
            [Markup.button.callback('🗑 Очистить базу', 'clear_db')]
        ])
    );
}

// Команда /start
bot.command('start', async (ctx) => {
    console.log('Команда /start вызвана');
    await showMainMenu(ctx);
});

// Обработка кнопки "Материалы"
bot.action('materials', async (ctx) => {
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure).map(category => {
        if (structure[category] === null) {
            return [Markup.button.callback(category, `open_docx:${category}`)];
        } else {
            return [Markup.button.callback(category, `category:${category}`)];
        }
    });
    buttons.push([Markup.button.callback('« На главную', 'main_menu')]);

    await ctx.editMessageText('Выберите категорию или файл:',
        Markup.inlineKeyboard(buttons)
    );
});

// Обработка открытия .docx файла
bot.action(/^open_docx:(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    const filePath = path.join(materialsPath, fileName);

    console.log(`Кнопка открытия файла нажата. Имя файла: ${fileName}, путь: ${filePath}`);

    try {
        const content = await parseDocx(filePath);
        console.log(`Содержимое файла "${fileName}":\n${content}`);

        if (content.length > 4096) {
            const chunks = content.match(/.{1,4096}/g);
            for (const chunk of chunks) {
                await ctx.replyWithMarkdown(chunk);
            }
        } else {
            await ctx.replyWithMarkdown(content);
        }
    } catch (err) {
        console.error(`Ошибка при чтении файла ${filePath}:`, err);
        await ctx.reply('Ошибка при открытии файла. Убедитесь, что файл существует и имеет правильный формат.');
    }
});

// Обработка кнопки "На главную"
bot.action('main_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await showMainMenu(ctx);
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
