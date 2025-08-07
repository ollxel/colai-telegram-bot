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

// --- API КЛЮЧИ ИЗ .env ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROK_API_KEY = process.env.GROK_API_KEY;


// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;
const PORT = process.env.PORT || 3000;

// --- ОБНОВЛЕННЫЙ И ИСПРАВЛЕННЫЙ СПИСОК МОДЕЛЕЙ ---
const MODEL_MAP = {
    // OpenAI Models
    'GPT-4o (новейшая)': 'openai/gpt-4o',
    'GPT-4 Turbo': 'openai/gpt-4-turbo',
    'GPT-3.5 Turbo (free)': 'openai/gpt-3.5-turbo:free',

    // xAI (Grok) Models
    'Grok Llama3 8B': 'grok/llama3-8b',
    'Grok Llama3 70B': 'grok/llama3-70b',
    
    // Anthropic Models
    'Claude 3.5 Sonnet (новейшая)': 'anthropic/claude-3.5-sonnet',
    'Claude 3 Opus': 'anthropic/claude-3-opus',
    'Claude 3 Haiku': 'anthropic/claude-3-haiku',

    // Google Models
    'Gemini Pro 1.5': 'google/gemini-pro-1.5',
    'Gemini Flash 1.5': 'google/gemini-flash-1.5',
    'Gemini Pro (free)': 'google/gemini-pro:free',

    // Meta Models
    'Llama 3 70B': 'meta-llama/llama-3-70b-instruct',
    'Llama 3 8B (free)': 'meta-llama/llama-3-8b-instruct:free',
    
    // MistralAI Models
    'Mistral Large': 'mistralai/mistral-large',
    'Mistral 7B (free)': 'mistralai/mistral-7b-instruct:free'
};
const AVAILABLE_MODELS = Object.keys(MODEL_MAP);

const VOTE_KEYWORDS = {
    'English': { accept: 'accept', reject: 'reject' },
    'Russian': { accept: 'принимаю', reject: 'отклоняю' },
    'German': { accept: 'akzeptieren', reject: 'ablehnen' },
    'French': { accept: 'accepter', reject: 'rejeter' },
    'Ukrainian': { accept: 'приймаю', reject: 'відхиляю' }
};

class NetworkManager {
    constructor() {
        this.networks = {
            network1: { name: 'Аналитическая Сеть', short_name: 'analytical' },
            network2: { name: 'Креативная Сеть', short_name: 'creative' },
            network3: { name: 'Сеть Реализации', short_name: 'implementation' },
            network4: { name: 'Сеть Data Science', short_name: 'data' },
            network5: { name: 'Этическая Сеть', short_name: 'ethical' },
            network6: { name: 'Сеть UX', short_name: 'ux' },
            network7: { name: 'Сеть Системного Мышления', short_name: 'systems' },
            network8: { name: 'Сеть "Адвокат Дьявола"', short_name: 'advocate' },
            summarizer: { name: 'Сеть-Синтезатор', short_name: 'synthesizer' }
        };
    }

