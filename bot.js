// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Список доступных моделей на Groq
const AVAILABLE_MODELS = [
    'llama3-8b-8192',    // Быстрая и сбалансированная
    'llama3-70b-8192',   // Самая мощная
    'mixtral-8x7b-32768', // Большая и с хорошим контекстом
    'gemma-7b-it'        // От Google
];

// --- КЛАССЫ ПРОЕКТА (С ПОДДЕРЖКОЙ НАСТРОЕК) ---

class PromptGenerator {
    createIterationPrompt(topicName, topicDescription, iteration, acceptedSummaries) {
        let prompt = `Topic: ${topicDescription}\n\n`;
        if (iteration === 1) {
            prompt += "This is the first round of discussion. Please provide your initial thoughts on the topic.";
        } else {
            prompt += `This is round ${iteration}. Here are the summaries from previous rounds:\n\n`;
            acceptedSummaries.forEach((summary, index) => {
                prompt += `Summary ${index + 1}: ${summary}\n\n`;
            });
            prompt += "Based on these summaries, please provide your further thoughts or build upon the existing ideas.";
        }
        return prompt;
    }
}

class NetworkManager {
    constructor() {
        // Теперь здесь только имена. Персоны будут в настройках.
        this.networks = {
            network1: { name: 'Аналитик' },
            network2: { name: 'Креативщик' },
            summarizer: { name: 'Синтезатор' }
        };
    }

    // Метод теперь принимает настройки для каждого запроса
    async generateResponse(networkId, prompt, settings) {
        const network = this.networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        // Берем системный промпт из настроек
        const systemPrompt = settings.system_prompts[networkId];

        try {
            const response = await axios.post(
                GROQ_API_URL,
                {
                    model: settings.model, // Используем модель из настроек
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: prompt }
                    ],
                    temperature: settings.temperature, // Используем температуру из настроек
                    max_tokens: settings.max_tokens,   // Используем лимит токенов из настроек
                },
                { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } }
            );
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            console.error(`\n--- ОШИБКА API GROQ для "${network.name}" ---`);
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
                console.error(`Данные: ${JSON.stringify(error.response.data)}`);
            } else {
                console.error(`Сообщение: ${error.message}`);
            }
            throw new Error(`Не удалось получить ответ от "${network.name}". Проверьте API ключ Groq или выбранную модель.`);
        }
    }
}

class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback;
        this.networkManager = new NetworkManager();
        this.promptGenerator = new PromptGenerator();
        this.resetProject();
        this.initializeSettings();
    }

    initializeSettings() {
        this.settings = {
            model: 'llama3-8b-8192',
            temperature: 0.7,
            max_tokens: 1024,
            system_prompts: {
                network1: 'You are a pragmatic and analytical thinker. You focus on logic, data, and structured reasoning. Provide concise and clear arguments.',
                network2: 'You are a creative and imaginative thinker. You explore unconventional ideas, possibilities, and novel perspectives.',
                summarizer: 'You are a master synthesizer. Your role is to read a discussion and create a concise, neutral summary of the key points.'
            }
        };
    }

    resetProject() {
        this.projectName = '';
        this.projectDescription = '';
        this.iterations = 0;
        this.maxIterations = 2;
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) {
            this.sendMessage("Я уже занят обсуждением. Используйте /reset для сброса.");
            return;
        }

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;
        this.projectName = topic.length > 50 ? topic.substring(0, 50) + '...' : topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${this.projectName}"`);

        try {
            await this.runDiscussionLoop();
            await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            this.sendMessage(`❗️*Произошла ошибка:* ${error.message}`);
        } finally {
            this.isWorking = false;
        }
    }

    async runDiscussionLoop() {
        while (this.iterations < this.maxIterations) {
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.maxIterations}* ---\n`);
            
            const prompt = this.promptGenerator.createIterationPrompt(
                this.projectName, this.projectDescription, this.iterations, this.acceptedSummaries
            );

            let currentDiscussion = prompt;
            const networkIds = ['network1', 'network2'];

            for (const networkId of networkIds) {
                const networkName = this.networkManager.networks[networkId].name;
                this.sendMessage(`🤔 _${networkName} думает..._`);
                // Передаем текущие настройки в NetworkManager
                const response = await this.networkManager.generateResponse(networkId, currentDiscussion, this.settings);
                this.sendMessage(`*${networkName}:*\n${response}`);
                currentDiscussion += `\n\n**${networkName}'s input:**\n${response}`;
            }

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summary = await this.networkManager.generateResponse('summarizer', currentDiscussion, this.settings);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            this.acceptedSummaries.push(summary);
        }
    }

    async finalizeDevelopment() {
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following summaries, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings);
        this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

// --- ЛОГИКА ТЕЛЕГРАМ БОТА ---

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN или GROQ_API_KEY не найдены в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};

