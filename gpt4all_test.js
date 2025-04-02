const gpt4all = require('gpt4all');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const model = await gpt4all.loadModel('gpt4all-j-v1.3-groovy');
        
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
