// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const { GoogleAuth } = require('googleapis').google.auth;
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;
const PORT = process.env.PORT || 3000;

// --- НОВОЕ: Проверенный и надежный список моделей ---
const MODEL_MAP = {
    // --- Надежные Рабочие Лошадки (Быстрые и всегда доступны) ---
    'Llama 3 8B': 'meta-llama/llama-3-8b-instruct:free',
    'Mistral 7B': 'mistralai/mistral-7b-instruct:free',
    'Gemma 7B': 'google/gemma-7b-it:free',
    'Qwen 1.5 7B': 'qwen/qwen-1.5-7b-chat:free',

    // --- Мощные, но иногда могут быть недоступны ---
    'Llama 3 70B': 'meta-llama/llama-3-70b-instruct:free',
    'Mixtral 8x7B': 'mistralai/mixtral-8x7b-instruct:free',
    'Claude 3 Haiku': 'anthropic/claude-3-haiku:free',

    // --- Специализированные ---
    'Code Llama 70B': 'meta-llama/codellama-70b-instruct:free' // Для задач по коду
};
const AVAILABLE_MODELS = Object.keys(MODEL_MAP);

const VOTE_KEYWORDS = {
    'English': { accept: 'accept', reject: 'reject' },
    'Russian': { accept: 'принимаю', reject: 'отклоняю' },
    'German': { accept: 'akzeptieren', reject: 'ablehnen' },
    'French': { accept: 'accepter', reject: 'rejeter' },
    'Ukrainian': { accept: 'приймаю', reject: 'відхиляю' }
};

