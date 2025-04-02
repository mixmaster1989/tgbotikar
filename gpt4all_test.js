const gpt4all = require('gpt4all');
const path = require('path');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        
        // Список моделей для попытки загрузки
        const modelNames = [
            'Phi-3-mini-4k-instruct.Q4_0.gguf',
            'mistral-7b-instruct-v0.1.Q4_0.gguf',
            'gpt4all-13b-snoozy-q4_0.gguf'
        ];

        let model = null;
        for (const modelName of modelNames) {
            try {
                console.log(`Пытаемся загрузить модель: ${modelName}`);
                model = await gpt4all.loadModel(modelName);
                console.log(`Модель ${modelName} успешно загружена!`);
                break;
            } catch (err) {
                console.warn(`Не удалось загрузить модель ${modelName}:`, err.message);
            }
        }

        if (!model) {
            throw new Error('Не удалось загрузить ни одну из моделей');
        }
        
        const response = await model.prompt('Привет, как дела?', {
            temperature: 0.7,
            max_tokens: 100
        });
        
        console.log('Ответ:', response);
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

testGPT4All();
