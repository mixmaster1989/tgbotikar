import sys
import requests
import json

if len(sys.argv) != 2:
    print("Usage: ocr_postprocess.py <input_text_file>")
    sys.exit(1)

input_path = sys.argv[1]

with open(input_path, 'r', encoding='utf-8') as f:
    text = f.read()

# LanguageTool API (локальный сервер)
url = 'http://localhost:8081/v2/check'
data = {
    'text': text,
    'language': 'ru-RU'
}
try:
    resp = requests.post(url, data=data)
    result = resp.json()
    matches = result.get('matches', [])
    # Применяем исправления LanguageTool
    offset = 0
    for match in matches:
        if 'replacements' in match and match['replacements']:
            replacement = match['replacements'][0]['value']
            start = match['offset'] + offset
            end = start + match['length']
            text = text[:start] + replacement + text[end:]
            offset += len(replacement) - match['length']
except Exception as e:
    print('LanguageTool error:', e)

print(text)
