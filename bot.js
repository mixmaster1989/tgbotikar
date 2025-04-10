const { Telegraf, Markup, session } = require("telegraf");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const fs = require("fs-extra");
const express = require("express");
const path = require("path");
const mammoth = require("mammoth");
const axios = require("axios");
const { GPT4All } = require("gpt4all");
require("dotenv").config();
const os = require("os");
const gpt4all = require("gpt4all");

// Определяем директорию для модели
const modelDir = path.join(os.homedir(), ".cache", "gpt4all");

// Путь к файлу модели
const finalModelPath = path.join(
    modelDir,
    "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf"
);

// Путь к папке с материалами
const materialsPath = path.join(__dirname, "materials");

// Глобальный объект для хранения путей к файлам
const fileMap = {};

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Инициализация Express-сервера
const app = express();
const PORT = process.env.PORT || 3000;

// Статические файлы для фронтенда
app.use("/static", express.static(path.join(__dirname, "static")));

// URL Web App (используем публичный IP)
const webAppUrl = `http://89.169.131.216:${PORT}`;
// Добавляем логгер
const logger = require("pino")({
    level: "debug",
    transport: {
        target: "pino-pretty",
    },
});

// Логируем инициализацию
logger.info("Инициализация бота...");
logger.debug(`Путь к модели: ${finalModelPath}`);
logger.debug(`Путь к материалам: ${materialsPath}`);

// Добавляем логирование ошибок
process.on("uncaughtException", (err) => {
    logger.error("Неперехваченная ошибка: ", err);
});
// Функция для парсинга .docx в текст
async function parseDocxToText(filePath) {
    try {
        console.log(`Парсинг файла: ${filePath}`);
        const result = await mammoth.extractRawText({ path: filePath });
        console.log(`Парсинг завершен: ${filePath}`);
        return result.value.trim();
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "";
    }
}

// Функция для парсинга .docx в HTML
async function parseDocxToHtml(filePath) {
    try {
        console.log(`Парсинг файла: ${filePath}`);
        const result = await mammoth.convertToHtml({ path: filePath });
        console.log(`Парсинг завершен: ${filePath}`);
        return result.value.trim(); // Возвращаем HTML-контент
    } catch (err) {
        console.error(`Ошибка при парсинге файла ${filePath}:`, err);
        return "<p>Ошибка при обработке файла.</p>"; // Возвращаем сообщение об ошибке
    }
}

// Функция для получения списка файлов из корня
async function getFilesFromRoot() {
    try {
        console.log("Получение списка файлов из корня...");
        const items = await fs.readdir(materialsPath);
        const files = items.filter((item) => item.endsWith(".docx"));
        console.log("Список файлов:", files);
        return files;
    } catch (err) {
        console.error("Ошибка при получении списка файлов:", err);
        return [];
    }
}

