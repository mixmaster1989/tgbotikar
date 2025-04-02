const gpt4all = require('gpt4all');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const model = await gpt4all.createEmbedder();
        
        console.log('Модель инициализирована');
        
        const response = await model.embed('Привет, как дела?');
        
        console.log('Ответ:', response);
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

testGPT4All();
