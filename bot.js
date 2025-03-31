const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mammoth = require('mammoth');
const { exec } = require('child_process'); // Для запуска LocalTunnel
require('dotenv').config();

// Путь к папке с материалами
const materialsPath = path.join(__dirname, 'materials');

// Глобальный объект для хранения путей к файлам
const fileMap = {};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Инициализация Express-сервера
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для добавления нестандартного заголовка User-Agent
app.use((req, res, next) => {
    req.headers['user-agent'] = 'CustomUserAgent/1.0'; // Устанавливаем нестандартный User-Agent
    next();
});

// Статические файлы для фронтенда
app.use('/static', express.static(path.join(__dirname, 'static')));

// Переменная для хранения HTTPS-URL от LocalTunnel
let webAppUrl = '';

// Функция для запуска LocalTunnel
function startLocalTunnel() {
    return new Promise((resolve, reject) => {
        const tunnel = exec(`lt --port ${PORT}`, (err, stdout, stderr) => {
            if (err) {
                console.error('Ошибка при запуске LocalTunnel:', err);
                reject(err);
            }
        });

        tunnel.stdout.on('data', (data) => {
            const match = data.match(/https:\/\/[^\s]+/);
            if (match) {
                webAppUrl = match[0];
                console.log(`LocalTunnel запущен: ${webAppUrl}`);
                resolve(webAppUrl);
            }
        });

        tunnel.stderr.on('data', (data) => {
            console.error('LocalTunnel stderr:', data);
        });

        setTimeout(() => {
            if (!webAppUrl) {
                reject(new Error('LocalTunnel не вернул URL'));
            }
        }, 10000); // Таймаут 10 секунд
    });
}

// Функция для парсинга .docx в HTML
async function parseDocxToHtml(filePath) {
    try {
        const result = await mammoth.convertToHtml({ path: filePath });
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return '<p>Ошибка при обработке файла. Проверьте его содержимое.</p>';
    }
}

// Функция для получения структуры папок и файлов
async function getMaterialsStructure() {
    const structure = {};
    try {
        const items = await fs.readdir(materialsPath);

        // Проверяем файлы в корне папки materials
        const rootFiles = items.filter(item => item.endsWith('.docx'));
        if (rootFiles.length > 0) {
            structure['Без категории'] = rootFiles.map((file, index) => {
                const id = `root-${index}`;
                fileMap[id] = path.join(materialsPath, file); // Сохраняем путь в fileMap
                return { id, name: file };
            });
        }

        // Проверяем папки категорий
        for (const item of items) {
            const itemPath = path.join(materialsPath, item);
            const isDirectory = await fs.stat(itemPath).then(stat => stat.isDirectory());

            if (isDirectory) {
                structure[item] = {};
                const sections = await fs.readdir(itemPath);

                for (const section of sections) {
                    const sectionPath = path.join(itemPath, section);
                    const isSectionDir = await fs.stat(sectionPath).then(stat => stat.isDirectory());

                    if (isSectionDir) {
                        const files = await fs.readdir(sectionPath);
                        structure[item][section] = files.filter(file => file.endsWith('.docx')).map((file, index) => {
                            const id = `${item}-${section}-${index}`;
                            fileMap[id] = path.join(sectionPath, file); // Сохраняем путь в fileMap
                            return { id, name: file };
                        });
                    }
                }
            }
        }
        console.log('Структура материалов:', structure); // Логируем структуру
    } catch (err) {
        console.error('Ошибка при получении структуры материалов:', err);
    }
    return structure;
}

// Маршрут для отображения статьи
app.get('/article/:id', async (req, res) => {
    const { id } = req.params;
    const filePath = fileMap[id]; // Получаем путь из fileMap

    console.log(`Запрос на файл: ${filePath}`);

    if (!filePath || !fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return res.status(404).send('Файл не найден');
    }

    try {
        const htmlContent = await parseDocxToHtml(filePath);
        console.log(`HTML-контент успешно сгенерирован для файла: ${filePath}`);
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${path.basename(filePath)}</title>
                <link rel="stylesheet" href="/static/styles.css">
            </head>
            <body>
                <div class="container">
                    <div class="article">
                        ${htmlContent}
                    </div>
                    <button class="close-btn" onclick="Telegram.WebApp.close()">Закрыть</button>
                </div>
                <script src="https://telegram.org/js/telegram-web-app.js"></script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(`Ошибка при обработке файла ${filePath}:`, err);
        res.status(500).send('Ошибка при обработке файла');
    }
});

// Команда /start для приветствия и отображения кнопки
bot.start(async (ctx) => {
    await ctx.reply(
        'Добро пожаловать! Этот бот поможет вам просматривать материалы. Нажмите на кнопку ниже, чтобы начать.',
        Markup.inlineKeyboard([
            Markup.button.callback('📂 Просмотреть материалы', 'open_materials')
        ])
    );
});

// Обработка кнопки "Просмотреть материалы"
bot.action('open_materials', async (ctx) => {
    const structure = await getMaterialsStructure();
    const buttons = Object.keys(structure).map(category => [
        Markup.button.callback(category, `category:${category}`)
    ]);

    if (buttons.length === 0) {
        return ctx.reply('Нет доступных категорий.');
    }

    await ctx.reply('Выберите категорию:', Markup.inlineKeyboard(buttons));
});

// Обработка выбора категории
bot.action(/^category:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const structure = await getMaterialsStructure();
    const materials = structure[category];

    if (!materials || materials.length === 0) {
        return ctx.reply('В этой категории нет материалов.');
    }

    const buttons = materials.map(material => [
        Markup.button.callback(material.name, `material:${material.id}`)
    ]);

    buttons.push([Markup.button.callback('🔙 Назад', 'materials')]);

    await ctx.reply(`Категория: ${category}\nВыберите материал:`, Markup.inlineKeyboard(buttons));
});

// Обработка выбора материала
bot.action(/^material:(.+)$/, async (ctx) => {
    const materialId = ctx.match[1];
    const filePath = fileMap[materialId]; // Получаем путь из fileMap

    if (!filePath || !fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return ctx.reply('Файл не найден.');
    }

    try {
        const url = `${webAppUrl}/article/${materialId}`;
        console.log(`Ссылка на Web App: ${url}`);

        // Отправляем сообщение с Web App
        await ctx.reply(
            `Открываю материал "${path.basename(filePath)}" в Web App...`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Открыть материал',
                                web_app: { url }
                            }
                        ]
                    ]
                }
            }
        );
    } catch (err) {
        console.error(`Ошибка при обработке файла ${filePath}:`, err);
        await ctx.reply('Ошибка при обработке материала.');
    }
});

// Запуск Express-сервера и LocalTunnel
app.listen(PORT, async () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    try {
        await startLocalTunnel();
        console.log(`Web App доступен по адресу: ${webAppUrl}`);
    } catch (err) {
        console.error('Не удалось запустить LocalTunnel:', err);
    }
});

// Запуск бота
bot.launch(() => console.log('Бот запущен!'));