// Расширенная функция для извлечения ключевых фраз из текста
function extractKeyPhrases(text) {
    // Удаляем стоп-слова и знаки препинания
    const stopWords = new Set([
        "и",
        "в",
        "во",
        "не",
        "что",
        "он",
        "на",
        "я",
        "с",
        "со",
        "как",
        "а",
        "то",
        "все",
        "она",
        "так",
        "его",
        "но",
        "да",
        "ты",
        "к",
        "у",
        "же",
        "вы",
        "за",
        "бы",
        "по",
        "только",
        "ее",
        "мне",
        "было",
        "вот",
        "от",
        "меня",
        "еще",
        "нет",
        "о",
        "из",
        "ему",
        "для",
        "при",
        "до",
        "или",
        "если",
        "когда",
        "где",
        "это",
        "этот",
        "эта",
        "эти",
        "того",
        "тем",
        "тех",
        "том",
        "также",
        "их",
        "чтобы",
        "может",
        "быть",
        "был",
        "была",
        "были",
        "есть",
        "будет",
        "уже",
        "даже",
        "более",
        "менее",
        "просто",
        "всего",
        "всех",
        "всем",
        "всю",
        "весь",
        "вся",
        "очень",
        "можно",
        "нужно",
        "надо",
        "один",
        "одна",
        "одно",
        "одни",
        "два",
        "две",
        "три",
        "четыре",
        "пять",
    ]);

    // Разбиваем текст на предложения
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);

    // Находим часто встречающиеся слова и их контекст
    const wordFreq = {};
    const wordContext = {};
    const wordSentences = {};
    const cooccurrenceMatrix = {};

    // Окно контекста
    const windowSize = 5;

    // Обрабатываем каждое предложение
    sentences.forEach((sentence, sentenceIndex) => {
        // Очищаем предложение от знаков препинания и разбиваем на слова
        const words = sentence
            .toLowerCase()
            .replace(/[.,!?;:()]/g, "")
            .split(" ")
            .filter((word) => word.length > 3 && !stopWords.has(word));

        // Собираем статистику
        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Увеличиваем частоту слова
            wordFreq[word] = (wordFreq[word] || 0) + 1;

            // Сохраняем предложения, в которых встречается слово
            if (!wordSentences[word]) {
                wordSentences[word] = new Set();
            }
            wordSentences[word].add(sentenceIndex);

            // Собираем контекст слова
            if (!wordContext[word]) {
                wordContext[word] = new Set();
            }

            // Добавляем слова из окна контекста
            for (
                let j = Math.max(0, i - windowSize);
                j < Math.min(words.length, i + windowSize);
                j++
            ) {
                if (i !== j) {
                    const contextWord = words[j];
                    wordContext[word].add(contextWord);

                    // Заполняем матрицу совместной встречаемости
                    if (!cooccurrenceMatrix[word]) {
                        cooccurrenceMatrix[word] = {};
                    }
                    cooccurrenceMatrix[word][contextWord] =
                        (cooccurrenceMatrix[word][contextWord] || 0) + 1;
                }
            }
        }
    });

    // Находим потенциальные термины (существительные)
    const potentialTerms = Object.keys(wordFreq).filter((word) => {
        // Эвристика: термины обычно имеют разнообразный контекст и не слишком частые
        return (
            wordContext[word]?.size > 3 && wordFreq[word] > 1 && wordFreq[word] < 20
        );
    });

    // Находим потенциальные связи между концепциями
    const conceptRelations = [];
    for (const term1 of potentialTerms) {
        for (const term2 of potentialTerms) {
            if (term1 !== term2) {
                // Проверяем, встречаются ли термины в одних и тех же предложениях
                const commonSentences = [...(wordSentences[term1] || [])].filter((s) =>
                    wordSentences[term2]?.has(s)
                );

                if (commonSentences.length > 0) {
                    // Вычисляем силу связи
                    const relationStrength =
                        (cooccurrenceMatrix[term1]?.[term2] || 0) +
                        (cooccurrenceMatrix[term2]?.[term1] || 0);

                    if (relationStrength > 0) {
                        conceptRelations.push({
                            concepts: [term1, term2],
                            strength: relationStrength,
                            sentences: commonSentences,
                        });
                    }
                }
            }
        }
    }

    // Сортируем связи по силе
    conceptRelations.sort((a, b) => b.strength - a.strength);

    // Вычисляем важность слов на основе частоты, разнообразия контекста и связей
    const wordImportance = {};
    for (const word in wordFreq) {
        // Базовая важность: частота * разнообразие контекста
        const contextSize = wordContext[word]?.size || 0;
        const sentenceCount = wordSentences[word]?.size || 0;

        // Формула важности: учитываем частоту, разнообразие контекста и количество предложений
        wordImportance[word] =
            (wordFreq[word] * contextSize * Math.sqrt(sentenceCount)) /
            (wordFreq[word] + 5); // Штраф для слишком частых слов
    }

    // Возвращаем топ слов с их контекстом и связями
    const topKeyPhrases = Object.entries(wordImportance)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word]) => ({
            word,
            importance: wordImportance[word],
            context: Array.from(wordContext[word] || []),
            sentences: Array.from(wordSentences[word] || []),
        }));

    return {
        keyPhrases: topKeyPhrases,
        conceptRelations: conceptRelations.slice(0, 10),
        sentences,
    };
}

