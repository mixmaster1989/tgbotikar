module.exports = {
    apps: [{
        name: "telegram-bot",
        script: "./start.js", // Указываем start.js как точку входа
        watch: true,
        ignore_watch: ["node_modules", "logs"],
        env: {
            NODE_ENV: "production"
        },
        log_file: "./logs/pm2.log",
        error_file: "./logs/pm2-error.log",
        out_file: "./logs/pm2-out.log"
    }]
};
