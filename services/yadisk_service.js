const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

class YaDiskService {
    constructor(materialsPath) {
        this.materialsPath = materialsPath;
    }

    log(level, action, message, error = null) {
        console.log(`[${level.toUpperCase()}] [YaDisk/${action}] ${message}`, error || "");
    }

    async uploadFile(localPath, remotePath) {
        try {
            this.log("info", "upload", `Начало загрузки файла ${localPath} → ${remotePath}`);
            // Эмуляция успешного запроса к API
            await axios.put(remotePath, fs.createReadStream(localPath));
            this.log("success", "upload", `Файл успешно загружен: ${remotePath}`);
            return true;
        } catch (error) {
            this.log("error", "upload", `Ошибка при загрузке файла ${remotePath}`, error);
            throw error;
        }
    }

    async downloadFile(remotePath, localFileName) {
        try {
            const localPath = path.join(this.materialsPath, localFileName);
            this.log("info", "download", `Начало скачивания ${remotePath} → ${localPath}`);
            // Эмуляция успешного скачивания
            this.log("success", "download", `Файл ${remotePath} успешно скачан в ${localPath}`);
            return true;
        } catch (error) {
            this.log("error", "download", `Ошибка при скачивании ${remotePath}`, error);
            throw error;
        }
    }

    async downloadFileByPath(remotePath, localFileName) {
        try {
            const localPath = path.join(this.materialsPath, localFileName);
            this.log("info", "download", `Начало скачивания ${remotePath} → ${localPath}`);
            const response = await axios.get(remotePath, { responseType: "stream" });

            if (!response.data) {
                throw new Error("Нет данных для скачивания");
            }

            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            this.log("success", "download", `Файл ${remotePath} успешно скачан в ${localPath}`);
            return localPath;
        } catch (error) {
            this.log("error", "download", `Ошибка при скачивании ${remotePath}`, error);
            throw error;
        }
    }
}

module.exports = YaDiskService;
