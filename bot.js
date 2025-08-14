require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- ЗАГРУЗКА И РОТАЦИЯ КЛЮЧЕЙ OPENROUTER ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;

const OPENROUTER_KEYS = [];
for (let i = 1; i <= 5; i++) { // Ищем до 5 ключей
    const key = process.env[`OPENROUTER_KEY${i}`];
    if (key) OPENROUTER_KEYS.push(key);
}

if (!TELEGRAM_TOKEN) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN не указан!");
if (OPENROUTER_KEYS.length === 0) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: Не найден ни один ключ OpenRouter (OPENROUTER_KEY1..5)!");
if (!WEB_APP_URL) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: Не указан WEB_APP_URL в переменных окружения!");

console.log(`Бот запущен. Обнаружено ключей OpenRouter: ${OPENROUTER_KEYS.length}`);

// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = OPENROUTER_KEYS.length + 2;
const FALLBACK_MODEL_ID = 'meta-llama/llama-3-8b-instruct:free';

// --- ВОССТАНОВЛЕННЫЙ СПИСОК МОДЕЛЕЙ ---
const MODEL_MAP = {
    'GPT-4o (новейшая)': 'openai/gpt-4o',
    'GPT-4 Turbo': 'openai/gpt-4-turbo',
    'Qwen 2 72B Instruct': 'qwen/qwen-2-72b-instruct', // Замена для Gemini 2.0
    'Llama 3 70B': 'meta-llama/llama-3-70b-instruct',
    'Claude 3.5 Sonnet': 'anthropic/claude-3.5-sonnet',
    'Deepseek V2': 'deepseek/deepseek-chat',
    'Kimi K2': 'moonshotai/kimi-k2:free',
    'Llama 3 8B (Free)': 'meta-llama/llama-3-8b-instruct:free',
    'Mistral 7B (Free)': 'mistralai/mistral-7b-instruct:free',
};
const AVAILABLE_MODELS = Object.keys(MODEL_MAP);
const VOTE_KEYWORDS = { 'Russian': { accept: 'принимаю', reject: 'отклоняю' } };

// =========================================================================
// === NETWORK MANAGER С РОТАЦИЕЙ КЛЮЧЕЙ И АВТО-ИСПРАВЛЕНИЕМ ===
// =========================================================================
class NetworkManager {
    constructor() {
        this.currentKeyIndex = 0;
        this.networks = {
            network1: { name: 'Аналитическая Сеть' },
            network2: { name: 'Креативная Сеть' },
            network3: { name: 'Сеть Реализации' },
            network4: { name: 'Сеть Data Science' },
            network5: { name: 'Этическая Сеть' },
            network6: { name: 'Сеть UX' },
            network7: { name: 'Сеть Системного Мышления' },
            network8: { name: 'Сеть "Адвокат Дьявола"' },
            summarizer: { name: 'Сеть-Синтезатор' }
        };
    }

    _getNextKey() {
        const index = this.currentKeyIndex;
        const key = OPENROUTER_KEYS[index];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % OPENROUTER_KEYS.length;
        console.log(`Использую ключ #${index + 1}/${OPENROUTER_KEYS.length}`);
        return { key, index };
    }

