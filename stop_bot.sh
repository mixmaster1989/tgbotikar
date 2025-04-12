#!/bin/bash

# Находим и убиваем все дочерние процессы
pkill -f "node test_cache.js"
pkill -f "node bot.js"

# Останавливаем PM2 процессы
pm2 stop telegram-bot
pm2 delete telegram-bot

# Дополнительная очистка
killall node
