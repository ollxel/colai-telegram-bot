// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;
const AI_MODEL_ID = 'gpt2'; // <-- ЗАМЕНИТЕ ЭТУ СТРОКУ
const HUGGINGFACE_API_URL = `https://api-inference.huggingface.co/models/${AI_MODEL_ID}`;

// --- КЛАССЫ ИЗ ВАШЕГО ПРОЕКТА (АДАПТИРОВАННЫЕ И ИСПРАВЛЕННЫЕ) ---

class PromptGenerator {
    createIterationPrompt(topicName, topicDescription, iteration, acceptedSummaries) {
        let prompt = `Topic Name: ${topicName}\nTopic Description: ${topicDescription}\n\n`;
        if (iteration === 1) {
            prompt += "This is the first iteration. Begin exploring the core aspects of this topic with an open mind.";
        } else {
            prompt += `This is iteration ${iteration}. Here are the previously accepted summaries:\n\n`;
            acceptedSummaries.forEach((summary, index) => {
                prompt += `Summary ${index + 1}: ${summary}\n\n`;
            });
            prompt += "Focus on synthesizing the discussion into a coherent whole, addressing any remaining questions or loose ends.";
        }
        return prompt;
    }
}

class NetworkManager {
    constructor() {
        this.networks = {
            network1: { name: 'Аналитик', persona: 'You are an analytical thinker. Focus on logical, structured, and evidence-based reasoning.' },
            network2: { name: 'Креативщик', persona: 'You are a creative thinker. Focus on novel ideas, alternatives, and exploring possibilities.' },
            network3: { name: 'Этик', persona: 'You specialize in ethical analysis. Focus on moral implications and societal impact.' },
            summarizer: { name: 'Синтезатор', persona: 'You are specialized in synthesizing discussions and finding consensus.' }
        };
        this.networkSettings = {
            temperature: 0.7,
            max_tokens: 512,
            top_p: 0.9,
        };
    }

    createSystemPrompt(basePersona) {
        return basePersona;
    }

    async generateResponse(networkId, prompt) {
        const network = this.networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        const systemPrompt = this.createSystemPrompt(network.persona);
        const fullPrompt = `<s>[INST] ${systemPrompt}\n\n${prompt} [/INST]`;

        try {
            const response = await axios.post(HUGGINGFACE_API_URL, {
                inputs: fullPrompt,
                parameters: {
                    max_new_tokens: this.networkSettings.max_tokens,
                    temperature: this.networkSettings.temperature,
                    top_p: this.networkSettings.top_p,
                    return_full_text: false,
                }
            }, {
                headers: { 'Authorization': `Bearer ${HUGGINGFACE_TOKEN}` }
            });
            return response.data[0].generated_text.trim();
        } catch (error) {
            // --- НАЧАЛО ИСПРАВЛЕНИЯ ---
            
            // Безопасно получаем текст ошибки
            const errorMessage = error.response?.data?.error;

            // Сначала проверяем, является ли ошибка строкой, и только потом ищем в ней текст
            if (typeof errorMessage === 'string' && errorMessage.includes("is currently loading")) {
                console.log(`Model ${AI_MODEL_ID} is loading. Retrying in 25 seconds...`);
                // Уведомляем пользователя о "холодном старте"
                if (global.sendMessageCallback) {
                    global.sendMessageCallback(`_(Модель для "${network.name}" просыпается, это может занять минуту...)_`);
                }
                await new Promise(resolve => setTimeout(resolve, 25000));
                return this.generateResponse(networkId, prompt); // Повторная попытка
            } else {
                // Если это любая другая ошибка, выводим подробности в консоль
                console.error(`Hugging Face API Error for ${network.name}:`);
                if (error.response) {
                    // Ошибка пришла от сервера (неверный токен, проблемы с моделью и т.д.)
                    console.error(`Status: ${error.response.status}`);
                    console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
                } else {
                    // Ошибка сети (нет интернета, DNS и т.д.)
                    console.error(`Message: ${error.message}`);
                }
                // И выбрасываем понятную ошибку дальше
                throw new Error(`Не удалось получить ответ от "${network.name}". Проверьте консоль для деталей.`);
            }
            // --- КОНЕЦ ИСПРАВЛЕНИЯ ---
        }
    }
}

