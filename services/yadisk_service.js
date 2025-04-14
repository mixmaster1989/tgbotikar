const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class YaDiskService {
    constructor(token) {
        if (!token) {
            throw new Error('YANDEX_DISK_TOKEN is not provided');
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

    async syncMaterials() {
        try {
            // Ensure materials directory exists
            await fs.ensureDir(this.materialsPath);

            // Get files list from Yandex.Disk
            const response = await this.api.get('', {
                params: {
                    path: '/materials',
                    limit: 100
                }
            });

            const files = response.data._embedded.items.filter(
                item => item.type === 'file' && item.name.endsWith('.docx')
            );

            console.log(`📚 Found ${files.length} .docx files on Yandex.Disk`);

            // Download each file
            for (const file of files) {
                const localPath = path.join(this.materialsPath, file.name);

                const needsUpdate = !(await fs.pathExists(localPath)) ||
                    (await fs.stat(localPath)).mtime < new Date(file.modified);

                if (needsUpdate) {
                    console.log(`📥 Downloading ${file.name}...`);
                    await this.downloadFile(file);
                }
            }

            return files.map(f => f.name);
        } catch (error) {
            console.error('❌ Sync error:', error.message);
            throw error;
        }
    }

    async downloadFile(file) {
        try {
            const downloadResponse = await this.api.get('/download', {
                params: { path: file.path }
            });

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
                    console.log(`✅ Downloaded ${file.name}`);
                    resolve(localPath);
                });
                writer.on('error', reject);
            });
        } catch (error) {
            console.error(`❌ Download error for ${file.name}:`, error.message);
            throw error;
        }
    }
}

module.exports = YaDiskService;