const gpt4all = require('gpt4all');
const path = require('path');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const modelPath = path.join(process.env.HOME, '.cache', 'gpt4all', 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
        
        // Устанавливаем путь к модели через переменную окружения
        process.env.GPT4ALL_MODEL_PATH = modelPath;
        
        const model = await gpt4all.loadModel('mistral-7b-instruct-v0.1.Q4_K_M.gguf');
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
