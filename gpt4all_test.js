const gpt4all = require('gpt4all');
const path = require('path');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const modelPath = path.join(process.env.HOME, '.cache', 'gpt4all', 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
        
        console.log('Полный путь к модели:', modelPath);
        
        const model = await gpt4all.loadModel(modelPath);
        
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
