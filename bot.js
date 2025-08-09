require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const { GoogleAuth } = require('googleapis').google.auth;
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fs =require('fs');
const os = require('os');
const path = require('path');

// --- ЗАГРУЗКА КЛЮЧЕЙ ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
    throw new Error("КРИТИЧЕСКАЯ ОШИБКА: TELEGRAM_BOT_TOKEN и OPENROUTER_API_KEY должны быть указаны в .env файле!");
}

// --- КОНСТАНТЫ ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3; // Количество повторных попыток при ошибках
const FALLBACK_MODEL_ID = 'meta-llama/llama-3-8b-instruct:free'; // Надежная резервная модель

// --- СПИСОК МОДЕЛЕЙ (ВСЕ ЧЕРЕЗ OPENROUTER) ---
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

const VOTE_KEYWORDS = {
    'English': { accept: 'accept', reject: 'reject' },
    'Russian': { accept: 'принимаю', reject: 'отклоняю' },
    'German': { accept: 'akzeptieren', reject: 'ablehnen' },
    'French': { accept: 'accepter', reject: 'rejeter' },
    'Ukrainian': { accept: 'приймаю', reject: 'відхиляю' }
};

// =========================================================================
// === НОВЫЙ УСТОЙЧИВЫЙ К ОШИБКАМ NETWORK MANAGER ===
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
        
        let modelIdentifier = MODEL_MAP[settings.model];
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
                    { 
                        headers: { 
                            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                            'HTTP-Referer': 'https://github.com/ollxel/neural-collab-bot',
                            'X-Title': 'Neural Collab Bot'
                        } 
                    }
                );
                
                const content = response.data.choices[0].message.content;
                if (!content || content.trim() === "") throw new Error("API вернул пустой ответ.");
                
                return content.trim(); // Успех, выходим из цикла и функции

            } catch (error) {
                const errorMessage = error.response?.data?.error?.message || "";
                console.error(`Попытка ${attempt} для "${network.name}" не удалась. Ошибка: ${errorMessage}`);

                // --- ЛОГИКА АВТОМАТИЧЕСКОГО ИСПРАВЛЕНИЯ ---

                // 1. Если ошибка связана с лимитом токенов/кредитов
                if (errorMessage.includes('can only afford')) {
                    const match = errorMessage.match(/can only afford (\d+)/);
                    if (match && match[1]) {
                        const affordableTokens = parseInt(match[1], 10) - 10; // Берем с запасом
                        console.log(`Автоматически снижаю лимит токенов до ${affordableTokens}`);
                        currentMaxTokens = affordableTokens;
                        // Переходим к следующей попытке
                        continue; 
                    }
                }

                // 2. Если модель временно недоступна
                if (errorMessage.includes('No endpoints found')) {
                    console.log(`Модель ${modelIdentifier} недоступна. Переключаюсь на резервную модель: ${FALLBACK_MODEL_ID}`);
                    modelIdentifier = FALLBACK_MODEL_ID;
                    if (sendMessageCallback) {
                         // Уведомляем пользователя в чате
                        await sendMessageCallback(`_(Модель "${settings.model}" временно недоступна, автоматически переключаюсь на резервную...)_`);
                    }
                    // Переходим к следующей попытке с новой моделью
                    continue;
                }

                // Если это последняя попытка, пробрасываем ошибку наверх
                if (attempt === MAX_RETRIES) {
                    throw new Error(`Не удалось получить ответ от "${network.name}" после ${MAX_RETRIES} попыток: ${errorMessage}`);
                }

                // Ждем немного перед следующей попыткой
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    // ... остальной код класса без изменений ...
}


class NeuralCollaborativeFramework {
    constructor(sendMessageCallback) {
        this.sendMessage = sendMessageCallback;
        this.networkManager = new NetworkManager();
        this.initializeSettings();
        this.resetProject();
    }

    initializeSettings() {
       // ... (код без изменений)
    }

    resetProject() {
        // ... (код без изменений)
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
       // ... (код без изменений)
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
                
                // Передаем callback для отправки сообщений в generateResponse
                const response = await this.networkManager.generateResponse(networkId, prompt, this.settings, this.sendMessage);
                
                if (!this.isWorking) { await this.sendMessage("Обсуждение прервано пользователем."); return; }
                await this.sendMessage(`*${networkName}:*\n${response}`);
                
                iterationHistory += `\n\n**${networkName} сказал(а):**\n${response}`;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // ... остальная часть метода без изменений ...
        }
    }
    
    // ... остальной код класса без изменений ...
}


// =========================================================================
// === ОСТАЛЬНОЙ КОД БОТА (UI, КОМАНДЫ И Т.Д.) - БЕЗ ИЗМЕНЕНИЙ ===
// =========================================================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
// ... (весь оставшийся код, начиная с const chatSessions = {}, полностью идентичен предыдущей "простой" версии) ...