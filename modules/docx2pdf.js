const libre = require('libreoffice-convert');
const fs = require('fs-extra');

/**
 * Конвертирует DOCX в PDF
 * @param {string} inputPath - путь к DOCX файлу
 * @param {string} outputPath - путь для сохранения PDF файла
 */
async function convertDocxToPdf(inputPath, outputPath) {
    const docxBuf = await fs.readFile(inputPath);
    const pdfBuf = await new Promise((resolve, reject) => {
        libre.convert(docxBuf, '.pdf', undefined, (err, done) => {
            if (err) reject(err);
            else resolve(done);
        });
    });
    await fs.outputFile(outputPath, pdfBuf);
}

module.exports = { convertDocxToPdf };