// Функция для создания правдоподобных неправильных ответов
function generateDistractors(answer, textAnalysis, count = 3) {
    const { keyPhrases, conceptRelations } = textAnalysis;
    const answerLower = answer.toLowerCase();
    const distractors = new Set();

    // Стратегия 1: Используем слова из того же контекста
    const answerPhrase = keyPhrases.find((p) => p.word === answerLower);
    if (answerPhrase) {
        // Сортируем контекстные слова по важности
        const contextWords = answerPhrase.context
            .filter((word) => word !== answerLower && word.length > 3)
            .map((word) => {
                const phraseData = keyPhrases.find((p) => p.word === word);
                return {
                    word,
                    importance: phraseData ? phraseData.importance : 0,
                };
            })
            .sort((a, b) => b.importance - a.importance);

        // Добавляем топ контекстных слов
        contextWords
            .slice(0, Math.min(count, contextWords.length))
            .forEach((item) => {
                distractors.add(item.word);
            });
    }

    // Стратегия 2: Используем связанные концепции
    const relatedConcepts = conceptRelations
        .filter((relation) => relation.concepts.includes(answerLower))
        .map((relation) => relation.concepts.find((c) => c !== answerLower))
        .filter((concept) => concept && concept !== answerLower);

    relatedConcepts.forEach((concept) => {
        if (distractors.size < count) {
            distractors.add(concept);
        }
    });

    // Стратегия 3: Используем другие ключевые фразы с похожей важностью
    if (distractors.size < count) {
        const answerImportance = answerPhrase ? answerPhrase.importance : 0;

        keyPhrases
            .filter(
                (phrase) =>
                    phrase.word !== answerLower &&
                    !distractors.has(phrase.word) &&
                    Math.abs(phrase.importance - answerImportance) / answerImportance <
                    0.5 // Похожая важность
            )
            .slice(0, count - distractors.size)
            .forEach((phrase) => distractors.add(phrase.word));
    }

    // Если все еще не хватает дистракторов, добавляем случайные ключевые фразы
    if (distractors.size < count) {
        keyPhrases
            .filter(
                (phrase) => phrase.word !== answerLower && !distractors.has(phrase.word)
            )
            .sort(() => Math.random() - 0.5)
            .slice(0, count - distractors.size)
            .forEach((phrase) => distractors.add(phrase.word));
    }

    // Преобразуем в массив и форматируем
    return Array.from(distractors)
        .slice(0, count)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
}

