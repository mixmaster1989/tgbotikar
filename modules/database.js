const sqlite3 = require("sqlite3").verbose();

class DatabaseManager {
    constructor(dbPath = "database.sqlite") {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error("❌ Ошибка подключения к базе данных:", err);
            } else {
                console.log("✅ Успешное подключение к базе данных");
            }
        });
    }

    initCache() {
        this.db.run(
            `CREATE TABLE IF NOT EXISTS gpt_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt TEXT UNIQUE,
                response TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error("❌ Ошибка при создании таблицы:", err);
                } else {
                    console.log("✅ Таблица gpt_cache готова к использованию");
                }
            }
        );
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error("❌ Ошибка закрытия базы данных:", err);
            } else {
                console.log("✅ Соединение с базой данных закрыто");
            }
        });
    }
}

module.exports = new DatabaseManager();
