const fs = require('fs-extra');
const path = require('path');

// Путь к папке для фото и видео
const mediaPath = path.join('fs-files', 'photo');

// Сохранение файла
async function saveFile(file, fileName) {
    try {
        const filePath = path.join(mediaPath, fileName);
        await fs.ensureDir(mediaPath); // Создаём папку, если её нет
        await fs.writeFile(filePath, file); // Сохраняем файл
        console.log('Файл сохранён:', filePath);
    } catch (error) {
        console.error('Ошибка при сохранении файла:', error);
    }
}

// Получение файла
async function getFile(fileName) {
    try {
        const filePath = path.join(mediaPath, fileName);
        if (await fs.pathExists(filePath)) {
            const file = await fs.readFile(filePath);
            return file;
        } else {
            throw new Error('Файл не найден');
        }
    } catch (error) {
        console.error('Ошибка при получении файла:', error);
    }
}

// Экспорт функций
module.exports = {
    saveFile,
    getFile,
};

const fs = require("fs");

// Пример использования sendPhoto с локальным файлом
bot.action(/open_material_(\d+)/, async (ctx) => {
    const materialId = ctx.match[1];
    db.get("SELECT * FROM materials WHERE id = ?", [materialId], (err, row) => {
        if (err) {
            console.error("Ошибка при получении материала:", err);
            ctx.reply("Произошла ошибка при получении материала.");
        } else {
            const filePath = `fs-files/photo/${row.photo}`;
            if (fs.existsSync(filePath)) {
                ctx.replyWithPhoto({ source: filePath }, {
                    caption: `${row.title}\n\n${row.content}`,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Назад", callback_data: "back_to_materials" }],
                        ],
                    },
                });
            } else {
                ctx.reply("Файл не найден.");
            }
        }
    });
});