// Функция для создания разных типов вопросов
function createQuestions(textAnalysis, count = 5) {
    const { keyPhrases, conceptRelations, sentences } = textAnalysis;
    const questions = [];

    // Тип 1: Вопросы на заполнение пропусков
    function createFillInBlankQuestion() {
        // Выбираем случайное предложение с ключевыми словами
        const keyPhrasesWithSentences = keyPhrases.filter(
            (p) => p.sentences.length > 0
        );
        if (keyPhrasesWithSentences.length === 0) return null;

        const randomPhrase =
            keyPhrasesWithSentences[
            Math.floor(Math.random() * keyPhrasesWithSentences.length)
            ];
        const sentenceIndex =
            randomPhrase.sentences[
            Math.floor(Math.random() * randomPhrase.sentences.length)
            ];
        const sentence = sentences[sentenceIndex];

        // Находим ключевое слово в предложении
        const words = sentence.split(" ");
        const wordLower = randomPhrase.word.toLowerCase();
        const wordIndex = words.findIndex((w) =>
            w.toLowerCase().includes(wordLower)
        );

        if (wordIndex === -1) return null;

        // Создаем вопрос с пропуском
        const answer = words[wordIndex].replace(/[.,!?;:()]/, "");
        const question = sentence.replace(words[wordIndex], "_________");

        // Генерируем дистракторы
        const distractors = generateDistractors(answer, textAnalysis);

        // Перемешиваем варианты ответов
        const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
        const correctIndex = options.indexOf(answer);

        return {
            type: "fill-in-blank",
            question,
            options,
            correctAnswer: String.fromCharCode(97 + correctIndex),
        };
    }

    // Тип 2: Вопросы на определение терминов
    function createDefinitionQuestion() {
        // Выбираем случайную ключевую фразу с высокой важностью
        const importantPhrases = keyPhrases
            .filter((p) => p.importance > 5 && p.sentences.length > 0)
            .sort((a, b) => b.importance - a.importance);

        if (importantPhrases.length === 0) return null;

        const randomPhrase =
            importantPhrases[
            Math.floor(Math.random() * Math.min(5, importantPhrases.length))
            ];
        const sentenceIndex =
            randomPhrase.sentences[
            Math.floor(Math.random() * randomPhrase.sentences.length)
            ];
        const sentence = sentences[sentenceIndex];

        // Создаем вопрос о термине
        const term =
            randomPhrase.word.charAt(0).toUpperCase() + randomPhrase.word.slice(1);
        const question = `Какое определение лучше всего описывает термин "${term}" в контексте данного материала?`;

        // Правильный ответ - предложение с термином
        const answer = sentence.trim();

        // Генерируем дистракторы - другие предложения с похожими терминами
        const distractors = [];

        // Находим похожие термины
        const similarTerms = keyPhrases
            .filter((p) => p.word !== randomPhrase.word && p.sentences.length > 0)
            .sort((a, b) => {
                // Сортируем по количеству общих контекстных слов
                const commonWordsA = a.context.filter((w) =>
                    randomPhrase.context.includes(w)
                ).length;
                const commonWordsB = b.context.filter((w) =>
                    randomPhrase.context.includes(w)
                ).length;
                return commonWordsB - commonWordsA;
            });

        // Добавляем предложения с похожими терминами
        for (const term of similarTerms) {
            if (distractors.length >= 3) break;

            const termSentenceIndex =
                term.sentences[Math.floor(Math.random() * term.sentences.length)];
            const termSentence = sentences[termSentenceIndex].trim();

            if (
                termSentence !== answer &&
                termSentence.length > 20 &&
                !distractors.includes(termSentence)
            ) {
                distractors.push(termSentence);
            }
        }

        // Если не хватает дистракторов, добавляем случайные предложения
        while (distractors.length < 3) {
            const randomSentenceIndex = Math.floor(Math.random() * sentences.length);
            const randomSentence = sentences[randomSentenceIndex].trim();

            if (
                randomSentence !== answer &&
                randomSentence.length > 20 &&
                !distractors.includes(randomSentence)
            ) {
                distractors.push(randomSentence);
            }
        }

        // Перемешиваем варианты ответов
        const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
        const correctIndex = options.indexOf(answer);

        return {
            type: "definition",
            question,
            options,
            correctAnswer: String.fromCharCode(97 + correctIndex),
        };
    }

    // Тип 3: Вопросы на связи между концепциями
    function createRelationQuestion() {
        if (conceptRelations.length === 0) return null;

        // Выбираем случайную сильную связь
        const relation =
            conceptRelations[
            Math.floor(Math.random() * Math.min(3, conceptRelations.length))
            ];
        const [concept1, concept2] = relation.concepts;

        // Находим предложение, которое описывает связь
        const sentenceIndex =
            relation.sentences[Math.floor(Math.random() * relation.sentences.length)];
        const sentence = sentences[sentenceIndex];

        // Создаем вопрос о связи
        const formattedConcept1 =
            concept1.charAt(0).toUpperCase() + concept1.slice(1);
        const formattedConcept2 =
            concept2.charAt(0).toUpperCase() + concept2.slice(1);
        const question = `Как связаны между собой "${formattedConcept1}" и "${formattedConcept2}" согласно тексту?`;

        // Правильный ответ - предложение со связью
        const answer = sentence.trim();

        // Генерируем дистракторы - предложения с другими связями или модифицированные
        const distractors = [];

        // Находим другие связи
        const otherRelations = conceptRelations
            .filter((r) => r !== relation && r.sentences.length > 0)
            .sort(() => Math.random() - 0.5);

        // Добавляем предложения с другими связями
        for (const otherRelation of otherRelations) {
            if (distractors.length >= 3) break;

            const otherSentenceIndex =
                otherRelation.sentences[
                Math.floor(Math.random() * otherRelation.sentences.length)
                ];
            const otherSentence = sentences[otherSentenceIndex].trim();

            if (
                otherSentence !== answer &&
                otherSentence.length > 20 &&
                !distractors.includes(otherSentence)
            ) {
                distractors.push(otherSentence);
            }
        }

        // Если не хватает дистракторов, добавляем модифицированные версии правильного ответа
        if (distractors.length < 3) {
            // Создаем отрицание правильного ответа
            const negation = answer
                .replace(/является|есть|представляет собой/, "не является")
                .replace(/имеет|содержит/, "не имеет")
                .replace(/может|способен/, "не может");

            if (negation !== answer && !distractors.includes(negation)) {
                distractors.push(negation);
            }
        }

        // Если все еще не хватает, добавляем случайные предложения
        while (distractors.length < 3) {
            const randomSentenceIndex = Math.floor(Math.random() * sentences.length);
            const randomSentence = sentences[randomSentenceIndex].trim();

            if (
                randomSentence !== answer &&
                randomSentence.length > 20 &&
                !distractors.includes(randomSentence)
            ) {
                distractors.push(randomSentence);
            }
        }

        // Перемешиваем варианты ответов
        const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
        const correctIndex = options.indexOf(answer);

        return {
            type: "relation",
            question,
            options,
            correctAnswer: String.fromCharCode(97 + correctIndex),
        };
    }

    // Тип 4: Вопросы на понимание смысла
    function createComprehensionQuestion() {
        // Выбираем случайное предложение с ключевыми словами
        const importantSentences = [];

        keyPhrases.forEach((phrase) => {
            phrase.sentences.forEach((sentenceIndex) => {
                if (!importantSentences.includes(sentenceIndex)) {
                    importantSentences.push(sentenceIndex);
                }
            });
        });

        if (importantSentences.length === 0) return null;

        const sentenceIndex =
            importantSentences[Math.floor(Math.random() * importantSentences.length)];
        const sentence = sentences[sentenceIndex];

        // Создаем вопрос о смысле предложения
        const question = `Какое из следующих утверждений наиболее точно отражает смысл данного фрагмента: "${sentence.trim()}"?`;

        // Правильный ответ - перефразированное предложение
        const answer = sentence.trim();

        // Генерируем дистракторы - другие предложения или модифицированные версии
        const distractors = [];

        // Добавляем другие предложения
        const otherSentences = sentences
            .filter((s, i) => i !== sentenceIndex && s.length > 20)
            .sort(() => Math.random() - 0.5);

        for (let i = 0; Math.min(3, otherSentences.length); i++) {
            distractors.push(otherSentences[i].trim());
        }

        // Если не хватает дистракторов, добавляем модифицированные версии
        while (distractors.length < 3) {
            // Создаем искаженную версию правильного ответа
            const words = answer.split(" ");
            const randomIndex = Math.floor(Math.random() * words.length);
            words[randomIndex] =
                keyPhrases[Math.floor(Math.random() * keyPhrases.length)].word;
            const distorted = words.join(" ");

            if (distorted !== answer && !distractors.includes(distorted)) {
                distractors.push(distorted);
            }
        }

        // Перемешиваем варианты ответов
        const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
        const correctIndex = options.indexOf(answer);

        return {
            type: "comprehension",
            question,
            options,
            correctAnswer: String.fromCharCode(97 + correctIndex),
        };
    }

    // Генерируем вопросы разных типов
    const questionGenerators = [
        { generator: createFillInBlankQuestion, weight: 0.25 },
        { generator: createDefinitionQuestion, weight: 0.25 },
        { generator: createRelationQuestion, weight: 0.25 },
        { generator: createComprehensionQuestion, weight: 0.25 },
    ];

    // Распределяем количество вопросов по типам
    const questionCounts = {};
    let remainingCount = count;

    // Сначала распределяем минимум по одному вопросу каждого типа
    questionGenerators.forEach((generator, index) => {
        questionCounts[index] = 1;
        remainingCount--;
    });

    // Затем распределяем оставшиеся вопросы по весам
    while (remainingCount > 0) {
        const totalWeight = questionGenerators.reduce(
            (sum, gen, i) => sum + gen.weight,
            0
        );
        const random = Math.random() * totalWeight;

        let cumulativeWeight = 0;
        for (let i = 0; i < questionGenerators.length; i++) {
            cumulativeWeight += questionGenerators[i].weight;
            if (random <= cumulativeWeight) {
                questionCounts[i]++;
                break;
            }
        }

        remainingCount--;
    }

    // Генерируем вопросы каждого типа
    for (let i = 0; i < questionGenerators.length; i++) {
        const generator = questionGenerators[i].generator;
        let attempts = 0;
        const maxAttempts = 10;

        while (
            questions.filter((q) => q.type === generator().type).length <
            questionCounts[i] &&
            attempts < maxAttempts
        ) {
            const question = generator();
            if (
                question &&
                !questions.some((q) => q.question === question.question)
            ) {
                questions.push(question);
            }
            attempts++;
        }
    }

    // Если не удалось сгенерировать достаточно вопросов, добавляем вопросы любого типа
    while (questions.length < count) {
        const generators = [
            createFillInBlankQuestion,
            createDefinitionQuestion,
            createRelationQuestion,
            createComprehensionQuestion,
        ];
        const randomGenerator =
            generators[Math.floor(Math.random() * generators.length)];

        const question = randomGenerator();
        if (question && !questions.some((q) => q.question === question.question)) {
            questions.push(question);
        }
    }

    return questions;
}

