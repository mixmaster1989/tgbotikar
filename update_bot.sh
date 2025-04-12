#!/bin/bash

# Переход в директорию проекта
cd ~/.ssh/tgbotikar

# Получаем последние изменения из Git
git pull origin master

# Устанавливаем зависимости (на случай обновления пакетов)
npm install

# Перезапускаем бота через PM2
pm2 restart telegram-bot
