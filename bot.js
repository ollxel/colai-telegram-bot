// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Список доступных моделей на Groq
const AVAILABLE_MODELS = ['llama3-8b-8192', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma-7b-it'];

// --- КЛАССЫ ПРОЕКТА ---

class PromptGenerator {
    createIterationPrompt(topicDescription, iteration, acceptedSummaries) {
        let prompt = `The main topic of discussion is: "${topicDescription}"\n\n`;
        if (iteration === 1) {
            prompt += "This is the first round. Please provide your initial thoughts on the topic from your unique perspective.";
        } else {
            prompt += `This is round ${iteration}. Here are the accepted summaries from previous rounds:\n\n`;
            acceptedSummaries.forEach((summary, index) => {
                prompt += `--- Accepted Summary ${index + 1} ---\n${summary}\n\n`;
            });
            prompt += "Based on these summaries, please provide your further thoughts or build upon the existing ideas.";
        }
        return prompt;
    }
}

class NetworkManager {
    constructor() {
        this.networks = {
            network1: { name: 'Analytical Network', short_name: 'analytical' },
            network2: { name: 'Creative Network', short_name: 'creative' },
            network3: { name: 'Implementation Network', short_name: 'implementation' },
            network4: { name: 'Data Science Network', short_name: 'data' },
            network5: { name: 'Ethical Network', short_name: 'ethical' },
            network6: { name: 'User Experience Network', short_name: 'ux' },
            network7: { name: 'Systems Thinking Network', short_name: 'systems' },
            network8: { name: 'Devil\'s Advocate Network', short_name: 'advocate' },
            summarizer: { name: 'Synthesizer Network', short_name: 'synthesizer' }
        };
    }

    async generateResponse(networkId, prompt, settings) {
        const network = this.networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        let systemPrompt = settings.system_prompts[networkId];
        // Добавляем инструкцию по языку в каждый запрос
        systemPrompt += `\n\nIMPORTANT INSTRUCTION: You MUST respond ONLY in ${settings.discussion_language}. Do not use any other language.`;

        try {
            const response = await axios.post(
                GROQ_API_URL,
                {
                    model: settings.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: prompt }
                    ],
                    temperature: settings.temperature,
                    max_tokens: settings.max_tokens,
                },
                { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } }
            );
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            console.error(`\n--- ОШИБКА API GROQ для "${network.name}" ---`);
            if (error.response) {
                console.error(`Статус: ${error.response.status}, Данные: ${JSON.stringify(error.response.data)}`);
            } else {
                console.error(`Сообщение: ${error.message}`);
            }
            throw new Error(`Не удалось получить ответ от "${network.name}".`);
        }
    }
}

