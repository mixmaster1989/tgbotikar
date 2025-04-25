# -*- coding: utf-8 -*-
import sys
from symspellpy import SymSpell, Verbosity
import pkg_resources
import os

# Путь к частотному словарю русского языка (можно заменить на свой)
# Формат: слово частота
DEFAULT_DICT_PATH = os.path.join(os.path.dirname(__file__), "ru_frequency_dictionary.txt")

# Настройки SymSpell
max_edit_distance = 2
prefix_length = 7

# Инициализация SymSpell
sym_spell = SymSpell(max_dictionary_edit_distance=max_edit_distance, prefix_length=prefix_length)

# Загрузка частотного словаря
if os.path.exists(DEFAULT_DICT_PATH):
    sym_spell.load_dictionary(DEFAULT_DICT_PATH, term_index=0, count_index=1, encoding="utf-8")
else:
    print("[ERROR] Frequency dictionary not found!", file=sys.stderr)
    sys.exit(1)

# Получаем текст из stdin или аргумента
if len(sys.argv) > 1:
    text = sys.argv[1]
else:
    text = sys.stdin.read()

# Коррекция каждой строки по отдельности
lines = text.split("\n")
result_lines = []
for line in lines:
    # Удаляем строки без русских букв
    if not any("а" <= c <= "я" or "А" <= c <= "Я" for c in line):
        continue
    # Исправляем каждое слово
    words = line.split()
    corrected = []
    for word in words:
        suggestions = sym_spell.lookup(word, Verbosity.CLOSEST, max_edit_distance=max_edit_distance)
        if suggestions:
            corrected.append(suggestions[0].term)
        else:
            corrected.append(word)
    # Собираем строку обратно
    result_lines.append(" ".join(corrected))

# Выводим результат
print("\n".join(result_lines))
