module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: 'bot.js',
    watch: true,
    restart_delay: 1000,
    env: {
      NODE_ENV: 'production'
    },
    node_args: '-r dotenv/config', 
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '500M',
    error_file: '/home/user1/.ssh/tgbotikar/pm2_error.log',
    out_file: '/home/user1/.ssh/tgbotikar/pm2_out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
}
