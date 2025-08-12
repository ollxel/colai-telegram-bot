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
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

const OPENROUTER_KEYS = [];
for (let i = 1; i <= 10; i++) { // Ищем до 10 ключей
    const key = process.env[`OPENROUTER_KEY${i}`];
    if (key) OPENROUTER_KEYS.push(key);
    else break;
}

if (!TELEGRAM_TOKEN) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN не указан!");
if (OPENROUTER_KEYS.length === 0) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: Не найден ни один ключ OpenRouter (OPENROUTER_KEY1, и т.д.)!");
if (!WEB_APP_URL) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: Не указан WEB_APP_URL в переменных окружения!");

console.log(`Бот запущен. Обнаружено ключей OpenRouter: ${OPENROUTER_KEYS.length}`);

// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = OPENROUTER_KEYS.length + 2; // Даем больше попыток, чем ключей
const FALLBACK_MODEL_ID = 'meta-llama/llama-3-8b-instruct:free';

// --- СПИСОК МОДЕЛЕЙ ---
const MODEL_MAP = {
    'GPT-4o (новейшая)': 'openai/gpt-4o',
    'GPT-4 Turbo': 'openai/gpt-4-turbo',
    'GPT-3.5 Turbo (free)': 'openai/gpt-3.5-turbo:free',
    'Grok Llama3 8B': 'grok/llama3-8b',
    'Grok Llama3 70B': 'grok/llama3-70b',
    'Claude 3.5 Sonnet (новейшая)': 'anthropic/claude-3.5-sonnet',
    'Claude 3 Opus': 'anthropic/claude-3-opus',
    'Claude 3 Haiku': 'anthropic/claude-3-haiku',
    'Gemini Pro 1.5': 'google/gemini-pro-1.5',
    'Gemini Flash 1.5': 'google/gemini-flash-1.5',
    'Gemini Pro (free)': 'google/gemini-pro:free',
    'Llama 3 70B': 'meta-llama/llama-3-70b-instruct',
    'Llama 3 8B (free)': 'meta-llama/llama-3-8b-instruct:free',
    'Mistral Large': 'mistralai/mistral-large',
    'Mistral 7B (free)': 'mistralai/mistral-7b-instruct:free'
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

    _getNextKey() {
        const key = OPENROUTER_KEYS[this.currentKeyIndex];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % OPENROUTER_KEYS.length;
        console.log(`Использую ключ #${this.currentKeyIndex === 0 ? OPENROUTER_KEYS.length : this.currentKeyIndex}`);
        return key;
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
            const currentKey = this._getNextKey();
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
                if (!content || content.trim() === "") throw new Error("API вернул пустой ответ.");
                return content.trim();

            } catch (error) {
                const errorMessage = error.response?.data?.error?.message || error.message || "Неизвестная ошибка";
                console.error(`Попытка ${attempt} с ключом #${this.currentKeyIndex} не удалась: ${errorMessage}`);

                if (errorMessage.includes('Insufficient credits')) {
                    console.log(`Ключ #${this.currentKeyIndex} исчерпан. Пробую следующий.`);
                    if (sendMessageCallback) await sendMessageCallback(`_(Один из API ключей исчерпан, автоматически пробую следующий...)_`);
                    continue; // Сразу переходим к следующей попытке с новым ключом
                }
                
                if (errorMessage.includes('can only afford')) {
                    const match = errorMessage.match(/can only afford (\d+)/);
                    if (match && match[1]) {
                        const affordableTokens = parseInt(match[1], 10) - 20;
                        if (affordableTokens > 0) {
                            console.log(`Снижаю лимит токенов до ${affordableTokens} и повторяю запрос с тем же ключом.`);
                            currentMaxTokens = affordableTokens;
                            this.currentKeyIndex = (this.currentKeyIndex - 1 + OPENROUTER_KEYS.length) % OPENROUTER_KEYS.length;
                            if (sendMessageCallback) await sendMessageCallback(`_(${network.name}: немного не хватает лимита, уменьшаю ответ...)_`);
                            continue;
                        }
                    }
                }

                if (errorMessage.includes('No endpoints found')) {
                    console.log(`Модель ${modelIdentifier} недоступна. Переключаюсь на резервную.`);
                    modelIdentifier = FALLBACK_MODEL_ID;
                    if (sendMessageCallback) await sendMessageCallback(`_(Модель "${originalModelName}" временно недоступна, переключаюсь на резервную...)_`);
                    continue;
                }

                if (attempt === MAX_RETRIES) {
                    throw new Error(`Не удалось получить ответ от "${network.name}" после перебора всех ключей и ${MAX_RETRIES} попыток: ${errorMessage}`);
                }
                
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
            model: 'GPT-4o (новейшая)',
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
            
            this.acceptedSummaries.push(summary); // Упрощаем: сводка принимается автоматически
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

function getOrCreateSession(chatId) {
    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => sendLongMessage(chatId, text));
    }
    return chatSessions[chatId];
}

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

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать в Neural Collaborative Framework!*

Этот бот позволяет организовывать совместную работу нескольких AI-личностей (нейросетей) для решения сложных задач.

*Как это работает:*
1.  Нажмите кнопку *🚀 Открыть Панель Управления* ниже.
2.  В открывшемся веб-приложении опишите вашу задачу или тему для обсуждения.
3.  Настройте параметры коллаборации: выберите, какие нейросети будут участвовать, сколько циклов (итераций) они должны пройти, и другие AI-настройки.
4.  Нажмите *"Start Collaboration"*.

Бот начнет симуляцию диалога прямо в этом чате. Нейросети будут по очереди высказывать свои мнения, а в конце каждой итерации специальная сеть-синтезатор будет подводить итог.

*Основные команды:*
/start - Показать это сообщение и кнопку запуска.
/stop - Принудительно остановить текущую коллаборацию.
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
        
        // Обновляем настройки сессии из данных, полученных от Web App
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

bot.onText(/\/stop/, (msg) => {
    const session = chatSessions[msg.chat.id];
    if (session && session.isWorking) {
        session.isWorking = false;
        bot.sendMessage(msg.chat.id, "🛑 Получен сигнал остановки. Завершаю текущую операцию...");
    } else {
        bot.sendMessage(msg.chat.id, "Сейчас нет активного обсуждения.");
    }
});

bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "🗑️ Все настройки и история для этого чата сброшены.");
});

bot.on('polling_error', (error) => {
    console.error(`Ошибка Polling: [${error.code}] ${error.message}`);
});

const app = express();
const PORT = process.env.PORT || 3000; 
const HOST = '0.0.0.0';

app.get('/', (req, res) => res.send('Бот жив и здоров!'));

app.listen(PORT, HOST, () => {
    console.log(`Веб-сервер для health check УСПЕШНО запущен и слушает ${HOST}:${PORT}`);
});