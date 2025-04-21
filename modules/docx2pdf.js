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
// Конвертация DOCX в PDF с помощью libreoffice-convert
const libre = require('libreoffice-convert');

async function convertDocxToPdf(inputPath, outputPath) {
    const fs = require('fs-extra');
    const docxBuf = await fs.readFile(inputPath);
    // Используем промисифицированную версию
    const pdfBuf = await new Promise((resolve, reject) => {
        libre.convert(docxBuf, '.pdf', undefined, (err, done) => {
            if (err) reject(err);
            else resolve(done);
        });
    });
    await fs.outputFile(outputPath, pdfBuf);
}

module.exports = { convertDocxToPdf };
