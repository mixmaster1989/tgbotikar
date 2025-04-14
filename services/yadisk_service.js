const axios = require('axios');
const fs = require('fs');
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

    async listDocxFiles(folderPath = '/materials') {
        try {
            const response = await this.api.get('', {
                params: {
                    path: folderPath,
                    limit: 100
                }
            });
            
            console.log('📂 Получен список файлов с Яндекс.Диска');
            return response.data._embedded.items.filter(item => 
                item.type === 'file' && item.name.toLowerCase().endsWith('.docx')
            );
        } catch (error) {
            console.error('❌ Ошибка при получении списка файлов:', error.message);
            throw error;
        }
    }

    async downloadFile(file) {
        try {
            const downloadResponse = await this.api.get('/download', {
                params: { path: file.path }
            });

            const localPath = path.join(this.materialsPath, file.name);
            const writer = fs.createWriteStream(localPath);

            const response = await axios({
                method: 'GET',
                url: downloadResponse.data.href,
                responseType: 'stream'
            });

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

    async syncMaterials() {
        try {
            if (!fs.existsSync(this.materialsPath)) {
                fs.mkdirSync(this.materialsPath, { recursive: true });
            }

            const files = await this.listDocxFiles();
            console.log(`📚 Найдено ${files.length} docx файлов на Яндекс.Диске`);

            for (const file of files) {
                const localPath = path.join(this.materialsPath, file.name);
                const needsUpdate = !fs.existsSync(localPath) || 
                    new Date(file.modified) > fs.statSync(localPath).mtime;

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
}

module.exports = YaDiskService;