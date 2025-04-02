const { GPT4All } = require('gpt4all');

async function testGPT4All() {
    try {
        console.log('Инициализация GPT4All...');
        const model = new GPT4All();
        
        await model.init();
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