    async generateResponse(networkId, prompt, settings, sendMessageCallback) {
        const network = this.networks[networkId] || settings.custom_networks[networkId];
        if (!network) throw new Error(`Сеть ${networkId} не найдена.`);
        const systemPrompt = ((settings.custom_networks[networkId]?.system_prompt) || settings.system_prompts[networkId]) +
            `\n\nВАЖНАЯ ИНСТРУКЦИЯ: Вы ДОЛЖНЫ отвечать ИСКЛЮЧИТЕЛЬНО на ${settings.discussion_language} языке.`;
        let originalModelName = settings.model;
        let modelIdentifier = MODEL_MAP[originalModelName];
        let currentMaxTokens = settings.custom_networks[networkId]?.max_tokens || settings.max_tokens;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const { key: currentKey, index: keyIndex } = this._getNextKey();
            try {
                const response = await axios.post(
                    OPENROUTER_API_URL,
                    {
                        model: modelIdentifier,
                        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
                        temperature: settings.temperature,
                        max_tokens: currentMaxTokens,
                    },
                    { headers: { 'Authorization': `Bearer ${currentKey}` } }
                );
                
                const content = response.data.choices[0].message.content;
                if (!content || content.trim().length < 5 || /[\u{FFFD}]/u.test(content)) {
                    throw new Error("API вернул некорректный или пустой ответ.");
                }
                return content.trim();
            } catch (error) {
                const errorMessage = error.response?.data?.error?.message || error.message || "Неизвестная ошибка";
                console.error(`Попытка ${attempt} с ключом #${keyIndex + 1} не удалась: ${errorMessage}`);
                if (errorMessage.includes('Insufficient credits')) {
                    if (sendMessageCallback) await sendMessageCallback(`_(API ключ #${keyIndex + 1} исчерпан, пробую следующий...)_`);
                    continue;
                }
                if (errorMessage.includes('can only afford')) {
                    const match = errorMessage.match(/can only afford (\d+)/);
                    if (match && match[1]) {
                        const affordableTokens = parseInt(match[1], 10) - 20;
                        if (affordableTokens > 0) {
                            currentMaxTokens = affordableTokens;
                            this.currentKeyIndex = keyIndex;
                            if (sendMessageCallback) await sendMessageCallback(`_(${network.name}: немного не хватает лимита, уменьшаю ответ...)_`);
                            continue;
                        }
                    }
                }
                if (errorMessage.includes('No endpoints found')) {
                    modelIdentifier = FALLBACK_MODEL_ID;
                    if (sendMessageCallback) await sendMessageCallback(`_(Модель "${originalModelName}" временно недоступна, переключаюсь на резервную...)_`);
                    continue;
                }
                if (attempt === MAX_RETRIES) throw new Error(`Не удалось получить ответ от "${network.name}" после перебора всех ключей: ${errorMessage}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
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
            model: 'Llama 3 8B (Free)', // Хорошая бесплатная модель по умолчанию
            temperature: 0.7,
            max_tokens: 1500,
            discussion_language: 'Russian',
            iteration_count: 2,
            enabled_networks: ['network1', 'network2'],
            custom_networks: {},
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
        if (this.isWorking) return this.sendMessage("Обсуждение уже идет. Используйте /stop.");
        if (this.settings.enabled_networks.length < 1) return this.sendMessage("❗️*Ошибка:* Включите хотя бы одну нейросеть.");
        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;
        await this.sendMessage(`*Начинаю коллаборацию на тему:* "${topic}"\n\n_Чтобы остановить, используйте команду /stop_`);
        try {
            await this.runDiscussionLoop();
            if (this.isWorking) await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            await this.sendMessage(`❗️*Произошла критическая ошибка:* ${error.message}`);
        } finally {
            this.isWorking = false;
        }
    }
    
    // --- ПОЛНОСТЬЮ ВОССТАНОВЛЕННЫЙ ЦИКЛ ОБСУЖДЕНИЯ С ГОЛОСОВАНИЕМ ---
    async runDiscussionLoop() {
        while (this.iterations < this.settings.iteration_count) {
            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            this.iterations++;
            await this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.settings.iteration_count}* ---\n`);
            let iterationHistory = "";
            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                let prompt = `Главная тема: "${this.projectDescription}"\n\n`;
                if (this.acceptedSummaries.length > 0) {
                    prompt += `Вот принятые резюме из предыдущих раундов:\n${this.acceptedSummaries.map((s, i) => `Резюме ${i+1}: ${s}`).join('\n\n')}\n\n`;
                }
                prompt += `Вот ход обсуждения в текущем раунде:\n${iterationHistory}\n\n---\nКак ${networkName}, выскажи свою точку зрения.`;
                await this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings, this.sendMessage);
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                await this.sendMessage(`*${networkName}:*\n${response}`);
                iterationHistory += `\n\n**${networkName} сказал(а):**\n${response}`;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            await this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summaryPrompt = `Создай краткое резюме из обсуждения:\n\n${iterationHistory}`;
            const summary = await this.networkManager.generateResponse('summarizer', summaryPrompt, this.settings, this.sendMessage);
            if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
            await this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            
            await this.sendMessage(`🗳️ _Проводим голосование по сводке..._`);
            let votesFor = 0;
            let votesAgainst = 0;
            const keywords = VOTE_KEYWORDS[this.settings.discussion_language] || VOTE_KEYWORDS['Russian'];
            const acceptRegex = new RegExp(`^${keywords.accept}`, 'i');

            for (const networkId of this.settings.enabled_networks) {
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                const networkName = this.networkManager.networks[networkId]?.name || this.settings.custom_networks[networkId]?.name;
                const votePrompt = `Вот резюме для голосования:\n"${summary}"\n\nКак ${networkName}, принимаешь ли ты это резюме? Ответь ТОЛЬКО словом "${keywords.accept}" или "${keywords.reject}" на ${this.settings.discussion_language} языке, а затем кратко объясни причину.`;
                const voteResponse = await this.networkManager.generateResponse(networkId, votePrompt, this.settings, this.sendMessage);
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                await this.sendMessage(`*${networkName} голосует:*\n${voteResponse}`);
                if (acceptRegex.test(voteResponse)) votesFor++; else votesAgainst++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (votesAgainst >= votesFor) {
                await this.sendMessage(`*Голосование провалено* (${votesFor} за, ${votesAgainst} против). Сводка отклонена.`);
            } else {
                await this.sendMessage(`*Голосование успешно!* (${votesFor} за, ${votesAgainst} против). Сводка принята.`);
                this.acceptedSummaries.push(summary);
            }
        }
    }

