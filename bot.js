// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PORT = process.env.PORT || 3000;

const AVAILABLE_MODELS = ['llama3-8b-8192', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma-7b-it'];

// --- КЛАССЫ ПРОЕКТА ---

class PromptGenerator {
    createInitialPrompt(topicDescription) {
        return `The main topic of discussion is: "${topicDescription}"\n\nThis is the first round. As the first speaker, please provide your initial thoughts on the topic from your unique perspective.`;
    }

    createContinuationPrompt(topicDescription, fullConversationHistory) {
        return `The main topic of discussion is: "${topicDescription}"\n\nHere is the full conversation history so far:\n\n${fullConversationHistory}\n\n---\n\nBased on the conversation above, please provide your response from your unique perspective. Address the points made by others if relevant.`;
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
        systemPrompt += `\n\nIMPORTANT INSTRUCTION: You MUST respond ONLY in ${settings.discussion_language}. Do not use any other language.`;

        try {
            // Добавляем задержку для предотвращения ошибки 429 Rate Limit
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 секунды задержки

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
                if (error.response.status === 429) {
                    throw new Error(`Слишком много запросов к "${network.name}". Пожалуйста, подождите минуту и попробуйте снова.`);
                }
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
            max_tokens: 768, // Уменьшаем по умолчанию, чтобы не превышать лимиты
            discussion_language: 'Russian',
            enabled_networks: ['network1', 'network2'],
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
            this.sendMessage("❗️*Ошибка:* Для начала обсуждения нужно включить как минимум две нейросети. Используйте меню настроек.");
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
        let fullConversationHistory = "";

        while (this.iterations < this.maxIterations) {
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.maxIterations}* ---\n`);
            
            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                
                // Создаем промпт на основе всей предыдущей истории
                const prompt = fullConversationHistory === ""
                    ? this.promptGenerator.createInitialPrompt(this.projectDescription)
                    : this.promptGenerator.createContinuationPrompt(this.projectDescription, fullConversationHistory);

                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings);
                this.sendMessage(`*${networkName}:*\n${response}`);
                
                // Добавляем ответ в общую историю диалога
                fullConversationHistory += `\n\n**${networkName} said:**\n${response}`;
            }

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summaryPrompt = `Please create a concise summary of the key points from the following discussion:\n\n${fullConversationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                const votePrompt = `Here is the discussion summary to vote on:\n"${summary}"\n\nAs the ${networkName}, do you accept this summary? Respond with only "Accept" or "Reject" and a brief reason.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings);
                this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                
                if (voteResponse.toLowerCase().includes('accept')) {
                    votesFor++;
                } else {
                    votesAgainst++;
                }
            }

            if (votesAgainst > votesFor) {
                this.sendMessage(`*Голосование провалено* (${votesFor} за, ${votesAgainst} против). Сводка отклонена.`);
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
    { command: '/discuss', description: '💬 Начать новое обсуждение' },
    { command: '/settings', description: '⚙️ Показать/изменить настройки' },
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

// --- ОБРАБОТЧИКИ СООБЩЕНИЙ И КНОПОК ---

const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '🚀 Новое Обсуждение' }, { text: '⚙️ Настройки' }],
        ],
        resize_keyboard: true,
    },
};

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать!*

Я бот, в котором AI-личности могут совместно обсуждать заданную вами тему.

*Как начать:*
Нажмите кнопку "🚀 Новое Обсуждение" внизу и следуйте инструкциям.

*Основные возможности:*
- *🚀 Новое Обсуждение:* Запустить диалог нейросетей.
- *⚙️ Настройки:* Управлять участниками диалога, выбирать AI-модели и язык общения.
- \`/reset\`: Сбросить все настройки к значениям по умолчанию.
    `;
    bot.sendMessage(msg.chat.id, welcomeText, { ...MAIN_KEYBOARD, parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды, чтобы они обрабатывались своими onText хендлерами
    if (text.startsWith('/')) return;

    switch (text) {
        case '🚀 Новое Обсуждение':
            bot.sendMessage(chatId, 'Какую тему вы хотите обсудить? Просто напишите ее в чат.').then(() => {
                bot.once('message', (topicMsg) => {
                    if (!topicMsg.text.startsWith('/')) { // Убедимся, что это не команда
                        getOrCreateSession(chatId).startCollaboration(topicMsg.text);
                    }
                });
            });
            break;
        case '⚙️ Настройки':
            sendSettingsMessage(chatId);
            break;
    }
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены к значениям по умолчанию.", MAIN_KEYBOARD);
});

function sendSettingsMessage(chatId) {
    const session = getOrCreateSession(chatId);
    const s = session.settings;
    const nm = session.networkManager;

    const enabledNetworksText = s.enabled_networks.length > 0
        ? s.enabled_networks.map(id => nm.networks[id].name).join(', ')
        : 'Никто не включен';

    const settingsText = `
*Текущие настройки для этого чата:*

*Участники:* ${enabledNetworksText}
*Язык обсуждения:* \`${s.discussion_language}\`
*AI-Модель:* \`${s.model}\`

Нажмите на кнопки ниже, чтобы изменить настройки.
    `;

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🕹 Участники', callback_data: 'menu_toggle' }],
                [{ text: '🤖 AI-Модель', callback_data: 'menu_model' }, { text: '🌍 Язык', callback_data: 'menu_lang' }],
                [{ text: '❌ Закрыть', callback_data: 'close_settings' }]
            ]
        }
    };

    bot.sendMessage(chatId, settingsText, { ...inlineKeyboard, parse_mode: 'Markdown' });
}

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const session = getOrCreateSession(chatId);

    bot.answerCallbackQuery(query.id); // Убираем "часики" с кнопки

    if (data.startsWith('toggle_')) {
        const networkId = data.split('_')[1];
        const enabled = session.settings.enabled_networks;
        if (enabled.includes(networkId)) {
            session.settings.enabled_networks = enabled.filter(id => id !== networkId);
        } else {
            enabled.push(networkId);
        }
        updateToggleMenu(chatId, messageId, session);
    } else if (data.startsWith('set_model_')) {
        session.settings.model = data.replace('set_model_', '');
        sendSettingsMessage(chatId); // Возвращаемся в главное меню настроек
        bot.deleteMessage(chatId, messageId); // Удаляем старое сообщение с выбором
    } else if (data.startsWith('set_lang_')) {
        session.settings.discussion_language = data.replace('set_lang_', '');
        sendSettingsMessage(chatId);
        bot.deleteMessage(chatId, messageId);
    } else if (data === 'menu_toggle') {
        updateToggleMenu(chatId, messageId, session);
    } else if (data === 'menu_model') {
        updateModelMenu(chatId, messageId, session);
    } else if (data === 'menu_lang') {
        updateLangMenu(chatId, messageId, session);
    } else if (data === 'back_to_settings') {
        bot.deleteMessage(chatId, messageId);
        sendSettingsMessage(chatId);
    } else if (data === 'close_settings') {
        bot.deleteMessage(chatId, messageId);
    }
});

