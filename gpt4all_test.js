const { GPT4All } = require('gpt4all');
const path = require('path');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const modelPath = process.env.GPT4ALL_MODEL_PATH;
        
        const model = new GPT4All();
        await model.loadModel(modelPath);
        
        console.log('Модель инициализирована');
        
        const response = await model.generate('Привет, как дела?', {
            temperature: 0.7,
            max_tokens: 100
        });
        
        console.log('Ответ:', response);
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

testGPT4All();