    async generateResponse(networkId, prompt, settings) {
        const network = this.networks[networkId] || settings.custom_networks[networkId];
        if (!network) throw new Error(`Сеть ${networkId} не найдена.`);

        let systemPrompt = (settings.custom_networks[networkId]?.system_prompt) || settings.system_prompts[networkId];
        systemPrompt += `\n\nВАЖНАЯ ИНСТРУКЦИЯ: Вы ДОЛЖНЫ отвечать ИСКЛЮЧИТЕЛЬНО на ${settings.discussion_language} языке. Не используйте другие языки.`;
        
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

        const maxRetries = 5;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const modelIdentifier = MODEL_MAP[settings.model];
                if (!modelIdentifier) {
                    throw new Error(`Модель "${settings.model}" не найдена. Проверьте MODEL_MAP.`);
                }

                const response = await axios.post(
                    OPENROUTER_API_URL,
                    {
                        model: modelIdentifier,
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
                
                const content = response.data.choices[0].message.content;
                if (!content || content.trim() === "") {
                    throw new Error("API вернул пустой ответ.");
                }
                return content.trim();

            } catch (error) {
                const errorData = error.response?.data?.error;
                
                if (error.response && error.response.status === 429) {
                    console.log(`Превышен лимит запросов. Попытка ${attempt}. Ожидание...`);
                    const waitTime = 5000 + Math.random() * 5000;
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    } else {
                        throw new Error(`Слишком много запросов к "${network.name}". Попробуйте позже.`);
                    }
                } else if (error.response && errorData && errorData.message && (errorData.message.includes('No endpoints found') || errorData.message.includes('currently overloaded') || errorData.message.includes('not a valid model ID'))) {
                    throw new Error(`Модель "${settings.model}" временно недоступна, перегружена или ее ID неверен. Пожалуйста, выберите другую модель в настройках.`);
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
                    { text: "Опиши это изображение в деталях. Что происходит, какие объекты присутствуют, каков контекст?" },
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
            model: 'GPT-4o (новейшая)',
            temperature: 0.7,
            max_tokens: 1500,
            discussion_language: 'Russian',
            iteration_count: 2,
            enabled_networks: ['network1', 'network2'],
            custom_networks: {},
            staged_files: [],
            system_prompts: {
                network1: 'Ты — Аналитическая Сеть. Фокусируйся на логике, данных и структурных рассуждениях.',
                network2: 'Ты — Креативная Сеть. Фокусируйся на новых идеях, альтернативах и инновационных перспективах.',
                network3: 'Ты — Сеть Реализации. Фокусируйся на практическом применении и технической осуществимости.',
                network4: 'Ты — Сеть Data Science. Фокусируйся на статистике, паттернах и эмпирических данных.',
                network5: 'Ты — Этическая Сеть. Фокусируйся на моральных последствиях и социальном влиянии.',
                network6: 'Ты — Сеть UX. Фокусируйся на пользовательском опыте и удобстве использования.',
                network7: 'Ты — Сеть Системного Мышления. Фокусируйся на целостном видении и взаимосвязях.',
                network8: 'Ты — Сеть "Адвокат Дьявола". Твоя роль — бросать вызов предположениям и проверять идеи на прочность.',
                summarizer: 'Ты — Сеть-Синтезатор. Твоя роль — прочитать дискуссию и составить краткое, нейтральное резюме ключевых моментов.'
            }
        };
    }

    resetProject() {
        this.iterations = 0;
        this.acceptedSummaries = [];
        this.isWorking = false;
        this.projectDescription = "";
    }

    async startCollaboration(topic) {
        if (this.isWorking) return this.sendMessage("Обсуждение уже идет. Используйте /stop или /reset.");
        if (this.settings.enabled_networks.length < 1) return this.sendMessage("❗️*Ошибка:* Включите хотя бы одну нейросеть в настройках.");

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;

        await this.sendMessage(`*Начинаю коллаборацию на тему:* "${topic}"\n\n_Чтобы остановить, используйте команду /stop_`);

        try {
            let fileContext = await this.processStagedFiles();
            this.settings.staged_files = [];

            await this.runDiscussionLoop(fileContext);
            if (this.isWorking) await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            await this.sendMessage(`❗️*Произошла критическая ошибка в процессе обсуждения:* ${error.message}`);
        } finally {
            this.isWorking = false;
        }
    }
    
    async processStagedFiles() {
        if (this.settings.staged_files.length === 0) return "";

        await this.sendMessage("📎 _Обрабатываю прикрепленные файлы..._");
        let context = "\n\n--- КОНТЕКСТ ИЗ ПРИКРЕПЛЕННЫХ ФАЙЛОВ ---\n";
        for (const file of this.settings.staged_files) {
            try {
                const tempDir = os.tmpdir();
                const filePath = await bot.downloadFile(file.file_id, tempDir);
                context += `\n**Файл: ${file.file_name}**\n`;

                if (file.mime_type.startsWith('image/')) {
                    const description = await this.networkManager.describeImage(filePath);
                    context += `[Описание содержимого изображения]:\n${description}\n`;
                } else if (file.mime_type === 'application/pdf') {
                    const data = await pdf(filePath);
                    context += `[Содержимое документа]:\n${data.text.substring(0, 4000)}...\n`;
                } else if (file.mime_type.includes('wordprocessingml')) {
                    const { value } = await mammoth.extractRawText({ path: filePath });
                    context += `[Содержимое документа]:\n${value.substring(0, 4000)}...\n`;
                } else {
                    const textContent = fs.readFileSync(filePath, 'utf-8');
                    context += `[Содержимое файла]:\n${textContent.substring(0, 4000)}...\n`;
                }
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`Ошибка обработки файла ${file.file_name}:`, e);
                context += `[Не удалось обработать файл: ${file.file_name}]\n`;
            }
        }
        context += "\n--- КОНЕЦ КОНТЕКСТА ИЗ ФАЙЛОВ ---\n";
        return context;
    }

