const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'telegram-bot' },
    transports: [
        // Файл для всех уровней логов
        new winston.transports.File({
            filename: path.join(__dirname, '..', 'logs', 'error.log'),
            level: 'error',
            handleExceptions: true
        }),
        // Файл для информационных логов
        new winston.transports.File({
            filename: path.join(__dirname, '..', 'logs', 'combined.log'),
            handleExceptions: true
        }),
        // Вывод в консоль
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ],
    exitOnError: false
});

module.exports = logger;