// --- КЛАССЫ ПРОЕКТА ---

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
        const network = this.networks[networkId] || settings.custom_networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        let systemPrompt = (settings.custom_networks[networkId]?.system_prompt) || settings.system_prompts[networkId];
        systemPrompt += `\n\nIMPORTANT INSTRUCTION: You MUST respond ONLY in ${settings.discussion_language}. Do not use any other language.`;
        
        const temp = settings.custom_networks[networkId]?.temperature || settings.temperature;
        
        const modelContextLimit = 8192;
        const promptTokens = Math.ceil(prompt.length / 3.5); 
        const availableTokensForResponse = modelContextLimit - promptTokens - 200; 

        if (availableTokensForResponse <= 0) {
            throw new Error(`Контекст обсуждения стал слишком длинным для модели.`);
        }

        const finalMaxTokens = Math.min(
            settings.custom_networks[networkId]?.max_tokens || settings.max_tokens,
            availableTokensForResponse
        );

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 500));
                const response = await axios.post(
                    OPENROUTER_API_URL,
                    {
                        model: MODEL_MAP[settings.model],
                        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
                        temperature: temp,
                        max_tokens: finalMaxTokens,
                    },
                    { 
                        headers: { 
                            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                            'HTTP-Referer': 'https://github.com/ollxel/neural-collab-bot',
                            'X-Title': 'Neural Collab Bot'
                        } 
                    }
                );
                return response.data.choices[0].message.content.trim();
            } catch (error) {
                const errorData = error.response?.data?.error;
                
                // --- НОВОЕ: Умная обработка ошибок ---
                if (error.response && error.response.status === 429) {
                    const errorMessage = errorData.message;
                    let waitTime = 20;
                    const match = errorMessage.match(/try again in ([\d.]+)s/i);
                    if (match && match[1]) waitTime = Math.ceil(parseFloat(match[1]));
                    if (sendMessageCallback) sendMessageCallback(`⏳ _Достигнут лимит API, жду ${waitTime} секунд..._`);
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                        continue;
                    } else {
                        throw new Error(`Слишком много запросов к "${network.name}".`);
                    }
                } else if (error.response && error.response.status === 404 && errorData.message.includes('No endpoints found')) {
                    // Это ошибка "модель временно недоступна"
                    throw new Error(`Модель "${settings.model}" временно недоступна на бесплатном тарифе. Пожалуйста, выберите другую модель в настройках.`);
                } else {
                    console.error(`Ошибка API OpenRouter для "${network.name}":`, error.response ? error.response.data : error.message);
                    const errorDetails = errorData?.message || "Неизвестная ошибка API.";
                    throw new Error(`Не удалось получить ответ от "${network.name}": ${errorDetails}`);
                }
            }
        }
    }

    async describeImage(filePath) {
        if (!GOOGLE_GEMINI_API_KEY) throw new Error("Ключ Google Gemini API не настроен.");
        const imageBytes = fs.readFileSync(filePath).toString('base64');
        const requestBody = {
            contents: [{
                parts: [
                    { text: "Describe this image in detail. What is happening, what objects are present, what is the context?" },
                    { inline_data: { mime_type: 'image/jpeg', data: imageBytes } }
                ]
            }]
        };
        const response = await axios.post(GEMINI_API_URL, requestBody);
        return response.data.candidates[0].content.parts[0].text;
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
            model: 'Llama 3 8B',
            temperature: 0.7,
            max_tokens: 1024,
            discussion_language: 'Russian',
            iteration_count: 2,
            enabled_networks: ['network1', 'network2'],
            custom_networks: {},
            staged_files: [],
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
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) return this.sendMessage("Обсуждение уже идет. Используйте /stop или /reset.");
        if (this.settings.enabled_networks.length < 1) return this.sendMessage("❗️*Ошибка:* Включите хотя бы одну нейросеть.");

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${topic}"\n\n_Чтобы остановить, используйте команду /stop_`);

        try {
            let fileContext = await this.processStagedFiles();
            this.settings.staged_files = [];

            await this.runDiscussionLoop(fileContext);
            if (this.isWorking) await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            this.sendMessage(`❗️*Произошла ошибка:* ${error.message}`);
        } finally {
            this.isWorking = false;
        }
    }
    
    async processStagedFiles() {
        if (this.settings.staged_files.length === 0) return "";

        this.sendMessage("📎 _Обрабатываю прикрепленные файлы..._");
        let context = "\n\n--- ATTACHED FILE CONTEXT ---\n";
        for (const file of this.settings.staged_files) {
            try {
                const filePath = await bot.downloadFile(file.file_id, os.tmpdir());
                context += `\n**File: ${file.file_name}**\n`;

                if (file.mime_type.startsWith('image/')) {
                    const description = await this.networkManager.describeImage(filePath);
                    context += `[Image Content Description]:\n${description}\n`;
                } else if (file.mime_type === 'application/pdf') {
                    const data = await pdf(filePath);
                    context += `[Document Content]:\n${data.text.substring(0, 4000)}...\n`;
                } else if (file.mime_type.includes('wordprocessingml')) {
                    const { value } = await mammoth.extractRawText({ path: filePath });
                    context += `[Document Content]:\n${value.substring(0, 4000)}...\n`;
                } else {
                    const textContent = fs.readFileSync(filePath, 'utf-8');
                    context += `[File Content]:\n${textContent.substring(0, 4000)}...\n`;
                }
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`Ошибка обработки файла ${file.file_name}:`, e);
                context += `[Could not process file: ${file.file_name}]\n`;
            }
        }
        context += "\n--- END OF FILE CONTEXT ---\n";
        return context;
    }

    async runDiscussionLoop(fileContext) {
        while (this.iterations < this.settings.iteration_count) {
            if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.settings.iteration_count}* ---\n`);
            
            let iterationHistory = "";

            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                
                let prompt = `Main Topic: "${this.projectDescription}"\n\n`;
                if (fileContext) prompt += fileContext;
                if (this.acceptedSummaries.length > 0) {
                    prompt += `Here are the accepted summaries from previous rounds:\n${this.acceptedSummaries.map((s, i) => `Summary ${i+1}: ${s}`).join('\n\n')}\n\n`;
                }
                prompt += `Here is the conversation from the current round so far:\n${iterationHistory}\n\n---\nAs the ${networkName}, provide your input now.`;

                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings, this.sendMessage);
                if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
                this.sendMessage(`*${networkName}:*\n${response}`);
                
                iterationHistory += `\n\n**${networkName} said:**\n${response}`;
            }

            if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summaryPrompt = `Please create a concise summary of the key points from the following discussion:\n\n${iterationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings, this.sendMessage);
            if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;

            const keywords = VOTE_KEYWORDS[this.settings.discussion_language] || VOTE_KEYWORDS['English'];
            const acceptRegex = new RegExp(`^${keywords.accept}`, 'i');

            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                const votePrompt = `Here is the discussion summary to vote on:\n"${summary}"\n\nAs the ${networkName}, do you accept this summary? Respond with ONLY the word "${keywords.accept}" or "${keywords.reject}" in ${this.settings.discussion_language}, followed by a brief reason.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings, this.sendMessage);
                if (!this.isWorking) { this.sendMessage("Обсуждение прервано пользователем."); return; }
                this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                
                if (acceptRegex.test(voteResponse)) votesFor++; else votesAgainst++;
            }

            if (votesAgainst >= votesFor) {
                this.sendMessage(`*Голосование провалено* (${votesFor} за, ${votesAgainst} против). Сводка отклонена.`);
            } else {
                this.sendMessage(`*Голосование успешно!* (${votesFor} за, ${votesAgainst} против). Сводка принята.`);
                this.acceptedSummaries.push(summary);
            }
        }
    }

    async finalizeDevelopment() {
        if (this.acceptedSummaries.length === 0) {
            this.sendMessage("\n\n--- 🏁 *Обсуждение завершено, но ни одна сводка не была принята.* ---");
            return;
        }
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following accepted summaries, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings, this.sendMessage);
        this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

// --- ЛОГИКА ТЕЛЕГРАМ БОТА ---

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Токены не найдены в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};
const activeRequests = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь и информация о боте' },
    { command: '/stop', description: '🛑 Немедленно остановить генерацию' },
    { command: '/settings', description: '⚙️ Показать/изменить настройки' },
    { command: '/reset', description: '🗑 Сбросить обсуждение и настройки' },
]);

function getOrCreateSession(chatId) {
    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => {
            bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(chatId, text));
        });
    }
    return chatSessions[chatId];
}

console.log('Бот успешно запущен и готов к работе!');

const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [[{ text: '🚀 Новое Обсуждение' }, { text: '⚙️ Настройки' }]],
        resize_keyboard: true,
    },
};

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать!*
Я бот для совместной работы AI-личностей.

*Как начать:*
1. *(Опционально)* Прикрепите файлы (фото, документы), которые нейросети должны учесть.
2. Нажмите кнопку "🚀 Новое Обсуждение" и напишите тему.

*Настройки:*
- Нажмите "⚙️ Настройки", чтобы выбрать участников, AI-модели, язык и даже создать своих собственных нейросетей!
    `;
    bot.sendMessage(msg.chat.id, welcomeText, { ...MAIN_KEYBOARD, parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (msg.photo || msg.document) {
        const session = getOrCreateSession(chatId);
        const file = msg.document || msg.photo[msg.photo.length - 1];
        const fileName = msg.document?.file_name || `photo_${file.file_id.substring(0, 6)}.jpg`;
        session.settings.staged_files.push({
            file_id: file.file_id,
            file_name: fileName,
            mime_type: msg.document?.mime_type || 'image/jpeg'
        });
        bot.sendMessage(chatId, `✅ Файл "${fileName}" добавлен и будет использован в следующем обсуждении.`);
        if (activeRequests[chatId]?.type === 'topic') {
            delete activeRequests[chatId];
        }
        return;
    }

    if (text && text.startsWith('/')) return;

    if (activeRequests[chatId]) {
        handleActiveRequest(chatId, msg);
        return;
    }

    switch (text) {
        case '🚀 Новое Обсуждение':
            bot.sendMessage(chatId, 'Какую тему вы хотите обсудить? Просто напишите ее в чат.');
            activeRequests[chatId] = { type: 'topic' };
            break;
        case '⚙️ Настройки':
            sendSettingsMessage(chatId);
            break;
    }
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены.", MAIN_KEYBOARD);
});

bot.onText(/\/stop/, (msg) => {
    const session = getOrCreateSession(msg.chat.id);
    if (session.isWorking) {
        session.isWorking = false;
        bot.sendMessage(msg.chat.id, "🛑 Получен сигнал остановки. Завершаю текущую операцию...");
    } else {
        bot.sendMessage(msg.chat.id, "Сейчас нет активного обсуждения, чтобы его останавливать.");
    }
});

const callbackQueryHandlers = {
    toggle: (session, value, chatId, messageId) => {
        const enabled = session.settings.enabled_networks;
        if (enabled.includes(value)) {
            session.settings.enabled_networks = enabled.filter(id => id !== value);
        } else {
            enabled.push(value);
        }
        updateToggleMenu(chatId, messageId, session);
    },
    setmodel: (session, value, chatId, messageId) => {
        session.settings.model = value;
        updateModelMenu(chatId, messageId, session);
    },
    setlang: (session, value, chatId, messageId) => {
        session.settings.discussion_language = value;
        updateLangMenu(chatId, messageId, session);
    },
    setiterations: (session, value, chatId, messageId) => {
        session.settings.iteration_count = parseInt(value, 10);
        updateAdvancedMenu(chatId, messageId, session);
    },
    promptfor: (session, value, chatId, messageId) => {
        const networkName = session.networkManager.networks[value]?.name || session.settings.custom_networks[value]?.name;
        bot.sendMessage(chatId, `Пришлите следующим сообщением новый системный промпт для "${networkName}":`);
        activeRequests[chatId] = { type: 'system_prompt', networkId: value };
        bot.deleteMessage(chatId, messageId);
    },
    settemp: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите следующим сообщением новое значение температуры (число от 0.0 до 2.0):`);
        activeRequests[chatId] = { type: 'temperature' };
        bot.deleteMessage(chatId, messageId);
    },
    settokens: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите следующим сообщением новый лимит токенов (число от 1 до 8192):`);
        activeRequests[chatId] = { type: 'max_tokens' };
        bot.deleteMessage(chatId, messageId);
    },
    menu: (session, value, chatId, messageId) => {
        const menuActions = {
            'toggle': updateToggleMenu,
            'model': updateModelMenu,
            'lang': updateLangMenu,
            'advanced': updateAdvancedMenu,
            'prompts': updatePromptsMenu,
            'custom': updateCustomNetworksMenu,
            'createnew': (chatId, messageId, session) => {
                if (Object.keys(session.settings.custom_networks).length >= 10) {
                    bot.sendMessage(chatId, "❌ Достигнут лимит в 10 кастомных нейросетей.");
                } else {
                    bot.sendMessage(chatId, "Введите имя для вашей новой нейросети:");
                    activeRequests[chatId] = { type: 'custom_network_name' };
                    bot.deleteMessage(chatId, messageId);
                }
            }
        };
        if (menuActions[value]) menuActions[value](chatId, messageId, session);
    },
    back: (session, value, chatId, messageId) => {
        bot.deleteMessage(chatId, messageId);
        if (value === 'settings') sendSettingsMessage(chatId);
        if (value === 'advanced') updateAdvancedMenu(chatId, messageId, session);
    },
    close: (session, value, chatId, messageId) => {
        bot.deleteMessage(chatId, messageId);
    }
};