class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback;
        this.networkManager = new NetworkManager();
        this.promptGenerator = new PromptGenerator();
        this.initializeSettings();
        this.resetProject();
    }

    initializeSettings() {
        this.settings = {
            model: 'llama3-8b-8192',
            temperature: 0.7,
            max_tokens: 1024,
            discussion_language: 'Russian',
            enabled_networks: ['network1', 'network2'], // По умолчанию включены только две
            system_prompts: {
                network1: 'You are an Analytical Network. Focus on logic, data, and structured reasoning.',
                network2: 'You are a Creative Network. Focus on novel ideas, alternatives, and innovative perspectives.',
                network3: 'You are an Implementation Network. Focus on practical application and technical feasibility.',
                network4: 'You are a Data Science Network. Focus on statistics, patterns, and empirical evidence.',
                network5: 'You are an Ethical Network. Focus on moral implications and societal impact.',
                network6: 'You are a User Experience Network. Focus on user-centered design and usability.',
                network7: 'You are a Systems Thinking Network. Focus on holistic views and interconnections.',
                network8: 'You are a Devil\'s Advocate Network. Your role is to challenge assumptions and stress-test ideas.',
                summarizer: 'You are a Synthesizer Network. Your role is to read a discussion and create a concise, neutral summary of the key points.'
            }
        };
    }

    resetProject() {
        this.iterations = 0;
        this.maxIterations = 2;
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) {
            this.sendMessage("Обсуждение уже идет. Используйте /reset для сброса.");
            return;
        }
        if (this.settings.enabled_networks.length < 2) {
            this.sendMessage("❗️*Ошибка:* Для начала обсуждения нужно включить как минимум две нейросети. Используйте команду `/toggle`.");
            return;
        }

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${topic}"`);

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
            
            const prompt = this.promptGenerator.createIterationPrompt(this.projectDescription, this.iterations, this.acceptedSummaries);
            let currentDiscussion = prompt;

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, currentDiscussion, this.settings);
                this.sendMessage(`*${networkName}:*\n${response}`);
                // ВАЖНО: Добавляем ответ в контекст для следующей нейронки
                currentDiscussion += `\n\n**${networkName}'s input:**\n${response}`;
            }

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summary = await this.networkManager.generateResponse('summarizer', currentDiscussion, this.settings);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            // --- НОВОЕ: ГОЛОСОВАНИЕ ---
            this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;
            let rejectionReasons = [];

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                const votePrompt = `Here is the discussion context:\n${currentDiscussion}\n\nHere is the summary to vote on:\n"${summary}"\n\nAs the ${networkName}, do you accept this summary? Respond with only "Accept" or "Reject" followed by a brief reason.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings);
                this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                
                if (voteResponse.toLowerCase().includes('accept')) {
                    votesFor++;
                } else {
                    votesAgainst++;
                    rejectionReasons.push(`- ${networkName}: ${voteResponse.replace(/reject/i, '').trim()}`);
                }
            }

            if (votesAgainst > votesFor) {
                this.sendMessage(`*Голосование провалено* (${votesFor} за, ${votesAgainst} против). Сводка отклонена. Причины:\n${rejectionReasons.join('\n')}`);
            } else {
                this.sendMessage(`*Голосование успешно!* (${votesFor} за, ${votesAgainst} против). Сводка принята.`);
                this.acceptedSummaries.push(summary);
            }
        }
    }

    async finalizeDevelopment() {
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following accepted summaries, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings);
        this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

// --- ЛОГИКА ТЕЛЕГРАМ БОТА ---

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Токены не найдены в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь и информация о боте' },
    { command: '/discuss', description: '💬 Начать новое обсуждение (напр. /discuss тема)' },
    { command: '/settings', description: '⚙️ Показать/изменить настройки' },
    { command: '/toggle', description: '🕹 Включить/выключить нейросеть (напр. /toggle ethical)' },
    { command: '/reset', description: '🗑 Сбросить обсуждение и настройки' },
]);

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

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать!*

Я бот, в котором AI-личности могут совместно обсуждать заданную вами тему.

*Как начать:*
1. Нажмите **Меню** (слева от поля ввода) и выберите \`/discuss\`.
2. Напишите вашу тему после команды и отправьте.
   *Пример:* \`/discuss Плюсы и минусы удаленной работы\`

*Основные команды:*
- \`/settings\` - Посмотреть и настроить модель, температуру, язык и промпты.
- \`/toggle <имя>\` - Включить или выключить нейросеть для следующего обсуждения.
- \`/reset\` - Сбросить все к настройкам по умолчанию.
    `;
    bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: 'Markdown' });
});

bot.onText(/\/discuss (.+)/, (msg, match) => {
    getOrCreateSession(msg.chat.id).startCollaboration(match[1]);
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены к значениям по умолчанию.");
});

// --- НОВЫЕ И УЛУЧШЕННЫЕ КОМАНДЫ ДЛЯ НАСТРОЕК ---

