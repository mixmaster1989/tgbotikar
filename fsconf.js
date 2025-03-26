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
} 
catch (error) {
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

// Экспорт функций
module.exports = {
    saveFile,
    getFile,
};




            }
        }