bot.on('callback_query', (query) => {
    const { message, data } = query;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const session = getOrCreateSession(chatId);

    bot.answerCallbackQuery(query.id);

    const action = data.split('_')[0];
    const value = data.substring(action.length + 1);

    if (callbackQueryHandlers[action]) {
        callbackQueryHandlers[action](session, value, chatId, messageId);
    }
});

function sendSettingsMessage(chatId) {
    const session = getOrCreateSession(chatId);
    const s = session.settings;
    const nm = session.networkManager;

    const enabledNetworks = s.enabled_networks.map(id => nm.networks[id]?.name || s.custom_networks[id]?.name).join(', ');
    
    const settingsText = `*Текущие настройки для этого чата:*\n\n*Участники:* ${enabledNetworks || 'Никто не включен'}\n*Язык:* \`${s.discussion_language}\`\n*AI-Модель:* \`${s.model}\``;

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🕹 Участники', callback_data: 'menu_toggle' }],
                [{ text: '🤖 AI-Модель', callback_data: 'menu_model' }, { text: '🌍 Язык', callback_data: 'menu_lang' }],
                [{ text: '🧠 Мои Нейросети', callback_data: 'menu_custom' }],
                [{ text: '🔧 Продвинутые настройки', callback_data: 'menu_advanced' }],
                [{ text: '❌ Закрыть', callback_data: 'close_settings' }]
            ]
        }
    };
    bot.sendMessage(chatId, settingsText, { ...inlineKeyboard, parse_mode: 'Markdown' });
}

