module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: 'bot.js',
    watch: true,
    restart_delay: 1000,
    env: {
      NODE_ENV: 'production'
    },
    node_args: '-r dotenv/config', // Загрузка .env
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '500M'
  }]
}
