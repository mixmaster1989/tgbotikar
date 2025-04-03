const { loadModel, createCompletion } = require('gpt4all');
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
    let model = null;
    try {
        console.log('Инициализация GPT4All...');
        const modelDir = path.join(os.homedir(), '.cache', 'gpt4all');
        const modelPath = path.join(modelDir, 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
        const configPath = path.join(modelDir, 'models3.json');
        
        console.log('Полный путь к модели:', modelPath);
        console.log('Путь к конфигурации:', configPath);
        
        // Проверяем существование файлов
        if (!fs.existsSync(modelPath)) {
            console.error(`ОШИБКА: Файл модели не найден по пути: ${modelPath}`);
            console.error('Содержимое директории:', fs.readdirSync(modelDir));
            throw new Error(`Файл модели не найден: ${modelPath}`);
        }

        if (!fs.existsSync(configPath)) {
            console.error(`ОШИБКА: Файл конфигурации не найден по пути: ${configPath}`);
            throw new Error(`Файл конфигурации не найден: ${configPath}`);
        }

        // Получаем статистику файлов
        const modelStats = fs.statSync(modelPath);
        const configStats = fs.statSync(configPath);
        console.log('Размер файла модели:', modelStats.size, 'байт');
        console.log('Размер файла конфигурации:', configStats.size, 'байт');

        // Загрузка модели с явным указанием путей
        model = await loadModel(modelPath, {
            verbose: true,
            device: 'cpu',
            modelConfigFile: configPath
        });

        // Создание chat-сессии
        const chat = await model.createChatSession({
            temperature: 0.7,
            systemPrompt: 'Ты helpful AI ассистент. Отвечай кратко и по существу.'
        });

        // Тестовый промпт
        const prompt = 'Расскажи короткую историю о программисте';
        console.log(`Отправляем промпт: ${prompt}`);

        const response = await createCompletion(chat, prompt);

        console.log('Ответ модели:');
        console.log(response.choices[0].message.content);

        // Освобождаем ресурсы
        model.dispose();

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Ошибка при работе с GPT4All:', error);
        console.error('Детали ошибки:', error.stack);
        
        // Освобождаем ресурсы в случае ошибки
        if (model) {
            model.dispose();
        }
        
        throw error;
    }
}

// Функция для предварительной загрузки конфигурации моделей
async function downloadModelConfig() {
    const modelDir = path.join(os.homedir(), '.cache', 'gpt4all');
    const configPath = path.join(modelDir, 'models3.json');
    
    if (!fs.existsSync(configPath)) {
        console.log('Загрузка конфигурации моделей...');
        try {
            const { execSync } = require('child_process');
            execSync(`curl -L https://gpt4all.io/models/models3.json -o ${configPath}`);
            console.log('Конфигурация моделей загружена');
        } catch (error) {
            console.error('Ошибка загрузки конфигурации:', error);
        }
    }
}

// Функция для проверки доступности модели
function checkModelAvailability() {
    const modelDir = path.join(os.homedir(), '.cache', 'gpt4all');
    const modelPath = path.join(modelDir, 'mistral-7b-instruct-v0.1.Q4_K_M.gguf');
    const configPath = path.join(modelDir, 'models3.json');

    console.log('Проверка доступности модели и конфигурации...');
    console.log('Директория моделей:', modelDir);
    
    try {
        const files = fs.readdirSync(modelDir);
        console.log('Файлы в директории:', files);
    } catch (error) {
        console.error('Ошибка чтения директории:', error);
    }

    if (!fs.existsSync(modelPath)) {
        console.error(`ВНИМАНИЕ: Файл модели не найден: ${modelPath}`);
    } else {
        console.log(`Файл модели найден: ${modelPath}`);
    }

    if (!fs.existsSync(configPath)) {
        console.error(`ВНИМАНИЕ: Файл конфигурации не найден: ${configPath}`);
    } else {
        console.log(`Файл конфигурации найден: ${configPath}`);
    }
}

// Немедленный запуск теста при выполнении скрипта
if (require.main === module) {
    (async () => {
        try {
            checkModelAvailability();
            await downloadModelConfig();
            await testGPT4All();
            console.log('Тест GPT4All завершен успешно');
        } catch (err) {
            console.error('Ошибка в тесте GPT4All:', err);
        }
    })();
}

// Экспортируем функции для использования в других модулях
module.exports = {
    testGPT4All,
    waitForFileDownload,
    downloadModelConfig,
    checkModelAvailability
};