// Функция для оценки качества вопросов
function evaluateQuestions(questions) {
    // Проверяем разнообразие типов вопросов
    const typeCount = {};
    questions.forEach((q) => {
        typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    });

    const typeVariety = Object.keys(typeCount).length;

    // Проверяем уникальность вопросов
    const uniqueQuestions = new Set(questions.map((q) => q.question)).size;

    // Проверяем длину вопросов и ответов
    const questionLengths = questions.map((q) => q.question.length);
    const optionLengths = questions.flatMap((q) =>
        q.options.map((o) => o.length)
    );

    const avgQuestionLength =
        questionLengths.reduce((sum, len) => sum + len, 0) / questionLengths.length;
    const avgOptionLength =
        optionLengths.reduce((sum, len) => sum + len, 0) / optionLengths.length;

    // Оцениваем качество по разным параметрам
    const score = {
        typeVariety: Math.min(typeVariety / 4, 1), // Максимум 4 типа
        uniqueness: uniqueQuestions / questions.length,
        questionLength: Math.min(avgQuestionLength / 50, 1), // Идеальная длина ~50 символов
        optionLength: Math.min(avgOptionLength / 30, 1), // Идеальная длина ~30 символов
    };

    // Общая оценка
    score.total =
        (score.typeVariety +
            score.uniqueness +
            score.questionLength +
            score.optionLength) /
        4;

    return score;
}

