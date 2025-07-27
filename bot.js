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
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;
const PORT = process.env.PORT || 3000;

const AVAILABLE_MODELS = ['llama3-8b-8192', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma-7b-it'];

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
        const tokens = settings.custom_networks[networkId]?.max_tokens || settings.max_tokens;

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const response = await axios.post(
                    GROQ_API_URL,
                    {
                        model: settings.model,
                        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
                        temperature: temp,
                        max_tokens: tokens,
                    },
                    { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } }
                );
                return response.data.choices[0].message.content.trim();
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    const errorMessage = error.response.data.error.message;
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
                } else {
                    console.error(`Ошибка API GROQ для "${network.name}":`, error.response ? error.response.data : error.message);
                    throw new Error(`Не удалось получить ответ от "${network.name}".`);
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
            model: 'llama3-8b-8192',
            temperature: 0.7,
            max_tokens: 1024,
            discussion_language: 'Russian',
            iteration_count: 2,
            enabled_networks: ['network1', 'network2'],
            custom_networks: {}, // { "custom1": { name: "...", ... } }
            staged_files: [], // { file_id, file_name, mime_type }
            system_prompts: {
                network1: 'You are an Analytical Network...',
                network2: 'You are a Creative Network...',
                // ... (остальные стандартные промпты)
            }
        };
    }

    resetProject() {
        this.iterations = 0;
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) return this.sendMessage("Обсуждение уже идет. Используйте /reset.");
        if (this.settings.enabled_networks.length < 1) return this.sendMessage("❗️*Ошибка:* Включите хотя бы одну нейросеть.");

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${topic}"`);

        try {
            let fileContext = await this.processStagedFiles();
            this.settings.staged_files = []; // Очищаем файлы после обработки

            await this.runDiscussionLoop(fileContext);
            await this.finalizeDevelopment();
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
                } else if (file.mime_type.includes('wordprocessingml')) { // DOCX
                    const { value } = await mammoth.extractRawText({ path: filePath });
                    context += `[Document Content]:\n${value.substring(0, 4000)}...\n`;
                } else { // Plain text
                    const textContent = fs.readFileSync(filePath, 'utf-8');
                    context += `[File Content]:\n${textContent.substring(0, 4000)}...\n`;
                }
                fs.unlinkSync(filePath); // Удаляем временный файл
            } catch (e) {
                console.error(`Ошибка обработки файла ${file.file_name}:`, e);
                context += `[Could not process file: ${file.file_name}]\n`;
            }
        }
        context += "\n--- END OF FILE CONTEXT ---\n";
        return context;
    }

    async runDiscussionLoop(fileContext) {
        let fullConversationHistory = fileContext;

        while (this.iterations < this.settings.iteration_count) {
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.settings.iteration_count}* ---\n`);
            
            let iterationHistory = "";

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                
                let prompt = `Main Topic: "${this.projectDescription}"\n\n${fullConversationHistory}\n\n---\nAs the ${networkName}, provide your input now.`;

                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings, this.sendMessage);
                this.sendMessage(`*${networkName}:*\n${response}`);
                
                iterationHistory += `\n\n**${networkName} said:**\n${response}`;
            }

            fullConversationHistory += iterationHistory;

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summaryPrompt = `Please create a concise summary of the key points from the following discussion:\n\n${iterationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings, this.sendMessage);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;

            for (const networkId of this.settings.enabled_networks) {
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                const votePrompt = `Here is the discussion summary to vote on:\n"${summary}"\n\nAs the ${networkName}, do you accept this summary? Respond with only "Accept" or "Reject" and a brief reason.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings, this.sendMessage);
                this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                
                if (voteResponse.toLowerCase().includes('accept')) votesFor++; else votesAgainst++;
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

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Токены не найдены в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};
const activeRequests = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь и информация о боте' },
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
- Нажмите "⚙️ Настройки", чтобы выбрать участников, AI-модель, язык и даже создать своих собственных нейросетей!
    `;
    bot.sendMessage(msg.chat.id, welcomeText, { ...MAIN_KEYBOARD, parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/')) return;

    if (activeRequests[chatId]) {
        handleActiveRequest(chatId, msg);
        return;
    }
    
    // Обработка прикрепленных файлов
    if (msg.photo || msg.document) {
        const session = getOrCreateSession(chatId);
        const file = msg.document || msg.photo[msg.photo.length - 1];
        session.settings.staged_files.push({
            file_id: file.file_id,
            file_name: msg.document ? msg.document.file_name : 'photo.jpg',
            mime_type: msg.document ? msg.document.mime_type : 'image/jpeg'
        });
        bot.sendMessage(chatId, `✅ Файл "${file.file_name || 'photo.jpg'}" добавлен и будет использован в следующем обсуждении.`);
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

// ... (остальной код с меню и колбэками будет ниже)
// ... (вставьте сюда весь блок с `sendSettingsMessage` и `bot.on('callback_query', ...)` из предыдущего ответа)
// ... (и `handleActiveRequest` тоже)

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

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const session = getOrCreateSession(chatId);

    bot.answerCallbackQuery(query.id);

    const action = data.split('_')[0];
    const value = data.substring(action.length + 1);

    switch (action) {
        case 'toggle':
            const enabled = session.settings.enabled_networks;
            if (enabled.includes(value)) {
                session.settings.enabled_networks = enabled.filter(id => id !== value);
            } else {
                enabled.push(value);
            }
            updateToggleMenu(chatId, messageId, session);
            break;
        case 'setmodel':
            session.settings.model = value;
            updateModelMenu(chatId, messageId, session);
            break;
        case 'setlang':
            session.settings.discussion_language = value;
            updateLangMenu(chatId, messageId, session);
            break;
        case 'setiterations':
            session.settings.iteration_count = parseInt(value, 10);
            updateAdvancedMenu(chatId, messageId, session);
            break;
        case 'promptfor':
            const networkName = session.networkManager.networks[value]?.name || session.settings.custom_networks[value]?.name;
            bot.sendMessage(chatId, `Пришлите следующим сообщением новый системный промпт для "${networkName}":`);
            activeRequests[chatId] = { type: 'system_prompt', networkId: value };
            bot.deleteMessage(chatId, messageId);
            break;
        case 'settemp':
            bot.sendMessage(chatId, `Пришлите следующим сообщением новое значение температуры (число от 0.0 до 2.0):`);
            activeRequests[chatId] = { type: 'temperature' };
            bot.deleteMessage(chatId, messageId);
            break;
        case 'settokens':
            bot.sendMessage(chatId, `Пришлите следующим сообщением новый лимит токенов (число от 1 до 32768):`);
            activeRequests[chatId] = { type: 'max_tokens' };
            bot.deleteMessage(chatId, messageId);
            break;
        case 'menu':
            switch (value) {
                case 'toggle': updateToggleMenu(chatId, messageId, session); break;
                case 'model': updateModelMenu(chatId, messageId, session); break;
                case 'lang': updateLangMenu(chatId, messageId, session); break;
                case 'advanced': updateAdvancedMenu(chatId, messageId, session); break;
                case 'prompts': updatePromptsMenu(chatId, messageId, session); break;
                case 'custom': updateCustomNetworksMenu(chatId, messageId, session); break;
                case 'createnew':
                    if (Object.keys(session.settings.custom_networks).length >= 10) {
                        bot.sendMessage(chatId, "❌ Достигнут лимит в 10 кастомных нейросетей.");
                    } else {
                        bot.sendMessage(chatId, "Введите имя для вашей новой нейросети:");
                        activeRequests[chatId] = { type: 'custom_network_name' };
                        bot.deleteMessage(chatId, messageId);
                    }
                    break;
            }
            break;
        case 'back':
            bot.deleteMessage(chatId, messageId);
            if (value === 'settings') sendSettingsMessage(chatId);
            if (value === 'advanced') updateAdvancedMenu(chatId, messageId, session);
            break;
        case 'close':
            bot.deleteMessage(chatId, messageId);
            break;
    }
});

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
    const keyboard = AVAILABLE_MODELS.map(model => ([{ text: `${model === session.settings.model ? '🔘' : '⚪️'} ${model}`, callback_data: `setmodel_${model}` }]));
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
    const keyboard = [
        [{ text: `🔄 Итерации: ${s.iteration_count}`, callback_data: 'menu_iterations' }], // Эта кнопка пока не реализована, можно добавить
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

function handleActiveRequest(chatId, msg) {
    const request = activeRequests[chatId];
    const session = getOrCreateSession(chatId);
    const text = msg.text;

    switch (request.type) {
        case 'topic':
            delete activeRequests[chatId];
            session.startCollaboration(text);
            break;
        case 'temperature':
            const temp = parseFloat(text);
            if (!isNaN(temp) && temp >= 0.0 && temp <= 2.0) {
                session.settings.temperature = temp;
                bot.sendMessage(chatId, `✅ Температура установлена на: \`${temp}\``, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, '❌ Ошибка. Введите число от 0.0 до 2.0.');
            }
            delete activeRequests[chatId];
            sendSettingsMessage(chatId);
            break;
        case 'max_tokens':
            const tokens = parseInt(text, 10);
            if (!isNaN(tokens) && tokens > 0 && tokens <= 32768) {
                session.settings.max_tokens = tokens;
                bot.sendMessage(chatId, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, '❌ Ошибка. Введите целое число от 1 до 32768.');
            }
            delete activeRequests[chatId];
            sendSettingsMessage(chatId);
            break;
        case 'system_prompt':
            session.settings.system_prompts[request.networkId] = text;
            const networkName = session.networkManager.networks[request.networkId]?.name || session.settings.custom_networks[request.networkId]?.name;
            bot.sendMessage(chatId, `✅ Системный промпт для "${networkName}" обновлен.`);
            delete activeRequests[chatId];
            sendSettingsMessage(chatId);
            break;
        case 'custom_network_name':
            const newId = `custom${Date.now()}`;
            activeRequests[chatId] = { type: 'custom_network_prompt', id: newId, name: text };
            bot.sendMessage(chatId, `Отлично! Теперь введите системный промпт (личность) для "${text}":`);
            break;
        case 'custom_network_prompt':
            activeRequests[chatId].prompt = text;
            bot.sendMessage(chatId, `Принято. Теперь введите температуру (креативность) для этой нейросети (например, 0.7):`);
            activeRequests[chatId].type = 'custom_network_temp';
            break;
        case 'custom_network_temp':
            const customTemp = parseFloat(text);
            if (isNaN(customTemp) || customTemp < 0.0 || customTemp > 2.0) {
                bot.sendMessage(chatId, '❌ Ошибка. Введите число от 0.0 до 2.0.');
                return; // Оставляем запрос активным для повторной попытки
            }
            activeRequests[chatId].temp = customTemp;
            bot.sendMessage(chatId, `Понял. И последнее: введите лимит токенов (длину ответа), например, 1024:`);
            activeRequests[chatId].type = 'custom_network_tokens';
            break;
        case 'custom_network_tokens':
            const customTokens = parseInt(text, 10);
            if (isNaN(customTokens) || customTokens <= 0) {
                bot.sendMessage(chatId, '❌ Ошибка. Введите положительное целое число.');
                return;
            }
            const finalData = activeRequests[chatId];
            session.settings.custom_networks[finalData.id] = {
                name: finalData.name,
                short_name: finalData.name.toLowerCase().replace(/\s/g, '').substring(0, 8),
                system_prompt: finalData.prompt,
                temperature: finalData.temp,
                max_tokens: customTokens
            };
            bot.sendMessage(chatId, `✅ Новая нейросеть "${finalData.name}" успешно создана!`);
            delete activeRequests[chatId];
            sendSettingsMessage(chatId);
            break;
    }
}

bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));

const app = express();
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, () => console.log(`Веб-сервер для проверки здоровья запущен на порту ${PORT}`));
