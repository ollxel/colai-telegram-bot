// --- ЗАВИСИМОСТИ ---
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// --- КОНФИГУРАЦИЯ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AI_MODEL_ID = 'llama3-8b-8192'; // Быстрая и умная модель на Groq
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// --- КЛАССЫ ПРОЕКТА ---

class PromptGenerator {
    createIterationPrompt(topicName, topicDescription, iteration, acceptedSummaries) {
        let prompt = `Topic: ${topicDescription}\n\n`;
        if (iteration === 1) {
            prompt += "This is the first round of discussion. Please provide your initial thoughts on the topic.";
        } else {
            prompt += `This is round ${iteration}. Here are the summaries from previous rounds:\n\n`;
            acceptedSummaries.forEach((summary, index) => {
                prompt += `Summary ${index + 1}: ${summary}\n\n`;
            });
            prompt += "Based on these summaries, please provide your further thoughts or build upon the existing ideas.";
        }
        return prompt;
    }
}

class NetworkManager {
    constructor() {
        this.networks = {
            network1: { name: 'Аналитик', persona: 'You are a pragmatic and analytical thinker. You focus on logic, data, and structured reasoning. Provide concise and clear arguments.' },
            network2: { name: 'Креативщик', persona: 'You are a creative and imaginative thinker. You explore unconventional ideas, possibilities, and novel perspectives.' },
            summarizer: { name: 'Синтезатор', persona: 'You are a master synthesizer. Your role is to read a discussion and create a concise, neutral summary of the key points.' }
        };
    }

    async generateResponse(networkId, prompt) {
        const network = this.networks[networkId];
        if (!network) throw new Error(`Network ${networkId} not found.`);

        try {
            const response = await axios.post(
                GROQ_API_URL,
                {
                    model: AI_MODEL_ID,
                    messages: [
                        { role: "system", content: network.persona },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024,
                },
                { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } }
            );
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            console.error(`\n--- ОШИБКА API GROQ для "${network.name}" ---`);
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
                console.error(`Данные: ${JSON.stringify(error.response.data)}`);
            } else {
                console.error(`Сообщение: ${error.message}`);
            }
            throw new Error(`Не удалось получить ответ от "${network.name}". Возможно, неверный API ключ Groq или сервис временно недоступен.`);
        }
    }
}

class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback;
        this.networkManager = new NetworkManager();
        this.promptGenerator = new PromptGenerator();
        this.resetProject();
    }

    resetProject() {
        this.projectName = '';
        this.projectDescription = '';
        this.iterations = 0;
        this.maxIterations = 2; // 2 итерации для скорости
        this.acceptedSummaries = [];
        this.isWorking = false;
    }

    async startCollaboration(topic) {
        if (this.isWorking) {
            this.sendMessage("Я уже занят обсуждением. Используйте /reset для сброса.");
            return;
        }

        this.resetProject();
        this.isWorking = true;
        this.projectDescription = topic;
        this.projectName = topic.length > 50 ? topic.substring(0, 50) + '...' : topic;

        this.sendMessage(`*Начинаю коллаборацию на тему:* "${this.projectName}"`);

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
        while (this.iterations < this.maxIterations) {
            this.iterations++;
            this.sendMessage(`\n\n--- 💬 *Итерация ${this.iterations} из ${this.maxIterations}* ---\n`);
            
            const prompt = this.promptGenerator.createIterationPrompt(
                this.projectName, this.projectDescription, this.iterations, this.acceptedSummaries
            );

            let currentDiscussion = prompt;
            const networkIds = ['network1', 'network2'];

            for (const networkId of networkIds) {
                const networkName = this.networkManager.networks[networkId].name;
                this.sendMessage(`🤔 _${networkName} думает..._`);
                const response = await this.networkManager.generateResponse(networkId, currentDiscussion);
                this.sendMessage(`*${networkName}:*\n${response}`);
                currentDiscussion += `\n\n**${networkName}'s input:**\n${response}`;
            }

            this.sendMessage(`📝 _Синтезатор анализирует..._`);
            const summary = await this.networkManager.generateResponse('summarizer', currentDiscussion);
            this.sendMessage(`*Сводка итерации ${this.iterations}:*\n${summary}`);
            this.acceptedSummaries.push(summary);
        }
    }

    async finalizeDevelopment() {
        this.sendMessage("\n\n--- 🏁 *Все итерации завершены. Формирую итоговый отчет...* ---");
        const finalPrompt = `Based on the topic "${this.projectDescription}" and the following summaries, create a comprehensive final output. \n\nSummaries:\n${this.acceptedSummaries.join('\n\n')}`;
        const finalOutput = await this.networkManager.generateResponse('summarizer', finalPrompt);
        this.sendMessage(`*Итоговый результат коллаборации:*\n\n${finalOutput}`);
    }
}

// --- ЛОГИКА ТЕЛЕГРАМ БОТА ---

if (!TELEGRAM_TOKEN || !GROQ_API_KEY) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN или GROQ_API_KEY не найдены в .env файле!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const chatSessions = {};

console.log('Бот успешно запущен и готов к работе!');

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        "Привет! Я бот для коллаборации нейросетей.\n\n" +
        "Используйте команду `/discuss <ваша тема>`, чтобы начать.\n\n" +
        "Например:\n`/discuss Плюсы и минусы удаленной работы`"
    );
});

bot.onText(/\/discuss (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const topic = match[1];

    if (!chatSessions[chatId]) {
        chatSessions[chatId] = new NeuralCollaborativeFramework((text) => {
            bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
               .catch(() => bot.sendMessage(chatId, text)); // Отправка как обычный текст, если Markdown не удался
        });
    }
    chatSessions[chatId].startCollaboration(topic);
});

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    delete chatSessions[chatId];
    bot.sendMessage(chatId, "Обсуждение сброшено. Готов к новой теме!");
});

bot.on('polling_error', (error) => console.log(`Ошибка Polling: ${error.message}`));
