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
    // Этот класс теперь не нужен, так как логика промптов стала сложнее и переехала в Framework
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

    async generateResponse(networkId, prompt, settings, sendMessageCallback) {
        const network = this.networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        let systemPrompt = settings.system_prompts[networkId];
        systemPrompt += `\n\nIMPORTANT INSTRUCTION: You MUST respond ONLY in ${settings.discussion_language}. Do not use any other language.`;

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Небольшая задержка перед каждым запросом для профилактики
                await new Promise(resolve => setTimeout(resolve, 1000));

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
                console.error(`\n--- ОШИБКА API GROQ для "${network.name}", попытка ${attempt} ---`);
                if (error.response && error.response.status === 429) {
                    // Это ошибка Rate Limit
                    const errorMessage = error.response.data.error.message;
                    let waitTime = 20; // Время ожидания по умолчанию
                    
                    // Пытаемся извлечь точное время ожидания из ответа API
                    const match = errorMessage.match(/try again in ([\d.]+)s/i);
                    if (match && match[1]) {
                        waitTime = Math.ceil(parseFloat(match[1]));
                    }

                    console.log(`Rate limit. Ожидание ${waitTime} секунд...`);
                    if (sendMessageCallback) {
                        sendMessageCallback(`⏳ _Достигнут лимит API, жду ${waitTime} секунд..._`);
                    }
                    
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                        continue; // Переходим к следующей попытке
                    } else {
                        throw new Error(`Слишком много запросов к "${network.name}". Лимит не сбросился после нескольких попыток.`);
                    }
                } else {
                    // Если ошибка другая, выводим ее и прекращаем попытки
                    if (error.response) {
                        console.error(`Статус: ${error.response.status}, Данные: ${JSON.stringify(error.response.data)}`);
                    } else {
                        console.error(`Сообщение: ${error.message}`);
                    }
                    throw new Error(`Не удалось получить ответ от "${network.name}".`);
                }
            }
        }
    }
}

class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback;
        this.networkManager = new NetworkManager();
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
            
            let iterationHistory = ""; // История только для текущей итерации

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                
                // Формируем промпт: общая тема + принятые саммари + история текущей итерации
                let prompt = `Main Topic: "${this.projectDescription}"\n\n`;
                if (this.acceptedSummaries.length > 0) {
                    prompt += `Here are the accepted summaries from previous rounds:\n${this.acceptedSummaries.map((s, i) => `Summary ${i+1}: ${s}`).join('\n\n')}\n\n`;
                }
                prompt += `Here is the conversation from the current round so far:\n${iterationHistory}\n\n---\nAs the ${networkName}, provide your input now.`;

                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings, this.sendMessage);
                this.sendMessage(`*${networkName}:*\n${response}`);
                
                // Добавляем ответ в историю этой итерации
                iterationHistory += `\n\n**${networkName} said:**\n${response}`;
            }

            // Добавляем историю итерации в общую историю
            fullConversationHistory += iterationHistory;

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summaryPrompt = `Please create a concise summary of the key points from the following discussion:\n\n${iterationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings, this.sendMessage);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId].name;
                const votePrompt = `Here is the discussion summary to vote on:\n"${summary}"\n\nAs the ${networkName}, do you accept this summary? Respond with only "Accept" or "Reject" and a brief reason.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings, this.sendMessage);
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
        if (this.acceptedSummaries.length === 0) {
            this.sendMessage("\n\n--- 🏁 *Обсуждение завершено, но ни одна сводка не была принята. Итоговый отчет не может быть создан.* ---");
            return;
        }
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following accepted summaries, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings, this.sendMessage);
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

const activeTopicRequests = new Set();

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/')) return;

    if (activeTopicRequests.has(chatId)) {
        activeTopicRequests.delete(chatId);
        getOrCreateSession(chatId).startCollaboration(text);
        return;
    }

    switch (text) {
        case '🚀 Новое Обсуждение':
            bot.sendMessage(chatId, 'Какую тему вы хотите обсудить? Просто напишите ее в чат.');
            activeTopicRequests.add(chatId);
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

    bot.answerCallbackQuery(query.id);

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
        updateModelMenu(chatId, messageId, session); // Обновляем меню, чтобы показать выбор
    } else if (data.startsWith('set_lang_')) {
        session.settings.discussion_language = data.replace('set_lang_', '');
        updateLangMenu(chatId, messageId, session); // Обновляем меню
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
    keyboard.push([{ text: '⬅️ Назад в Настройки', callback_data: 'back_to_settings' }]);

    bot.editMessageText('*Включите или выключите участников обсуждения:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(e => console.log("Не удалось отредактировать сообщение, возможно, оно не изменилось."));
}

function updateModelMenu(chatId, messageId, session) {
    const currentModel = session.settings.model;
    const keyboard = AVAILABLE_MODELS.map(model => {
        const prefix = model === currentModel ? '🔘' : '⚪️';
        return [{ text: `${prefix} ${model}`, callback_data: `set_model_${model}` }];
    });
    keyboard.push([{ text: '⬅️ Назад в Настройки', callback_data: 'back_to_settings' }]);
    
    bot.editMessageText('*Выберите AI-модель для обсуждения:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(e => console.log("Не удалось отредактировать сообщение, возможно, оно не изменилось."));
}

function updateLangMenu(chatId, messageId, session) {
    const currentLang = session.settings.discussion_language;
    const languages = ['Russian', 'English', 'German', 'French', 'Ukrainian'];
    const keyboard = languages.map(lang => {
        const prefix = lang === currentLang ? '🔘' : '⚪️';
        return [{ text: `${prefix} ${lang}`, callback_data: `set_lang_${lang}` }];
    });
    keyboard.push([{ text: '⬅️ Назад в Настройки', callback_data: 'back_to_settings' }]);

    bot.editMessageText('*Выберите язык, на котором будут общаться нейросети:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(e => console.log("Не удалось отредактировать сообщение, возможно, оно не изменилось."));
}

bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));

// --- ВЕБ-СЕРВЕР ДЛЯ RENDER.COM ---
const app = express();
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, () => console.log(`Веб-сервер для проверки здоровья запущен на порту ${PORT}`));