function updateToggleMenu(chatId, messageId, session) {
    const { enabled_networks, custom_networks } = session.settings;
    const { networks } = session.networkManager;
    
    const allNetworks = { ...networks, ...custom_networks };
    const buttons = Object.entries(allNetworks).filter(([id]) => id !== 'summarizer').map(([id, net]) => {
        const status = enabled_networks.includes(id) ? '✅' : '❌';
        return { text: `${status} ${net.name}`, callback_data: `toggle_${id}` };
    });

    const keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    bot.editMessageText('*Включите или выключите участников:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateModelMenu(chatId, messageId, session) {
    const keyboard = AVAILABLE_MODELS.map(modelName => ([{ text: `${modelName === session.settings.model ? '🔘' : '⚪️'} ${modelName}`, callback_data: `setmodel_${modelName}` }]));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Выберите AI-модель:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateLangMenu(chatId, messageId, session) {
    const languages = ['Russian', 'English', 'German', 'French', 'Ukrainian'];
    const keyboard = languages.map(lang => ([{ text: `${lang === session.settings.discussion_language ? '🔘' : '⚪️'} ${lang}`, callback_data: `setlang_${lang}` }]));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Выберите язык общения нейросетей:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateAdvancedMenu(chatId, messageId, session) {
    const s = session.settings;
    const text = `*Продвинутые настройки:*\n\n- *Итерации:* \`${s.iteration_count}\`\n- *Температура:* \`${s.temperature}\`\n- *Макс. токенов:* \`${s.max_tokens}\``;
    
    const iterationButtons = [1, 2, 3, 4, 5].map(i => ({
        text: `${s.iteration_count === i ? '🔘' : '⚪️'} ${i}`,
        callback_data: `setiterations_${i}`
    }));

    const keyboard = [
        iterationButtons,
        [{ text: '🌡️ Температура', callback_data: 'settemp' }, { text: '📄 Макс. токенов', callback_data: 'settokens' }],
        [{ text: '🧠 Системные промпты', callback_data: 'menu_prompts' }],
        [{ text: '⬅️ Назад', callback_data: 'back_settings' }]
    ];
    bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updatePromptsMenu(chatId, messageId, session) {
    const allNetworks = { ...session.networkManager.networks, ...session.settings.custom_networks };
    const buttons = Object.entries(allNetworks).map(([id, net]) => ([{ text: net.name, callback_data: `promptfor_${id}` }]));
    buttons.push([{ text: '⬅️ Назад', callback_data: 'menu_advanced' }]);
    bot.editMessageText('*Выберите нейросеть для изменения ее личности:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
}

function updateCustomNetworksMenu(chatId, messageId, session) {
    const { custom_networks } = session.settings;
    const text = Object.keys(custom_networks).length > 0
        ? '*Ваши кастомные нейросети:*'
        : '*У вас пока нет кастомных нейросетей.*';
    
    const keyboard = Object.entries(custom_networks).map(([id, net]) => ([{ text: net.name, callback_data: `editcustom_${id}` }]));
    keyboard.push([{ text: '➕ Создать новую', callback_data: 'menu_createnew' }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

const activeRequestHandlers = {
    'topic': (session, text) => {
        session.startCollaboration(text);
    },
    'temperature': (session, text, chatId) => {
        const temp = parseFloat(text);
        if (!isNaN(temp) && temp >= 0.0 && temp <= 2.0) {
            session.settings.temperature = temp;
            bot.sendMessage(chatId, `✅ Температура установлена на: \`${temp}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Ошибка. Введите число от 0.0 до 2.0.');
        }
        sendSettingsMessage(chatId);
    },
    'max_tokens': (session, text, chatId) => {
        const tokens = parseInt(text, 10);
        if (!isNaN(tokens) && tokens > 0 && tokens <= 8192) {
            session.settings.max_tokens = tokens;
            bot.sendMessage(chatId, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Ошибка. Введите целое число от 1 до 8192.');
        }
        sendSettingsMessage(chatId);
    },
    'system_prompt': (session, text, chatId, request) => {
        session.settings.system_prompts[request.networkId] = text;
        const networkName = session.networkManager.networks[request.networkId]?.name || session.settings.custom_networks[request.networkId]?.name;
        bot.sendMessage(chatId, `✅ Системный промпт для "${networkName}" обновлен.`);
        sendSettingsMessage(chatId);
    },
    'custom_network_name': (session, text, chatId) => {
        const newId = `custom${Date.now()}`;
        activeRequests[chatId] = { type: 'custom_network_prompt', id: newId, name: text };
        bot.sendMessage(chatId, `Отлично! Теперь введите системный промпт (личность) для "${text}":`);
    },
    'custom_network_prompt': (session, text, chatId, request) => {
        request.prompt = text;
        request.type = 'custom_network_temp';
        bot.sendMessage(chatId, `Принято. Теперь введите температуру (креативность) для этой нейросети (например, 0.7):`);
    },
    'custom_network_temp': (session, text, chatId, request) => {
        const temp = parseFloat(text);
        if (isNaN(temp) || temp < 0.0 || temp > 2.0) {
            bot.sendMessage(chatId, '❌ Ошибка. Введите число от 0.0 до 2.0.');
            return;
        }
        request.temp = temp;
        request.type = 'custom_network_tokens';
        bot.sendMessage(chatId, `Понял. И последнее: введите лимит токенов (длину ответа), например, 1024:`);
    },
    'custom_network_tokens': (session, text, chatId, request) => {
        const tokens = parseInt(text, 10);
        if (isNaN(tokens) || tokens <= 0) {
            bot.sendMessage(chatId, '❌ Ошибка. Введите положительное целое число.');
            return;
        }
        session.settings.custom_networks[request.id] = {
            name: request.name,
            short_name: request.name.toLowerCase().replace(/\s/g, '').substring(0, 8),
            system_prompt: request.prompt,
            temperature: request.temp,
            max_tokens: tokens
        };
        bot.sendMessage(chatId, `✅ Новая нейросеть "${request.name}" успешно создана!`);
        delete activeRequests[chatId];
        sendSettingsMessage(chatId);
    }
};

function handleActiveRequest(chatId, msg) {
    const request = activeRequests[chatId];
    const session = getOrCreateSession(chatId);
    const text = msg.text;

    if (!text) {
        bot.sendMessage(chatId, "Пожалуйста, пришлите ответ в виде текста.");
        return;
    }

    const handler = activeRequestHandlers[request.type];
    if (handler) {
        if (!request.type.startsWith('custom_network')) {
            delete activeRequests[chatId];
        }
        handler(session, text, chatId, request);
    }
}

bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));

const app = express();
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, () => console.log(`Веб-сервер для проверки здоровья запущен на порту ${PORT}`));
