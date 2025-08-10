require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- ЗАГРУЗКА КЛЮЧЕЙ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
    throw new Error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN и OPENROUTER_API_KEY должны быть указаны!");
}

// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;
const FALLBACK_MODEL_ID = 'meta-llama/llama-3-8b-instruct:free'; // Надежная бесплатная резервная модель

// --- СПИСОК МОДЕЛЕЙ ---
const MODEL_MAP = {
    'GPT-4o': 'openai/gpt-4o',
    'GPT-4 Turbo': 'openai/gpt-4-turbo',
    'Llama 3 70B': 'meta-llama/llama-3-70b-instruct',
    'Claude 3.5 Sonnet': 'anthropic/claude-3.5-sonnet',
    'Gemini Pro 1.5': 'google/gemini-pro-1.5',
    'Llama 3 8B (Free)': 'meta-llama/llama-3-8b-instruct:free',
    'Mistral 7B (Free)': 'mistralai/mistral-7b-instruct:free',
};
const AVAILABLE_MODELS = Object.keys(MODEL_MAP);

const VOTE_KEYWORDS = { 'Russian': { accept: 'принимаю', reject: 'отклоняю' } };

// =========================================================================
// === УЛЬТРА-УСТОЙЧИВЫЙ К ОШИБКАМ NETWORK MANAGER ===
// =========================================================================
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

    async generateResponse(networkId, prompt, settings, sendMessageCallback) {
        const network = this.networks[networkId] || settings.custom_networks[networkId];
        if (!network) throw new Error(`Сеть ${networkId} не найдена.`);

        const systemPrompt = (settings.custom_networks[networkId]?.system_prompt) || settings.system_prompts[networkId] +
            `\n\nВАЖНАЯ ИНСТРУКЦИЯ: Вы ДОЛЖНЫ отвечать ИСКЛЮЧИТЕЛЬНО на ${settings.discussion_language} языке.`;
        
        let originalModelName = settings.model;
        let modelIdentifier = MODEL_MAP[originalModelName];
        let currentMaxTokens = settings.custom_networks[networkId]?.max_tokens || settings.max_tokens;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(
                    OPENROUTER_API_URL,
                    {
                        model: modelIdentifier,
                        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
                        temperature: settings.custom_networks[networkId]?.temperature || settings.temperature,
                        max_tokens: currentMaxTokens,
                    },
                    { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` } }
                );
                
                const content = response.data.choices[0].message.content;
                if (!content || content.trim() === "") throw new Error("API вернул пустой ответ.");
                
                return content.trim();

            } catch (error) {
                const errorMessage = error.response?.data?.error?.message || error.message || "Неизвестная ошибка";
                console.error(`Попытка ${attempt} для "${network.name}" не удалась. Ошибка: ${errorMessage}`);

                // НОВОЕ ПРАВИЛО: Закончились кредиты
                if (errorMessage.includes('Insufficient credits')) {
                    console.log(`У модели ${modelIdentifier} закончились кредиты. Переключаюсь на резервную модель: ${FALLBACK_MODEL_ID}`);
                    modelIdentifier = FALLBACK_MODEL_ID;
                    if (sendMessageCallback) {
                        await sendMessageCallback(`_(У модели "${originalModelName}" закончились кредиты. Автоматически переключаюсь на бесплатную резервную модель...)_`);
                    }
                    continue; // Сразу переходим к следующей попытке с бесплатной моделью
                }
                
                // ПРАВИЛО 2: Не хватает токенов
                if (errorMessage.includes('can only afford')) {
                    const match = errorMessage.match(/can only afford (\d+)/);
                    if (match && match[1]) {
                        const affordableTokens = parseInt(match[1], 10) - 20;
                        if (affordableTokens > 0) {
                            console.log(`Автоматически снижаю лимит токенов до ${affordableTokens}`);
                            currentMaxTokens = affordableTokens;
                            if (sendMessageCallback) await sendMessageCallback(`_(${network.name}: лимит токенов исчерпан, автоматически уменьшаю ответ...)_`);
                            continue;
                        }
                    }
                }

                // ПРАВИЛО 3: Модель временно недоступна
                if (errorMessage.includes('No endpoints found')) {
                    console.log(`Модель ${modelIdentifier} недоступна. Переключаюсь на резервную модель: ${FALLBACK_MODEL_ID}`);
                    modelIdentifier = FALLBACK_MODEL_ID;
                    if (sendMessageCallback) await sendMessageCallback(`_(Модель "${originalModelName}" временно недоступна, автоматически переключаюсь на резервную...)_`);
                    continue;
                }

                if (attempt === MAX_RETRIES) {
                    throw new Error(`Не удалось получить ответ от "${network.name}" после ${MAX_RETRIES} попыток: ${errorMessage}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
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
            model: 'Llama 3 8B (Free)',
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
            let fileContext = "";
            this.settings.staged_files = [];
            await this.runDiscussionLoop(fileContext);
            if (this.isWorking) await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            await this.sendMessage(`❗️*Произошла критическая ошибка:* ${error.message}`);
        } finally {
            this.isWorking = false;
        }
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
            const summaryPrompt = `Пожалуйста, создай краткое резюме ключевых моментов из следующего обсуждения:\n\n${iterationHistory}`;
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
            await this.sendMessage("\n\n--- 🏁 *Обсуждение завершено, но ни одна сводка не была принята.* ---");
            return;
        }
        await this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `На основе темы "${this.projectDescription}" и следующих принятых резюме, создай всеобъемлющий итоговый отчет. \n\nРезюме:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt, this.settings, this.sendMessage);
        await this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}


const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};
const activeRequests = {};

bot.setMyCommands([
    { command: '/start', description: '🚀 Помощь' },
    { command: '/run', description: '✍️ Новое обсуждение' },
    { command: '/stop', description: '🛑 Остановить' },
    { command: '/settings', description: '⚙️ Настройки' },
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
    bot.sendMessage(msg.chat.id, `*Добро пожаловать!*\nЯ бот для совместной работы AI-личностей.`, { ...MAIN_KEYBOARD, parse_mode: 'Markdown' });
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

bot.onText(/\/run/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Какую тему вы хотите обсудить?');
    activeRequests[msg.chat.id] = { type: 'topic' };
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
        bot