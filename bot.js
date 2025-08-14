require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- ЗАГРУЗКА И РОТАЦИЯ КЛЮЧЕЙ OPENROUTER ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const OPENROUTER_KEYS = [];
for (let i = 1; i <= 5; i++) { // Ищем до 5 ключей
    const key = process.env[`OPENROUTER_KEY${i}`];
    if (key) OPENROUTER_KEYS.push(key);
}

if (!TELEGRAM_TOKEN) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN не указан!");
if (OPENROUTER_KEYS.length === 0) throw new Error("КРИТИЧЕСКАЯ ОШИБКА: Не найден ни один ключ OpenRouter (OPENROUTER_KEY1..5)!");

console.log(`Бот запущен. Обнаружено ключей OpenRouter: ${OPENROUTER_KEYS.length}`);

// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = OPENROUTER_KEYS.length + 2;
const FALLBACK_MODEL_ID = 'meta-llama/llama-3-8b-instruct:free';

// --- СПИСОК МОДЕЛЕЙ ---
const MODEL_MAP = {
    'GPT-4o (новейшая)': 'openai/gpt-4o',
    'GPT-4 Turbo': 'openai/gpt-4-turbo',
    'Qwen 2 72B Instruct': 'qwen/qwen-2-72b-instruct',
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
            network1: { name: 'Аналитическая Сеть' }, network2: { name: 'Креативная Сеть' },
            network3: { name: 'Сеть Реализации' }, network4: { name: 'Сеть Data Science' },
            network5: { name: 'Этическая Сеть' }, network6: { name: 'Сеть UX' },
            network7: { name: 'Сеть Системного Мышления' }, network8: { name: 'Сеть "Адвокат Дьявола"' },
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
                if (!content || content.trim().length < 5 || /[\u{FFFD}]/u.test(content)) throw new Error("API вернул некорректный или пустой ответ.");
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
            model: 'Llama 3 8B (Free)',
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
    { command: '/run', description: '✍️ Новое обсуждение (текстом)' },
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

const MAIN_KEYBOARD = { reply_markup: { keyboard: [[{ text: '🚀 Открыть Панель Управления' }, { text: '⚙️ Настройки' }]], resize_keyboard: true } };

bot.onText(/\/start/, (msg) => {
    const welcomeText = `
*Добро пожаловать в Neural Collaborative Framework!*

Этот бот позволяет организовывать совместную работу нескольких AI-личностей для решения сложных задач.

*Как это работает:*
1.  Нажмите кнопку *🚀 Открыть Панель Управления* ниже.
2.  В открывшемся веб-приложении опишите вашу задачу или тему для обсуждения.
3.  Настройте параметры коллаборации: выберите участников, модель, количество итераций и т.д.
4.  Нажмите *"Start Collaboration"*.

Бот начнет симуляцию диалога прямо в этом чате.

*Альтернативный способ (через текст):*
- Используйте команду /run, чтобы начать обсуждение.
- Используйте команду /settings или кнопку '⚙️ Настройки', чтобы настроить все в чате.
    `;
    bot.sendMessage(msg.chat.id, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: "🚀 Открыть Панель Управления", web_app: { url: WEB_APP_URL } }, { text: "⚙️ Настройки" }]], resize_keyboard: true }
    });
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text && text.startsWith('/')) return;
    if (activeRequests[chatId]) {
        handleActiveRequest(chatId, msg);
        return;
    }
    if (text === '⚙️ Настройки') {
        sendSettingsMessage(chatId);
    } else if (text === '🚀 Открыть Панель Управления') {
        // Эта кнопка работает через web_app, отдельный обработчик не нужен
    } else {
        // Если это просто текст, считаем его темой для обсуждения
        if (text && text.length > 5) {
            const session = getOrCreateSession(chatId);
            session.startCollaboration(text);
        }
    }
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

bot.onText(/\/run/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Какую тему вы хотите обсудить?');
    activeRequests[msg.chat.id] = { type: 'topic' };
});
bot.onText(/\/settings/, (msg) => sendSettingsMessage(msg.chat.id));
bot.onText(/\/reset/, (msg) => {
    delete chatSessions[msg.chat.id];
    delete activeRequests[msg.chat.id];
    bot.sendMessage(msg.chat.id, "Обсуждение и настройки сброшены.");
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

// ... (ВСЕ callbackQueryHandlers и update...Menu функции остаются здесь, как в коде на 600+ строк)

const app = express();
const PORT = process.env.PORT || 3000; 
const HOST = '0.0.0.0';
app.get('/', (req, res) => res.send('Бот жив и здоров!'));
app.listen(PORT, HOST, () => {
    console.log(`Веб-сервер для health check УСПЕШНО запущен и слушает ${HOST}:${PORT}`);
});
