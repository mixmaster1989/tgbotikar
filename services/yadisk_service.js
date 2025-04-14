const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class YaDiskService {
    constructor(token) {
        if (!token) {
            throw new Error('Не указан токен Яндекс.Диска');
        }

        this.token = token;
        this.api = axios.create({
            baseURL: 'https://cloud-api.yandex.net/v1/disk/resources',
            headers: {
                'Authorization': `OAuth ${token}`
            }
        });
        this.materialsPath = path.join(__dirname, '..', 'materials');
    }

    async checkAccess() {
        try {
            const response = await this.api.get('/disk');
            console.log('✅ Доступ к Яндекс.Диску подтвержден');
            return true;
        } catch (error) {
            if (error.response?.status === 403) {
                console.error('❌ Ошибка доступа: недостаточно прав');
                console.error('👉 Проверьте права доступа токена в настройках приложения Яндекс.OAuth');
                throw new Error('Недостаточно прав для доступа к Яндекс.Диску');
            }
            throw error;
        }
    }

    async syncMaterials() {
        try {
            // Проверяем доступ перед синхронизацией
            await this.checkAccess();

            // Создаем папку materials если её нет
            await fs.ensureDir(this.materialsPath);

            // Получаем список файлов с Яндекс.Диска
            const response = await this.api.get('', {
                params: {
                    path: '/materials',
                    limit: 100
                }
            });

            const files = response.data._embedded.items.filter(
                item => item.type === 'file' && item.name.endsWith('.docx')
            );

            console.log(`📚 Найдено ${files.length} docx файлов на Яндекс.Диске`);

            // Скачиваем каждый файл
            for (const file of files) {
                const localPath = path.join(this.materialsPath, file.name);

                // Проверяем нужно ли обновлять файл
                const needsUpdate = !(await fs.pathExists(localPath)) ||
                    (await fs.stat(localPath)).mtime < new Date(file.modified);

                if (needsUpdate) {
                    console.log(`📥 Скачивание ${file.name}...`);
                    await this.downloadFile(file);
                }
            }

            return files.map(f => f.name);
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            throw error;
        }
    }

    async downloadFile(file) {
        try {
            // Получаем ссылку на скачивание
            const downloadResponse = await this.api.get('/download', {
                params: { path: file.path }
            });

            // Скачиваем файл
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
                    console.log(`✅ Файл ${file.name} успешно скачан`);
                    resolve(localPath);
                });
                writer.on('error', reject);
            });
        } catch (error) {
            console.error(`❌ Ошибка при скачивании ${file.name}:`, error.message);
            throw error;
        }
    }
}

module.exports = YaDiskService;