bot.onText(/\/settings/, (msg) => {
    const session = getOrCreateSession(msg.chat.id);
    const s = session.settings;
    const nm = session.networkManager;

    const enabledNetworks = s.enabled_networks.map(id => nm.networks[id].name).join(', ');
    
    const settingsText = `
*Текущие настройки для этого чата:*

*Включенные сети:* ${enabledNetworks}
*Язык обсуждения:* \`${s.discussion_language}\`
*Модель:* \`${s.model}\`
*Температура:* \`${s.temperature}\`
*Макс. токенов:* \`${s.max_tokens}\`

*Как изменить:*
- \`/set_lang <язык>\` (напр. \`English\`, \`Russian\`, \`German\`)
- \`/set_model <имя>\`
- \`/set_temp <0.0-2.0>\`
- \`/set_tokens <число>\`
- \`/set_prompt <имя_сети> <текст>\`
  _Имена сетей: ${Object.values(nm.networks).map(n => n.short_name).join(', ')}_
    `;
    bot.sendMessage(msg.chat.id, settingsText, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

bot.onText(/\/toggle (.+)/, (msg, match) => {
    const session = getOrCreateSession(msg.chat.id);
    const networkShortName = match[1].trim().toLowerCase();
    
    const networkEntry = Object.entries(session.networkManager.networks).find(([id, net]) => net.short_name === networkShortName);

    if (!networkEntry) {
        bot.sendMessage(msg.chat.id, `❌ Неверное имя сети. Доступные для /toggle: ${Object.values(session.networkManager.networks).filter(n=>n.short_name !== 'synthesizer').map(n => n.short_name).join(', ')}`);
        return;
    }
    
    const [networkId, network] = networkEntry;
    const enabled = session.settings.enabled_networks;
    
    if (enabled.includes(networkId)) {
        session.settings.enabled_networks = enabled.filter(id => id !== networkId);
        bot.sendMessage(msg.chat.id, `✅ *${network.name}* выключена для следующего обсуждения.`);
    } else {
        enabled.push(networkId);
        bot.sendMessage(msg.chat.id, `✅ *${network.name}* включена для следующего обсуждения.`);
    }
});

bot.onText(/\/set_lang (.+)/, (msg, match) => {
    const lang = match[1].trim();
    getOrCreateSession(msg.chat.id).settings.discussion_language = lang;
    bot.sendMessage(msg.chat.id, `✅ Язык обсуждения установлен на: \`${lang}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/set_model (.+)/, (msg, match) => {
    const model = match[1].trim();
    if (AVAILABLE_MODELS.includes(model)) {
        getOrCreateSession(msg.chat.id).settings.model = model;
        bot.sendMessage(msg.chat.id, `✅ Модель обновлена на: \`${model}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, `❌ Неверная модель. Доступные: \`${AVAILABLE_MODELS.join(', ')}\``, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/set_temp (.+)/, (msg, match) => {
    const temp = parseFloat(match[1]);
    if (!isNaN(temp) && temp >= 0.0 && temp <= 2.0) {
        getOrCreateSession(msg.chat.id).settings.temperature = temp;
        bot.sendMessage(msg.chat.id, `✅ Температура установлена на: \`${temp}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Укажите число от 0.0 до 2.0.');
    }
});

bot.onText(/\/set_tokens (.+)/, (msg, match) => {
    const tokens = parseInt(match[1], 10);
    if (!isNaN(tokens) && tokens > 0 && tokens <= 32768) { // Увеличил лимит для Mixtral
        getOrCreateSession(msg.chat.id).settings.max_tokens = tokens;
        bot.sendMessage(msg.chat.id, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Укажите целое число от 1 до 32768.');
    }
});

bot.onText(/\/set_prompt (\w+) (.+)/s, (msg, match) => {
    const networkShortName = match[1].toLowerCase();
    const promptText = match[2];
    const session = getOrCreateSession(msg.chat.id);
    
    const networkEntry = Object.entries(session.networkManager.networks).find(([id, net]) => net.short_name === networkShortName);

    if (networkEntry) {
        const [networkId, network] = networkEntry;
        session.settings.system_prompts[networkId] = promptText;
        bot.sendMessage(msg.chat.id, `✅ Системный промпт для "${network.name}" обновлен.`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ Неверное имя сети. Используйте одно из: ${Object.values(session.networkManager.networks).map(n => n.short_name).join(', ')}`);
    }
});

bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));