    async runDiscussionLoop(fileContext) {
        while (this.iterations < this.settings.iteration_count) {
            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            this.iterations++;
            await this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.settings.iteration_count}* ---\n`);
            
            let iterationHistory = "";

            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                
                let prompt = `Главная тема: "${this.projectDescription}"\n\n`;
                if (fileContext) prompt += fileContext;
                if (this.acceptedSummaries.length > 0) {
                    prompt += `Вот принятые резюме из предыдущих раундов:\n${this.acceptedSummaries.map((s, i) => `Резюме ${i+1}: ${s}`).join('\n\n')}\n\n`;
                }
                prompt += `Вот ход обсуждения в текущем раунде:\n${iterationHistory}\n\n---\nКак ${networkName}, выскажи свою точку зрения.`;

                await this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings);
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                await this.sendMessage(`*${networkName}:*\n${response}`);
                
                iterationHistory += `\n\n**${networkName} сказал(а):**\n${response}`;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            await this.sendMessage(`📝 _Синтезатор анализирует и подводит итог..._`);
            const summaryPrompt = `Пожалуйста, создай краткое резюме ключевых моментов из следующего обсуждения:\n\n${iterationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings);
            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            await this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            await this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;

            const keywords = VOTE_KEYWORDS[this.settings.discussion_language] || VOTE_KEYWORDS['English'];
            const acceptRegex = new RegExp(`^${keywords.accept}`, 'i');

            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                const votePrompt = `Вот резюме для голосования:\n"${summary}"\n\nКак ${networkName}, принимаешь ли ты это резюме? Ответь ТОЛЬКО словом "${keywords.accept}" или "${keywords.reject}" на ${this.settings.discussion_language} языке, а затем кратко объясни причину.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings);
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                await this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                
                if (acceptRegex.test(voteResponse)) votesFor++; else votesAgainst++;
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            if (votesAgainst >= votesFor) {
                await this.sendMessage(`*Голосование провалено* (${votesFor} за, ${votesAgainst} против). Сводка отклонена. Продолжаем обсуждение.`);
            } else {
                await this.sendMessage(`*Голосование успешно!* (${votesFor} за, ${votesAgainst} против). Сводка принята.`);
                this.acceptedSummaries.push(summary);
            }
        }
    }

    async finalizeDevelopment() {
        if (this.acceptedSummaries.length === 0) {
            await this.sendMessage("\n\n--- 🏁 *Обсуждение завершено, но ни одна сводка не была принята.* ---");
            return;
        }
        await this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `На основе темы "${this.projectDescription}" и следующих принятых резюме, создай всеобъемлющий итоговый отчет. Он должен быть структурированным, подробным и представлять собой финальный результат работы. \n\nРезюме:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings);
        await this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}


if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_TOKEN и OPENROUTER_API_KEY должны быть указаны в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};
const activeRequests = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь и информация' },
    { command: '/run', description: '✍️ Начать новое обсуждение' },
    { command: '/stop', description: '🛑 Остановить генерацию' },
    { command: '/settings', description: '⚙️ Настройки бота' },
    { command: '/reset', description: '🗑 Сбросить всё' },
]);

async function sendLongMessage(chatId, text) {
    const maxLength = 4096;
    if (text.length <= maxLength) {
        return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch((e) => {
            console.warn("Ошибка отправки Markdown, пробую обычный текст:", e.message);
            return bot.sendMessage(chatId, text);
        });
    }

    const chunks = text.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, 'g')) || [];
    for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(async (e) => {
             console.warn("Ошибка отправки Markdown в чанке, пробую обычный текст:", e.message);
             await bot.sendMessage(chatId, chunk);
        });
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

function getOrCreateSession(chatId) {
    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => sendLongMessage(chatId, text));
    }
    return chatSessions[chatId];
}

console.log('Бот успешно запущен!');

const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [[{ text: '✍️ Новое Обсуждение' }, { text: '⚙️ Настройки' }]],
        resize_keyboard: true,
    },
};

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать!*
Я бот для совместной работы AI-личностей.

