const libre = require('libreoffice-convert');
const fs = require('fs-extra');
const logger = require("./logger");
const pdf = require('pdf-poppler');

/**
 * Конвертирует DOCX в PDF
 * @param {string} inputPath - путь к DOCX файлу
 * @param {string} outputPath - путь для сохранения PDF файла
 */
async function convertDocxToPdf(inputPath, outputPath) {
    try {
        const docxBuf = await fs.readFile(inputPath);
        const pdfBuf = await new Promise((resolve, reject) => {
            libre.convert(docxBuf, '.pdf', undefined, (err, done) => {
                if (err) reject(err);
                else resolve(done);
            });
        });
        await fs.outputFile(outputPath, pdfBuf);
        logger.info(`DOCX успешно конвертирован в PDF: ${outputPath}`);
    } catch (err) {
        logger.error(`Ошибка при конвертации DOCX в PDF (${inputPath}): ${err.message}`);
        throw err;
    }
}

/**
 * Генерирует миниатюру первой страницы PDF
 * @param {string} pdfPath - путь к PDF
 * @param {string} thumbPath - путь для сохранения PNG
 */
async function generatePdfThumbnail(pdfPath, thumbPath) {
    const pdf = require('pdf-poppler'); // импорт внутри функции
    try {
        const opts = {
            format: 'png',
            out_dir: require('path').dirname(thumbPath),
            out_prefix: require('path').basename(thumbPath, '.png'),
            page: 1,
            scale: 1024
        };
        await pdf.convert(pdfPath, opts);
        logger.info(`Миниатюра PDF создана: ${thumbPath}`);
    } catch (err) {
        logger.error(`Ошибка при создании миниатюры PDF (${pdfPath}): ${err.message}`);
        throw err;
    }
}

module.exports = { convertDocxToPdf, generatePdfThumbnail };
