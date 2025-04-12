const mammoth = require("mammoth");
const fs = require("fs-extra");
const path = require("path");

class DocxProcessor {
    constructor(materialsPath = path.join(__dirname, "..", "materials")) {
        this.materialsPath = materialsPath;
    }

    async extractText(filePath) {
        try {
            console.log(`📄 Извлечение текста из файла: ${filePath}`);
            const result = await mammoth.extractRawText({ path: filePath });
            console.log(`✅ Текст успешно извлечен (длина: ${result.value.length})`);
            return result.value.trim();
        } catch (err) {
            console.error(`❌ Ошибка при парсинге файла ${filePath}:`, err);
            return "";
        }
    }

    async listFiles() {
        try {
            console.log('🔍 Чтение папки materials...');
            const items = await fs.readdir(this.materialsPath);
            const files = items.filter(item => item.endsWith(".docx"));
            
            console.log(`📋 Найдено .docx файлов: ${files.length}`);
            console.log(`📁 Файлы: ${files.join(', ')}`);
            
            return files;
        } catch (err) {
            console.error("❌ Ошибка при получении списка файлов:", err);
            return [];
        }
    }
}

module.exports = new DocxProcessor();