*Как начать:*
1. *(Опционально)* Прикрепите файлы (фото, документы), которые нейросети должны учесть.
2. Нажмите кнопку "✍️ Новое Обсуждение" или используйте команду /run и напишите тему.

*Команды:*
/run - Начать новое обсуждение
/settings - Показать и изменить настройки
/stop - Немедленно остановить текущее обсуждение
/reset - Сбросить все настройки и историю
    `;
    bot.sendMessage(msg.chat.id, welcomeText, { ...MAIN_KEYBOARD, parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text && !msg.document && !msg.photo) return;
    
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

    if (text && text.startsWith('/')) {
        return;
    }

    if (activeRequests[chatId]) {
        handleActiveRequest(chatId, msg);
        return;
    }

    if (text === '✍️ Новое Обсуждение') {
        bot.sendMessage(chatId, 'Какую тему вы хотите обсудить? Просто напишите ее в чат.');
        activeRequests[chatId] = { type: 'topic' };
    } else if (text === '⚙️ Настройки') {
        sendSettingsMessage(chatId);
    }
});

bot.onText(/\/run/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Какую тему вы хотите обсудить? Напишите ее следующим сообщением.');
    activeRequests[msg.chat.id] = { type: 'topic' };
});

bot.onText(/\/settings/, (msg) => {
    sendSettingsMessage(msg.chat.id);
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    delete activeRequests[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение, настройки и ожидание ответа сброшены.", MAIN_KEYBOARD);
});

bot.onText(/\/stop/, (msg) => {
    const session = chatSessions[msg.chat.id];
    if (session && session.isWorking) {
        session.isWorking = false;
        bot.sendMessage(msg.chat.id, "🛑 Получен сигнал остановки. Завершаю текущую операцию...");
    } else {
        bot.sendMessage(msg.chat.id, "Сейчас нет активного обсуждения, чтобы его останавливать.");
    }
});

const callbackQueryHandlers = {
    toggle: (session, value, chatId, messageId) => {
        const enabled = session.settings.enabled_networks;
        const index = enabled.indexOf(value);
        if (index > -1) {
            session.settings.enabled_networks.splice(index, 1);
        } else {
            session.settings.enabled_networks.push(value);
        }
        updateToggleMenu(chatId, messageId, session);
    },
    order: (session, value, chatId, messageId) => {
        const [direction, indexStr] = value.split('_');
        const index = parseInt(indexStr, 10);
        const order = session.settings.enabled_networks;

        if (direction === 'up' && index > 0) {
            [order[index], order[index - 1]] = [order[index - 1], order[index]];
        } else if (direction === 'down' && index < order.length - 1) {
            [order[index], order[index + 1]] = [order[index + 1], order[index]];
        } else if (direction === 'add') {
            const networkId = order[index];
            order.splice(index + 1, 0, networkId);
        } else if (direction === 'remove') {
            if (order.length > 0) { 
               order.splice(index, 1);
            }
        }
        updateOrderMenu(chatId, messageId, session);
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
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    settemp: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите следующим сообщением новое значение температуры (число от 0.0 до 2.0):`);
        activeRequests[chatId] = { type: 'temperature' };
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    settokens: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите следующим сообщением новый лимит токенов (число от 1 до 16000):`);
        activeRequests[chatId] = { type: 'max_tokens' };
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    menu: (session, value, chatId, messageId) => {
        const menuActions = {
            'toggle': updateToggleMenu,
            'order': updateOrderMenu,
            'model': updateModelMenu,
            'lang': updateLangMenu,
            'advanced': updateAdvancedMenu,
            'prompts': updatePromptsMenu,
            'custom': updateCustomNetworksMenu,
            'createnew': (chatId, messageId, session) => {
                if (Object.keys(session.settings.custom_networks).length >= 10) {
                    bot.answerCallbackQuery(query.id, { text: "Достигнут лимит в 10 кастомных нейросетей.", show_alert: true });
                } else {
                    bot.sendMessage(chatId, "Введите имя для вашей новой нейросети:");
                    activeRequests[chatId] = { type: 'custom_network_name' };
                    bot.deleteMessage(chatId, messageId).catch(()=>{});
                }
            }
        };
        if (menuActions[value]) menuActions[value](chatId, messageId, session);
    },
    back: (session, value, chatId, messageId) => {
        if (value === 'settings') {
             bot.deleteMessage(chatId, messageId).catch(()=>{});
             sendSettingsMessage(chatId);
        }
        if (value === 'advanced') updateAdvancedMenu(chatId, messageId, session);
    },
    close: (session, value, chatId, messageId) => {
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    }
};

bot.on('callback_query', (query) => {
    const { message, data } = query;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const session = getOrCreateSession(chatId);

    bot.answerCallbackQuery(query.id);

    const [action, ...valueParts] = data.split('_');
    const value = valueParts.join('_');

    if (callbackQueryHandlers[action]) {
        callbackQueryHandlers[action](session, value, chatId, messageId);
    }
});


function sendSettingsMessage(chatId) {
    const session = getOrCreateSession(chatId);
    const s = session.settings;
    const nm = session.networkManager;

    const enabledNetworks = s.enabled_networks
        .map(id => nm.networks[id]?.name || s.custom_networks[id]?.name)
        .join(', ') || 'Никто не включен';
    
    const settingsText = `*Текущие настройки для этого чата:*\n\n*Участники:* ${s.enabled_networks.length} реплик\n*Язык:* \`${s.discussion_language}\`\n*AI-Модель:* \`${s.model}\``;

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🕹 Участники', callback_data: 'menu_toggle' }, { text: '🔀 Порядок и Реплики', callback_data: 'menu_order' }],
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
    
    const standardButtons = Object.entries(networks).filter(([id]) => id !== 'summarizer').map(([id, net]) => {
        const isEnabled = enabled_networks.includes(id);
        return { text: `${isEnabled ? '✅' : '❌'} ${net.name}`, callback_data: `toggle_${id}` };
    });

    const customButtons = Object.entries(custom_networks).map(([id, net]) => {
        const isEnabled = enabled_networks.includes(id);
        return { text: `${isEnabled ? '✅' : '❌'} ${net.name} (моя)`, callback_data: `toggle_${id}` };
    });

    const allButtons = [...standardButtons, ...customButtons];
    
    const keyboard = [];
    for (let i = 0; i < allButtons.length; i += 2) {
        keyboard.push(allButtons.slice(i, i + 2));
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    bot.editMessageText('*Включите или выключите участников:*\n_✅/❌ переключает базовое участие сети в обсуждении._', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateOrderMenu(chatId, messageId, session) {
    const { enabled_networks, custom_networks } = session.settings;
    const { networks } = session.networkManager;

    if (enabled_networks.length < 1) {
        bot.editMessageText('*Нет включенных участников для сортировки.*\n\nВключите хотя бы одну сеть в меню "Участники".', {
             chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
             reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back_settings' }]] }
        }).catch(()=>{});
        return;
    }

    const keyboard = enabled_networks.map((networkId, index) => {
        const networkName = networks[networkId]?.name || custom_networks[networkId]?.name;
        const upArrow = (index > 0) ? { text: '🔼', callback_data: `order_up_${index}` } : { text: ' ', callback_data: 'no_op' };
        const downArrow = (index < enabled_networks.length - 1) ? { text: '🔽', callback_data: `order_down_${index}` } : { text: ' ', callback_data: 'no_op' };
        
        return [
            upArrow, 
            { text: networkName, callback_data: 'no_op' }, 
            downArrow,
            { text: '➕', callback_data: `order_add_${index}` },
            { text: '➖', callback_data: `order_remove_${index}` }
        ];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    const menuText = `*Измените порядок и количество реплик:*\n\n` +
                     `🔼/🔽 - изменить порядок\n` +
                     `➕ - дублировать нейросеть для еще одной реплики\n` +
                     `➖ - удалить реплику из списка`;

    bot.editMessageText(menuText, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateModelMenu(chatId, messageId, session) {
    const keyboard = AVAILABLE_MODELS.map(modelName => ([{ text: `${modelName === session.settings.model ? '🔘' : '⚪️'} ${modelName}`, callback_data: `setmodel_${modelName}` }]));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Выберите AI-модель для всех нейросетей:*\n\n_Модели с пометкой (free) не расходуют ваш баланс на OpenRouter._', {
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
    const text = `*Продвинутые настройки:*\n\n- *Итерации:* \`${s.iteration_count}\` (циклов обсуждения)\n- *Температура:* \`${s.temperature}\` (креативность)\n- *Макс. токенов:* \`${s.max_tokens}\` (длина ответа)`;
    
    const iterationButtons = [1, 2, 3, 4, 5].map(i => ({
        text: `${s.iteration_count === i ? '🔘' : '⚪️'} ${i}`,
        callback_data: `setiterations_${i}`
    }));

    const keyboard = [
        iterationButtons,
        [{ text: '🌡️ Температура', callback_data: 'settemp_ ' }, { text: '📄 Макс. токенов', callback_data: 'settokens_ ' }],
        [{ text: '🎭 Личности сетей', callback_data: 'menu_prompts' }],
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
    buttons.push([{ text: '⬅️ Назад', callback_data: 'back_advanced' }]);
    bot.editMessageText('*Выберите нейросеть для изменения ее системного промпта (личности):*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
}

function updateCustomNetworksMenu(chatId, messageId, session) {
    const { custom_networks } = session.settings;
    const text = Object.keys(custom_networks).length > 0
        ? '*Ваши кастомные нейросети:*\nВыберите для редактирования или удаления.'
        : '*У вас пока нет кастомных нейросетей.*';
    
    const keyboard = Object.entries(custom_networks).map(([id, net]) => ([
        { text: net.name, callback_data: `editcustom_${id}` },
        { text: '🗑', callback_data: `deletecustom_${id}` }
    ]));
    keyboard.push([{ text: '➕ Создать новую', callback_data: 'menu_createnew' }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);

    bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}


const activeRequestHandlers = {
    'topic': (session, text, chatId) => {
        if (!text || text.trim().length < 5) {
            bot.sendMessage(chatId, '❌ Тема слишком короткая. Пожалуйста, опишите задачу подробнее.');
            activeRequests[chatId] = { type: 'topic' };
            return;
        }
        session.startCollaboration(text.trim());
    },
    'temperature': (session, text, chatId) => {
        const temp = parseFloat(text.replace(',', '.'));
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
        if (!isNaN(tokens) && tokens > 0 && tokens <= 16000) {
            session.settings.max_tokens = tokens;
            bot.sendMessage(chatId, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Ошибка. Введите целое число от 1 до 16000.');
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
        if (!text || text.trim().length < 3) {
             bot.sendMessage(chatId, '❌ Имя слишком короткое. Попробуйте еще раз.');
             activeRequests[chatId] = { type: 'custom_network_name' };
             return;
        }
        const newId = `custom${Date.now()}`;
        activeRequests[chatId] = { type: 'custom_network_prompt', id: newId, name: text.trim() };
        bot.sendMessage(chatId, `Отлично! Теперь введите системный промпт (личность) для "${text.trim()}":`);
    },
    'custom_network_prompt': (session, text, chatId, request) => {
        if (!text || text.trim().length < 10) {
             bot.sendMessage(chatId, '❌ Промпт слишком короткий. Опишите личность подробнее.');
             activeRequests[chatId] = request;
             return;
        }
        request.prompt = text;
        
        session.settings.custom_networks[request.id] = {
            name: request.name,
            short_name: request.name.toLowerCase().replace(/\s/g, '').substring(0, 8),
            system_prompt: request.prompt,
            temperature: session.settings.temperature,
            max_tokens: session.settings.max_tokens
        };
        
        if (!session.settings.enabled_networks.includes(request.id)) {
            session.settings.enabled_networks.push(request.id);
        }

        bot.sendMessage(chatId, `✅ Новая нейросеть "${request.name}" успешно создана и включена!`);
        delete activeRequests[chatId];
        sendSettingsMessage(chatId);
    }
};

function handleActiveRequest(chatId, msg) {
    const request = activeRequests[chatId];
    if (!request) return;

    const session = getOrCreateSession(chatId);
    const text = msg.text;

    if (!text) {
        bot.sendMessage(chatId, "Пожалуйста, пришлите ответ в виде текста.");
        return;
    }

    const handler = activeRequestHandlers[request.type];
    if (handler) {
        if (!request.type.startsWith('custom_network_') || request.type === 'custom_network_prompt') {
            delete activeRequests[chatId];
        }
        handler(session, text, chatId, request);
    }
}

bot.on('polling_error', (error) => {
    if (error.code !== 'ETELEGRAM' || !error.message.includes('409 Conflict')) {
        console.error(`Ошибка Polling: [${error.code}] ${error.message}`);
    }
});

const app = express();
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, () => console.log(`Веб-сервер для проверки работоспособности запущен на порту ${PORT}`));