// --- НОВОЕ: УСТАНОВКА МЕНЮ КОМАНД ---
// Этот код выполнится один раз при запуске бота и установит меню для всех пользователей.
bot.setMyCommands([
    { command: '/start', description: '🚀 Перезапустить бота / Помощь' },
    { command: '/discuss', description: '💬 Начать новое обсуждение' },
    { command: '/settings', description: '⚙️ Показать текущие настройки' },
    { command: '/reset', description: '🗑 Сбросить текущее обсуждение' },
]);

// Вспомогательная функция для получения или создания сессии
function getOrCreateSession(chatId) {
    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => {
            bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
               .catch(() => bot.sendMessage(chatId, text));
        });
    }
    return chatSessions[chatId];
}

console.log('Бот успешно запущен и готов к работе!');

// --- НОВОЕ: УЛУЧШЕННОЕ ПРИВЕТСТВЕННОЕ СООБЩЕНИЕ ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeText = `
*Добро пожаловать!*

Я бот, в котором разные AI-личности (Аналитик и Креативщик) могут совместно обсуждать заданную вами тему.

*Как начать:*
1. Нажмите на кнопку **Меню** (слева от поля ввода текста).
2. Выберите команду \`/discuss\`.
3. Напишите вашу тему после команды и отправьте сообщение.

*Пример:*
\`/discuss Плюсы и минусы удаленной работы\`

Вы также можете настроить AI, используя команду \`/settings\`.
    `;
    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
});


bot.onText(/\/discuss (.+)/, (msg, match) => {
    const session = getOrCreateSession(msg.chat.id);
    session.startCollaboration(match[1]);
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены. Готов к новой теме!");
});

// --- КОМАНДЫ ДЛЯ НАСТРОЕК ---

bot.onText(/\/settings/, (msg) => {
    const session = getOrCreateSession(msg.chat.id);
    const s = session.settings;
    const p = s.system_prompts;

    const settingsText = `
*Текущие настройки для этого чата:*

*Модель:* \`${s.model}\`
*Температура:* \`${s.temperature}\`
*Макс. токенов:* \`${s.max_tokens}\`

*Системные промпты:*
- *Аналитик:* \`${p.network1.substring(0, 50)}...\`
- *Креативщик:* \`${p.network2.substring(0, 50)}...\`
- *Синтезатор:* \`${p.summarizer.substring(0, 50)}...\`

*Как изменить:*
- \`/set_model <имя>\`
  _Доступные: ${AVAILABLE_MODELS.join(', ')}_
- \`/set_temp <0.0-2.0>\`
- \`/set_tokens <число>\`
- \`/set_prompt <имя_сети> <текст>\`
  _Имена сетей: \`аналитик\`, \`креативщик\`, \`синтезатор\`_
  _Пример: \`/set_prompt аналитик Ты Шерлок Холмс\`_
    `;
    bot.sendMessage(msg.chat.id, settingsText, { parse_mode: 'Markdown' });
});

bot.onText(/\/set_model (.+)/, (msg, match) => {
    const model = match[1].trim();
    if (AVAILABLE_MODELS.includes(model)) {
        const session = getOrCreateSession(msg.chat.id);
        session.settings.model = model;
        bot.sendMessage(msg.chat.id, `✅ Модель обновлена на: \`${model}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, `❌ Неверная модель. Доступные модели: \`${AVAILABLE_MODELS.join(', ')}\``, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/set_temp (.+)/, (msg, match) => {
    const temp = parseFloat(match[1]);
    if (!isNaN(temp) && temp >= 0.0 && temp <= 2.0) {
        const session = getOrCreateSession(msg.chat.id);
        session.settings.temperature = temp;
        bot.sendMessage(msg.chat.id, `✅ Температура установлена на: \`${temp}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Укажите число от 0.0 до 2.0.');
    }
});

bot.onText(/\/set_tokens (.+)/, (msg, match) => {
    const tokens = parseInt(match[1], 10);
    if (!isNaN(tokens) && tokens > 0 && tokens <= 8192) {
        const session = getOrCreateSession(msg.chat.id);
        session.settings.max_tokens = tokens;
        bot.sendMessage(msg.chat.id, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Укажите целое число от 1 до 8192.');
    }
});

bot.onText(/\/set_prompt (\w+) (.+)/s, (msg, match) => {
    const networkName = match[1].toLowerCase();
    const promptText = match[2];
    
    const networkMap = {
        'аналитик': 'network1',
        'креативщик': 'network2',
        'синтезатор': 'summarizer'
    };

    const networkId = networkMap[networkName];

    if (networkId) {
        const session = getOrCreateSession(msg.chat.id);
        session.settings.system_prompts[networkId] = promptText;
        bot.sendMessage(msg.chat.id, `✅ Системный промпт для "${networkName}" обновлен.`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ Неверное имя сети. Используйте: \`аналитик\`, \`креативщик\` или \`синтезатор\`.`);
    }
});


bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));
