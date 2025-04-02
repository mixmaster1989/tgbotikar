const gpt4all = require('gpt4all');
const path = require('path');

async function testGPT4All() {
    try {
        console.log('Содержимое gpt4all:', Object.keys(gpt4all));
        console.log('Тип gpt4all:', typeof gpt4all);
        
        console.log('Инициализация GPT4All...');
        const modelPath = process.env.GPT4ALL_MODEL_PATH;
        
        console.log('Доступные методы:', Object.keys(gpt4all));
        
        const model = await gpt4all.load(modelPath);
        
        console.log('Модель инициализирована');
        
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