function updateToggleMenu(chatId, messageId, session) {
    const { enabled_networks } = session.settings;
    const { networks } = session.networkManager;
    
    const buttons = Object.entries(networks).filter(([id]) => id !== 'summarizer').map(([id, net]) => {
        const status = enabled_networks.includes(id) ? '✅' : '❌';
        return { text: `${status} ${net.name}`, callback_data: `toggle_${id}` };
    });

    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_settings' }]);

    bot.editMessageText('*Включите или выключите участников обсуждения:*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

function updateModelMenu(chatId, messageId, session) {
    const currentModel = session.settings.model;
    const keyboard = AVAILABLE_MODELS.map(model => {
        const prefix = model === currentModel ? '🔘' : '⚪️';
        return [{ text: `${prefix} ${model}`, callback_data: `set_model_${model}` }];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_settings' }]);
    
    bot.editMessageText('*Выберите AI-модель для обсуждения:*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

function updateLangMenu(chatId, messageId, session) {
    const currentLang = session.settings.discussion_language;
    const languages = ['Russian', 'English', 'German', 'French'];
    const keyboard = languages.map(lang => {
        const prefix = lang === currentLang ? '🔘' : '⚪️';
        return [{ text: `${prefix} ${lang}`, callback_data: `set_lang_${lang}` }];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_to_settings' }]);

    bot.editMessageText('*Выберите язык, на котором будут общаться нейросети:*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}


bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));

// --- ВЕБ-СЕРВЕР ДЛЯ RENDER.COM ---
const app = express();
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, () => console.log(`Веб-сервер для проверки здоровья запущен на порту ${PORT}`));