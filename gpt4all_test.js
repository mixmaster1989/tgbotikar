const gpt4all = require('gpt4all');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
        const modelDir = path.join(os.homedir(), '.cache', 'gpt4all');
        const modelPath = path.join(modelDir, 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
        
        console.log('Полный путь к модели:', modelPath);
        
        // Проверяем существование файла
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Файл модели не найден: ${modelPath}`);
        }

        // Инициализация модели
        const gpt = await gpt4all.init({
            model: modelPath,
            modelType: 'mistral',
            verbose: true
        });

        // Тестовый промпт
        const prompt = 'Расскажи короткую историю о программисте';
        console.log(`Отправляем промпт: ${prompt}`);

        const response = await gpt.prompt(prompt, {
            max_tokens: 200,
            temperature: 0.7,
            top_p: 0.9
        });

        console.log('Ответ модели:');
        console.log(response);

        return response;
    } catch (error) {
        console.error('Ошибка при работе с GPT4All:', error);
        console.error('Детали ошибки:', error.stack);
        throw error;
    }
}

// Немедленный запуск теста при выполнении скрипта
if (require.main === module) {
    testGPT4All()
        .then(() => console.log('Тест GPT4All завершен успешно'))
        .catch(err => console.error('Ошибка в тесте GPT4All:', err));
}

// Экспортируем функции для использования в других модулях
module.exports = {
    testGPT4All,
    waitForFileDownload
};