    async finalizeDevelopment() {
        if (this.acceptedSummaries.length === 0) {
            await this.sendMessage("\n\n--- 🏁 *Обсуждение завершено без принятых сводок.* ---");
            return;
        }
        await this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `На основе темы "${this.projectDescription}" и резюме, создай итоговый отчет.\n\nРезюме:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings, this.sendMessage);
        await this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};
const activeRequests = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь и запуск' },
    { command: '/stop', description: '🛑 Остановить' },
    { command: '/settings', description: '⚙️ Настройки в чате' },
    { command: '/reset', description: '🗑 Сброс' },
]);

async function sendLongMessage(chatId, text) {
    const maxLength = 4096;
    if (text.length <= maxLength) {
        return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(chatId, text));
    }
    const chunks = text.match(new RegExp(`[\\s\\S]{1,${maxLength}}`, 'g')) || [];
    for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(chatId, chunk));
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

function getOrCreateSession(chatId) {
    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => sendLongMessage(chatId, text));
    }
    return chatSessions[chatId];
}

const MAIN_KEYBOARD = { reply_markup: { keyboard: [[{ text: '✍️ Новое Обсуждение' }, { text: '⚙️ Настройки' }]], resize_keyboard: true } };

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать в Neural Collaborative Framework!*

Этот бот позволяет организовывать совместную работу нескольких AI-личностей (нейросетей) для решения сложных задач.

*Как это работает:*
1.  Нажмите кнопку *🚀 Открыть Панель Управления* ниже.
2.  В открывшемся веб-приложении опишите вашу задачу или тему для обсуждения.
3.  Настройте параметры коллаборации: выберите, какие нейросети будут участвовать, сколько циклов (итераций) они должны пройти, и другие AI-настройки.
4.  Нажмите *"Start Collaboration"*.

Бот начнет симуляцию диалога прямо в этом чате. Нейросети будут по очереди высказывать свои мнения, а в конце каждой итерации специальная сеть-синтезатор будет подводить итог, по которому пройдет голосование.

*Основные команды:*
/start - Показать это сообщение и кнопку запуска.
/stop - Принудительно остановить текущую коллаборацию.
/settings - Открыть меню настроек прямо в чате (альтернатива Web App).
/reset - Сбросить все настройки для этого чата.
    `;

    bot.sendMessage(msg.chat.id, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 Открыть Панель Управления", web_app: { url: WEB_APP_URL } }]
            ]
        }
    });
});

bot.on('web_app_data', (msg) => {
    try {
        const chatId = msg.chat.id;
        const data = JSON.parse(msg.web_app_data.data);
        console.log(`Получены данные из Web App от ${chatId}:`, data);
        const session = getOrCreateSession(chatId);
        
        session.settings.model = data.model || session.settings.model;
        session.settings.iteration_count = data.iterations || session.settings.iteration_count;
        session.settings.enabled_networks = data.enabled_networks || session.settings.enabled_networks;
        session.settings.temperature = data.temperature || session.settings.temperature;
        session.settings.max_tokens = data.max_tokens || session.settings.max_tokens;
        
        session.startCollaboration(data.topic);
    } catch (error) {
        console.error("Ошибка обработки данных из Web App:", error);
        bot.sendMessage(msg.chat.id, "Произошла ошибка при обработке вашего запроса из панели управления.");
    }
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text && text.startsWith('/')) return;
    if (activeRequests[chatId]) {
        handleActiveRequest(chatId, msg);
        return;
    }
    if (text === '✍️ Новое Обсуждение') {
        bot.sendMessage(chatId, 'Какую тему вы хотите обсудить?');
        activeRequests[chatId] = { type: 'topic' };
    } else if (text === '⚙️ Настройки') {
        sendSettingsMessage(chatId);
    }
});