// Функция инициализации GPT4All модели
async function initGPT4AllModel() {
    try {
        console.log("Инициализация GPT4All модели...");

        // Создаем экземпляр модели через LLModel, передаем путь к файлу модели
        const model = new gpt4all.LLModel(finalModelPath);

        // Генерируем текст с параметрами
        await model.init({
            temp: 0.1,
            topK: 40,
            topP: 0.9,
            repeatPenalty: 1.18,
            repeatLastN: 10,
            nBatch: 100
        });

        console.log("GPT4All модель успешно инициализирована");
        return model;
    } catch (error) {
        console.error("Ошибка при инициализации GPT4All:", error);
        return null;
    }
}

// Глобальная переменная для хранения модели
let gpt4allModel = null;

// Функция для генерации вопросов через AI
async function generateAIQuestions(text, count = 5) {
    try {
        console.log("Начинаем генерацию вопросов через AI...");

        if (!gpt4allModel) {
            gpt4allModel = await initGPT4AllModel();
        }

        if (!gpt4allModel) {
            throw new Error("Модель GPT4All не инициализирована.");
        }

        // Формируем запрос
        const prompt = `Создай ${count} вопросов с вариантами ответов на основе этого текста. Каждый вопрос должен иметь 4 варианта ответа, где только один правильный. Текст: ${text}`;

        // Генерируем текст
        const response = await gpt4allModel.generate(prompt, {
            temp: 0.1,
            topK: 40,
            topP: 0.9,
            repeatPenalty: 1.18,
            repeatLastN: 10,
            nBatch: 100
        });

        console.log("Ответ от модели:", response);

        // Парсим вопросы из ответа
        const questions = parseAIResponse(response);
        return questions;
    } catch (err) {
        console.error("Ошибка при генерации вопросов через AI:", err);
        return null;
    }
}

