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
