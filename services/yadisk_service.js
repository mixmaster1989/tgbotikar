const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class YaDiskService {
    constructor(token) {
        if (!token) {
            this.log('error', 'init', 'Не указан токен Яндекс.Диска');
            throw new Error('Не указан токен Яндекс.Диска');
        }

        this.token = token;
        // Изменяем базовый URL
        this.api = axios.create({
            baseURL: 'https://cloud-api.yandex.net/v1/disk',
            headers: {
                'Authorization': `OAuth ${token}`
            }
        });
        this.materialsPath = path.join(__dirname, '..', 'materials');
        this.log('info', 'init', `Инициализация сервиса. Локальная папка: ${this.materialsPath}`);
    }

    // Вспомогательный метод для логирования
    log(level, operation, message, error = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            service: 'YaDisk',
            operation,
            message
        };

        if (error) {
            logEntry.error = {
                message: error.message,
                code: error.response?.status,
                details: error.response?.data
            };
        }

        // Форматируем для консоли
        const emoji = {
            info: 'ℹ️',
            error: '❌',
            warn: '⚠️',
            success: '✅'
        };

        console.log(`${emoji[level] || '🔄'} [${timestamp}] [YaDisk/${operation}] ${message}${error ? `\n  Error: ${JSON.stringify(logEntry.error, null, 2)}` : ''
            }`);
    }

    async checkAccess() {
        try {
            this.log('info', 'checkAccess', 'Проверка всех прав доступа к Яндекс.Диску...');

            // 1. Проверка доступа к информации о диске
            const diskInfo = await this.api.get('/');
            const totalGb = (diskInfo.data.total_space / 1024 / 1024 / 1024).toFixed(2);
            this.log('info', 'checkAccess', `✓ Доступ к информации о диске. Всего: ${totalGb} GB`);

            // 2. Проверка чтения диска (корневая директория)
            const rootContent = await this.api.get('/resources', {
                params: { path: '/' }
            });
            this.log('info', 'checkAccess', '✓ Чтение диска работает');

            // 3. Проверка возможности записи (создаем временную папку)
            const testFolderName = `test_${Date.now()}`;
            await this.api.put('/resources', {
                params: { path: `/${testFolderName}` }
            });
            this.log('info', 'checkAccess', '✓ Запись на диск работает');

            // Удаляем тестовую папку
            await this.api.delete('/resources', {
                params: { path: `/${testFolderName}` }
            });

            this.log('success', 'checkAccess', 'Все права доступа подтверждены ✓');
            return true;

        } catch (error) {
            if (error.response?.status === 403) {
                this.log('error', 'checkAccess', `❌ Ошибка прав доступа: ${error.response.data.message}`, error);
                throw new Error('Недостаточно прав для доступа к Яндекс.Диску');
            }
            this.log('error', 'checkAccess', 'Ошибка при проверке доступа', error);
            throw error;
        }
    }

    async getAllDocxFiles(path = '/') {
        try {
            this.log('info', 'scan', `Сканирование директории: ${path}`);
            const response = await this.api.get('/resources', {
                params: {
                    path: path,
                    limit: 100
                }
            });

            let files = [];
            const items = response.data._embedded.items;

            // Находим все docx файлы в текущей директории
            const docxFiles = items.filter(item =>
                item.type === 'file' && item.name.endsWith('.docx')
            );
            files.push(...docxFiles);

            // Рекурсивно обходим все поддиректории
            const folders = items.filter(item => item.type === 'dir');
            for (const folder of folders) {
                this.log('info', 'scan', `Переход в папку: ${folder.path}`);
                const subFiles = await this.getAllDocxFiles(folder.path);
                files.push(...subFiles);
            }

            return files;
        } catch (error) {
            this.log('error', 'scan', `Ошибка при сканировании ${path}`, error);
            throw error;
        }
    }

    async syncMaterials() {
        try {
            this.log('info', 'sync', 'Начало синхронизации материалов...');
            await this.checkAccess();

            // Создаём локальную папку если её нет
            await fs.ensureDir(this.materialsPath);
            this.log('info', 'sync', `Локальная папка готова: ${this.materialsPath}`);

            // Получаем все .docx файлы со всего диска
            const files = await this.getAllDocxFiles();
            this.log('info', 'sync', `Всего найдено .docx файлов: ${files.length}`);

            let updated = 0;
            for (const file of files) {
                const localPath = path.join(this.materialsPath, file.name);
                const needsUpdate = !(await fs.pathExists(localPath)) ||
                    (await fs.stat(localPath)).mtime < new Date(file.modified);

                if (needsUpdate) {
                    await this.downloadFile(file);
                    updated++;
                } else {
                    this.log('info', 'sync', `Пропуск ${file.name} - актуальная версия`);
                }
            }

            this.log('success', 'sync', `Синхронизация завершена. Обновлено файлов: ${updated}/${files.length}`);
            return files.map(f => f.name);
        } catch (error) {
            this.log('error', 'sync', 'Ошибка при синхронизации', error);
            throw error;
        }
    }

    async downloadFile(file) {
        try {
            this.log('info', 'download', `Получение ссылки для скачивания ${file.name}...`);
            const downloadResponse = await this.api.get('/resources/download', {
                params: { path: file.path }
            });

            this.log('info', 'download', `Начало скачивания ${file.name}`);
            const response = await axios({
                method: 'GET',
                url: downloadResponse.data.href,
                responseType: 'stream'
            });

            const localPath = path.join(this.materialsPath, file.name);
            const writer = fs.createWriteStream(localPath);

            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    this.log('success', 'download', `Файл ${file.name} успешно скачан в ${localPath}`);
                    resolve(localPath);
                });
                writer.on('error', (err) => {
                    this.log('error', 'download', `Ошибка записи файла ${file.name}`, err);
                    reject(err);
                });
            });
        } catch (error) {
            this.log('error', 'download', `Ошибка при скачивании ${file.name}`, error);
            throw error;
        }
    }
}

module.exports = YaDiskService;