// Функция для парсинга ответа AI
function parseAIResponse(response) {
    const questions = [];
    const parts = response.split("\nQ");

    for (let part of parts) {
        if (!part.trim()) continue;

        try {
            // Если часть не начинается с номера, добавляем Q
            if (!part.startsWith("1:")) {
                part = "1:" + part;
            }

            const [questionPart, ...optionsParts] = part.split("\n");
            const question = questionPart.split(":")[1].trim();

            const options = [];
            let correctAnswer = "";

            for (const line of optionsParts) {
                if (line.startsWith("Правильный ответ:")) {
                    correctAnswer = line.split(":")[1].trim();
                } else if (line.match(/^[A-D]\)/)) {
                    options.push(line.substring(2).trim());
                }
            }

            if (question && options.length === 4 && correctAnswer) {
                questions.push({
                    type: "ai-generated",
                    question,
                    options,
                    correctAnswer,
                });
            }
        } catch (err) {
            console.error("Ошибка при парсинге вопроса:", err);
        }
    }

    return questions;
}

// Улучшенная функция для генерации теста
async function generateSmartTest(material) {
    // Анализируем текст
    const textAnalysis = extractKeyPhrases(material);

    // Пробуем сначала сгенерировать через AI
    const aiQuestions = await generateAIQuestions(material, 5);

    if (aiQuestions && aiQuestions.length >= 5) {
        return formatTest(aiQuestions);
    }

    // Если AI не справился, используем старый метод
    console.log("Fallback на алгоритмическую генерацию...");
    let questions = createQuestions(textAnalysis, 5);

    // Оцениваем качество вопросов
    const score = evaluateQuestions(questions);

    // Если качество низкое, пробуем еще раз с другими параметрами
    if (score.total < 0.6) {
        const newQuestions = createQuestions(textAnalysis, 5);
        const newScore = evaluateQuestions(newQuestions);

        if (newScore.total > score.total) {
            questions = newQuestions;
        }
    }

    // Форматируем тест
    let test = "Тест по материалу:\n\n";

    questions.forEach((q, idx) => {
        test += `${idx + 1}. ${q.question}\n`;
        q.options.forEach((opt, i) => {
            test += `${String.fromCharCode(97 + i)}) ${opt}\n`;
        });
        test += `Правильный ответ: ${q.correctAnswer}\n\n`;
    });

    return test;
}