class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback; // Функция для отправки сообщений в Telegram
        this.networkManager = new NetworkManager();
        this.promptGenerator = new PromptGenerator();
        this.resetProject();
    }

    resetProject() {
        this.projectName = '';
        this.projectDescription = '';
        this.iterations = 0;
        this.maxIterations = 3; // По умолчанию 3 итерации для бота
        this.discussionHistory = [];
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) {
            this.sendMessage("Я уже занят обсуждением. Пожалуйста, подождите его окончания или сбросьте командой /reset.");
            return;
        }

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;
        this.projectName = topic.length > 50 ? topic.substring(0, 50) + '...' : topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${this.projectName}"\n\n_Нейросетям может потребоваться время на ответ, особенно при первом запуске._`);

        try {
            await this.runDiscussionLoop();
            await this.finalizeDevelopment();
        } catch (error) {
            console.error(error);
            this.sendMessage(`❗️*Произошла ошибка во время обсуждения:*\n${error.message}\n\nПопробуйте еще раз или проверьте токен Hugging Face.`);
        } finally {
            this.isWorking = false;
        }
    }

    async runDiscussionLoop() {
        while (this.iterations < this.maxIterations) {
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.maxIterations}* ---\n`);
            
            const prompt = this.promptGenerator.createIterationPrompt(
                this.projectName,
                this.projectDescription,
                this.iterations,
                this.acceptedSummaries
            );

            let currentDiscussion = prompt;
            const networkIds = ['network1', 'network2', 'network3'];

            for (const networkId of networkIds) {
                const networkName = this.networkManager.networks[networkId].name;
                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, currentDiscussion);
                this.sendMessage(`*${networkName}:*\n${response}`);
                currentDiscussion += `\n${networkName}: ${response}`;
            }

            this.sendMessage(`📝 _Синтезатор анализирует обсуждение..._`);
            const summary = await this.networkManager.generateResponse('summarizer', currentDiscussion);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            this.acceptedSummaries.push(summary);
        }
    }

    async finalizeDevelopment() {
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following summaries from each iteration of a collaborative discussion, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt);
        this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

// --- ЛОГИКА ТЕЛЕГРАМ БОТА ---

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {}; // Хранилище сессий для каждого чата

console.log('Бот успешно запущен!');

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        "Привет! Я бот, в котором нейросети могут общаться между собой.\n\n" +
        "Используйте команду `/discuss <ваша тема>`, чтобы начать.\n\n" +
        "Например:\n`/discuss Перспективы колонизации Марса`\n\n" +
        "Чтобы остановить текущее обсуждение, используйте команду `/reset`."
    );
});

bot.onText(/\/discuss (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const topic = match[1];

    if (!chatSessions[chatId]) {
        const sendMessageCallback = (text) => {
            bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(err => {
                // Если ошибка форматирования, отправляем как обычный текст
                if (err.response && err.response.body.description.includes('parse error')) {
                    bot.sendMessage(chatId, text);
                } else {
                    console.error("Telegram send error:", err);
                }
            });
        };
        // Сохраняем коллбэк в глобальную переменную, чтобы он был доступен в NetworkManager
        global.sendMessageCallback = sendMessageCallback;
        chatSessions[chatId] = new NeuralCollaborativeFramework(sendMessageCallback);
    }

    chatSessions[chatId].startCollaboration(topic);
});

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    if (chatSessions[chatId]) {
        if (chatSessions[chatId].isWorking) {
            chatSessions[chatId].isWorking = false; // Прерываем цикл, если он активен
        }
        delete chatSessions[chatId];
        bot.sendMessage(chatId, "Текущее обсуждение сброшено. Готов к новой теме!");
    } else {
        bot.sendMessage(chatId, "Нет активных обсуждений для сброса.");
    }
});

// Обработка ошибок, чтобы бот не падал
bot.on('polling_error', (error) => {
    console.log(`Polling error: ${error.code} - ${error.message}`);
});