bot.onText(/\/settings/, (msg) => sendSettingsMessage(msg.chat.id));
bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    delete activeRequests[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены.", MAIN_KEYBOARD);
});
bot.onText(/\/stop/, (msg) => {
    const session = chatSessions[msg.chat.id];
    if (session && session.isWorking) {
        session.isWorking = false;
        bot.sendMessage(msg.chat.id, "🛑 Получен сигнал остановки...");
    } else {
        bot.sendMessage(msg.chat.id, "Сейчас нет активного обсуждения.");
    }
});

const callbackQueryHandlers = {
    toggle: (session, value, chatId, messageId) => {
        const enabled = session.settings.enabled_networks;
        const index = enabled.indexOf(value);
        if (index > -1) {
            enabled.splice(index, 1);
        } else {
            enabled.push(value);
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
            if (order.length > 0) order.splice(index, 1);
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
        bot.sendMessage(chatId, `Пришлите новый системный промпт для "${networkName}":`);
        activeRequests[chatId] = { type: 'system_prompt', networkId: value };
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    settemp: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите новое значение температуры (число от 0.0 до 2.0):`);
        activeRequests[chatId] = { type: 'temperature' };
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    settokens: (session, value, chatId, messageId) => {
        bot.sendMessage(chatId, `Пришлите новый лимит токенов (число от 1 до 4096):`);
        activeRequests[chatId] = { type: 'max_tokens' };
        bot.deleteMessage(chatId, messageId).catch(()=>{});
    },
    menu: (session, value, chatId, messageId) => {
        const menuActions = {
            'toggle': updateToggleMenu, 'order': updateOrderMenu, 'model': updateModelMenu,
            'lang': updateLangMenu, 'advanced': updateAdvancedMenu, 'prompts': updatePromptsMenu,
            'custom': updateCustomNetworksMenu,
            'createnew': (chatId, messageId, session) => {
                bot.sendMessage(chatId, "Введите имя для новой нейросети:");
                activeRequests[chatId] = { type: 'custom_network_name' };
                bot.deleteMessage(chatId, messageId).catch(()=>{});
            }
        };
        if (menuActions[value]) menuActions[value](chatId, messageId, session);
    },
    back: (session, value, chatId, messageId) => {
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        if (value === 'settings') sendSettingsMessage(chatId);
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
    const settingsText = `*Текущие настройки:*\n\n*Участники:* ${s.enabled_networks.length} реплик\n*Язык:* \`${s.discussion_language}\`\n*AI-Модель:* \`${s.model}\``;
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
    for (let i = 0; i < allButtons.length; i += 2) keyboard.push(allButtons.slice(i, i + 2));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Включите или выключите участников:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateOrderMenu(chatId, messageId, session) {
    const { enabled_networks, custom_networks } = session.settings;
    const { networks } = session.networkManager;
    if (enabled_networks.length < 1) {
        bot.editMessageText('*Нет включенных участников для сортировки.*', {
             chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
             reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back_settings' }]] }
        }).catch(()=>{});
        return;
    }
    const keyboard = enabled_networks.map((networkId, index) => {
        const networkName = networks[networkId]?.name || custom_networks[networkId]?.name;
        const upArrow = (index > 0) ? { text: '🔼', callback_data: `order_up_${index}` } : { text: ' ', callback_data: 'no_op' };
        const downArrow = (index < enabled_networks.length - 1) ? { text: '🔽', callback_data: `order_down_${index}` } : { text: ' ', callback_data: 'no_op' };
        return [{ text: networkName, callback_data: 'no_op' }, upArrow, downArrow, { text: '➕', callback_data: `order_add_${index}` }, { text: '➖', callback_data: `order_remove_${index}` }];
    });
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText(`*Измените порядок и количество реплик:*`, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateModelMenu(chatId, messageId, session) {
    const keyboard = AVAILABLE_MODELS.map(modelName => ([{ text: `${modelName === session.settings.model ? '🔘' : '⚪️'} ${modelName}`, callback_data: `setmodel_${modelName}` }]));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Выберите AI-модель:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateLangMenu(chatId, messageId, session) {
    const languages = ['Russian', 'English', 'German', 'French', 'Ukrainian'];
    const keyboard = languages.map(lang => ([{ text: `${lang === session.settings.discussion_language ? '🔘' : '⚪️'} ${lang}`, callback_data: `setlang_${lang}` }]));
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText('*Выберите язык общения:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updateAdvancedMenu(chatId, messageId, session) {
    const s = session.settings;
    const text = `*Продвинутые настройки:*\n\n- *Итерации:* \`${s.iteration_count}\`\n- *Температура:* \`${s.temperature}\`\n- *Макс. токенов:* \`${s.max_tokens}\``;
    const iterationButtons = [1, 2, 3, 4, 5].map(i => ({
        text: `${s.iteration_count === i ? '🔘' : '⚪️'} ${i}`, callback_data: `setiterations_${i}`
    }));
    const keyboard = [
        iterationButtons,
        [{ text: '🌡️ Температура', callback_data: 'settemp_ ' }, { text: '📄 Макс. токенов', callback_data: 'settokens_ ' }],
        [{ text: '🎭 Личности сетей', callback_data: 'menu_prompts' }],
        [{ text: '⬅️ Назад', callback_data: 'back_settings' }]
    ];
    bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

function updatePromptsMenu(chatId, messageId, session) {
    const allNetworks = { ...session.networkManager.networks, ...session.settings.custom_networks };
    const buttons = Object.entries(allNetworks).map(([id, net]) => ([{ text: net.name, callback_data: `promptfor_${id}` }]));
    buttons.push([{ text: '⬅️ Назад', callback_data: 'back_advanced' }]);
    bot.editMessageText('*Выберите нейросеть для изменения ее личности:*', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
}

function updateCustomNetworksMenu(chatId, messageId, session) {
    const { custom_networks } = session.settings;
    const text = Object.keys(custom_networks).length > 0 ? '*Ваши кастомные нейросети:*' : '*У вас нет кастомных нейросетей.*';
    const keyboard = Object.entries(custom_networks).map(([id, net]) => ([
        { text: net.name, callback_data: `editcustom_${id}` },
        { text: '🗑', callback_data: `deletecustom_${id}` }
    ]));
    keyboard.push([{ text: '➕ Создать новую', callback_data: 'menu_createnew' }]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'back_settings' }]);
    bot.editMessageText(text, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard }
    }).catch(() => {});
}

const activeRequestHandlers = {
    'topic': (session, text, chatId) => {
        if (!text || text.trim().length < 5) {
            bot.sendMessage(chatId, '❌ Тема слишком короткая.');
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
        if (!isNaN(tokens) && tokens > 0 && tokens <= 4096) {
            session.settings.max_tokens = tokens;
            bot.sendMessage(chatId, `✅ Лимит токенов установлен на: \`${tokens}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Ошибка. Введите целое число от 1 до 4096.');
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
        activeRequests[chatId] = { type: 'custom_network_prompt', id: newId, name: text.trim() };
        bot.sendMessage(chatId, `Отлично! Теперь введите системный промпт для "${text.trim()}":`);
    },
    'custom_network_prompt': (session, text, chatId, request) => {
        session.settings.custom_networks[request.id] = {
            name: request.name,
            short_name: request.name.toLowerCase().replace(/\s/g, '').substring(0, 8),
            system_prompt: text,
            temperature: session.settings.temperature,
            max_tokens: session.settings.max_tokens
        };
        if (!session.settings.enabled_networks.includes(request.id)) {
            session.settings.enabled_networks.push(request.id);
        }
        bot.sendMessage(chatId, `✅ Новая нейросеть "${request.name}" создана!`);
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
        bot.sendMessage(chatId, "Пожалуйста, ответьте текстом.");
        return;
    }
    const handler = activeRequestHandlers[request.type];
    if (handler) {
        delete activeRequests[chatId];
        handler(session, text, chatId, request);
    }
}

const app = express();
const PORT = process.env.PORT || 3000; 
const HOST = '0.0.0.0';
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, HOST, () => {
    console.log(`Веб-сервер для health check УСПЕШНО запущен и слушает ${HOST}:${PORT}`);
});