// Маршрут для отображения статьи
app.get("/article/:fileName", async (req, res) => {
    const { fileName } = req.params;

    console.log(`Запрос на статью: fileName=${fileName}`);

    // Формируем путь к файлу
    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return res.status(404).send("Файл не найден");
    }

    try {
        const htmlContent = await parseDocxToHtml(filePath); // Парсим файл в HTML
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${fileName}</title>
                <link rel="stylesheet" href="/static/styles.css">
            </head>
            <body>
                <div class="container">
                    <div class="article">
                        ${htmlContent} <!-- Вставляем HTML-контент -->
                    </div>
                    <button class="close-btn" onclick="Telegram.WebApp.close()">Закрыть</button>
                </div>
                <script src="https://telegram.org/js/telegram-web-app.js"></script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(`Ошибка при обработке файла ${filePath}:`, err);
        res.status(500).send("Ошибка при обработке файла");
    }
});

// Команда /start для приветствия и отображения кнопок
bot.start(async (ctx) => {
    console.log("Команда /start вызвана");
    await ctx.reply(
        "Добро пожаловать! Этот бот поможет вам просматривать материалы.",
        Markup.inlineKeyboard([
            Markup.button.callback("📂 Просмотреть материалы", "open_materials"),
            Markup.button.callback("📝 Сгенерировать тест", "generate_test"),
        ])
    );
});

// Обработка кнопки "Просмотреть материалы"
bot.action("open_materials", async (ctx) => {
    console.log('Обработчик "open_materials" вызван');
    const files = await getFilesFromRoot();

    if (files.length === 0) {
        console.log("Нет доступных файлов");
        return ctx.reply("Нет доступных файлов.");
    }

    const buttons = files.map((file) => [
        Markup.button.callback(file, `material:${file}`),
    ]);

    await ctx.reply("Выберите файл:", Markup.inlineKeyboard(buttons));
});

// Обработка выбора файла
bot.action(/^material:(.+)$/, async (ctx) => {
    const fileName = ctx.match[1];
    console.log(`Обработчик файла вызван: fileName=${fileName}`);

    const filePath = path.join(materialsPath, fileName);

    if (!fs.existsSync(filePath)) {
        console.error(`Файл не найден: ${filePath}`);
        return ctx.reply("Файл не найден.");
    }

    const url = `${webAppUrl}/article/${encodeURIComponent(fileName)}`;
    console.log(`Ссылка на файл: ${url}`);

    await ctx.reply(
        `Откройте файл "${fileName}" через Web App:`,
        Markup.inlineKeyboard([
            Markup.button.url("Открыть файл", url),
            Markup.button.callback("🔙 Назад", "open_materials"),
        ])
    );
});

// Обработка кнопки "Сгенерировать тест"
bot.action("generate_test", async (ctx) => {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Operation Timeout")), 60000);
    });

    try {
        await ctx.reply(
            "Генерирую тест на основе материалов, пожалуйста, подождите..."
        );

        await Promise.race([
            (async () => {
                const files = await getFilesFromRoot();
                if (files.length === 0) {
                    throw new Error("Нет доступных материалов для генерации теста.");
                }

                const randomFile = files[Math.floor(Math.random() * files.length)];
                const filePath = path.join(materialsPath, randomFile);

                const result = await parseDocxToText(filePath);
                if (!result) {
                    throw new Error("Не удалось прочитать материал для теста.");
                }

                const test = await generateSmartTest(result);
                await ctx.reply(`Тест создан на основе материала "${randomFile}":\n\n${test}`);
            })(),
            timeoutPromise,
        ]);
    } catch (err) {
        console.error("Ошибка при генерации теста:", err);
        if (err.message === "Operation Timeout") {
            await ctx.reply("Превышено время ожидания. Попробуйте еще раз.");
        } else {
            await ctx.reply("Произошла ошибка при генерации теста. Пожалуйста, попробуйте позже.");
        }
    }
});

// Запуск бота
bot.launch()
    .then(() => console.log("Бот успешно запущен!"))
    .catch((err) => console.error("Ошибка при запуске бота:", err));

// Запуск Express-сервера
app.listen(PORT, () => {
    console.log(`Express-сервер запущен на порту ${PORT}`);
});

