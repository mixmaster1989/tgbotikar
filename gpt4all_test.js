const gpt4all = require('gpt4all');
const path = require('path');
const fs = require('fs');

async function waitForFileDownload(filePath, maxWaitTime = 600000) { // 10 минут максимум
    const startTime = Date.now();
    while (true) {
        if (fs.existsSync(filePath) && !filePath.endsWith('.part')) {
            return true;
        }
        
        if (Date.now() - startTime > maxWaitTime) {
            throw new Error(`Превышено время ожидания загрузки файла: ${filePath}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Ждем 5 секунд
    }
}

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const modelDir = path.join(process.env.HOME, '.cache', 'gpt4all');
        const partModelPath = path.join(modelDir, 'mistral-7b-instruct-v0.1.Q4_K_M.gguf.part');
        const finalModelPath = path.join(modelDir, 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
        
        console.log('Ожидание завершения загрузки модели...');
        await waitForFileDownload(partModelPath);
        
        console.log('Полный путь к модели:', finalModelPath);
        
        // Проверяем существование файла
        if (!fs.existsSync(finalModelPath)) {
            console.error(`ОШИБКА: Файл модели не найден по пути: ${finalModelPath}`);
            console.error('Содержимое директории:', fs.readdirSync(modelDir));
            throw new Error(`Файл модели не найден: ${finalModelPath}`);
        }
        
        // Получаем статистику файла
        const stats = fs.statSync(finalModelPath);
        console.log('Размер файла модели:', stats.size, 'байт');
        
        const model = await gpt4all.loadModel(finalModelPath);
        
        console.log('Модель инициализирована');
        
        const response = await model.prompt('Привет, как дела?', {
            temperature: 0.7,
            max_tokens: 100
        });
        
        console.log('Ответ:', response);
    } catch (error) {
        console.error('Ошибка:', error);
        console.error('Детали ошибки:', error.stack);
    }
}

testGPT4All();
