require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { QdrantClient } = require("@qdrant/js-client-rest");

const app = express();
const port = process.env.PORT || 3000;

// Убедись, что добавил ключ в файл .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "yachts_knowledge";

app.use(cors());
app.use(express.json());

// Читаем промпт из внешнего файла ОДИН РАЗ при запуске сервера
const promptPath = path.join(__dirname, "prompt.txt");
let SYSTEM_PROMPT = "";
try {
  SYSTEM_PROMPT = fs.readFileSync(promptPath, "utf-8");
} catch (error) {
  console.error("⚠️ Ошибка: файл prompt.txt не найден! Создайте его.");
}

// (удаленный дубликат)

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const chatHistory = req.body.history || [];

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    console.log(`\n💬 [Клиент]: ${userMessage}`);

    // Преобразуем историю чата из фронтенда в нужный формат Gemini
    const geminiHistory = chatHistory.map((msg) => ({
      role: msg.role,
      parts: [{ text: String(msg.parts) }],
    }));

    // ШАГ 1: Превращаем вопрос клиента в вектор (эмбеддинг)
    const embeddingModel = genAI.getGenerativeModel({
      model: "gemini-embedding-001",
    });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const questionVector = embeddingResult.embedding.values;

    // ШАГ 2: Ищем в базе Qdrant 3 самых релевантных куска текста (ближайшие векторы)
    // Поиск выполняется ИСКЛЮЧИТЕЛЬНО по последнему вопросу пользователя (questionVector)
    const searchResults = await qdrantClient.search(COLLECTION_NAME, {
      vector: questionVector,
      limit: 3, // Берем топ 3 совпадения
      score_threshold: 0.75, // Порог релевантности для качества ответов
      with_payload: true, // Нам нужен сам текст, а не только векторы
    });

    // ШАГ 3: Формируем контекст из найденных текстов и добавляем источник (ссылку)
    const contextTexts = searchResults
      .map((hit) => {
        // Делаем из названия .astro файла красивую ссылку: "yacht-joy-b.astro" -> "/yacht-joy-b"
        const sourceLink = hit.payload.source
          ? `/${hit.payload.source.replace(".astro", "")}`
          : "";
        return `[מקור: ${sourceLink}]\n${hit.payload.text}`;
      })
      .join("\n\n---\n\n");

    console.log(
      `🔎 [Qdrant]: Найдено контекста: ${searchResults.length} фрагментов.`,
    );

    // ШАГ 4: Инициализация основной модели (чат-бота)
    // Мы смешиваем базовый промпт из файла (SYSTEM_PROMPT) с найденным контекстом
    const ragPrompt = `
${SYSTEM_PROMPT}

-- מידע עדכני מתוך האתר (בסיס נתונים) --
${contextTexts}
    `;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: ragPrompt,
      generationConfig: {
        // Температура: от 0.0 עד 2.0 (чем меньше, тем точнее и строже ответы для RAG; чем выше, тем "креативнее")
        temperature: 0.2, // Идеально для фактологических ответов
      },
    });

    // Запускаем сессию чата, передавая ей память предыдущих сообщений!
    const chat = model.startChat({
      history: geminiHistory,
    });

    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    const text = response.text();

    console.log(`🤖 [Бот]: ${text.trim()}`);
    res.json({ reply: text });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

app.listen(port, () => {
  console.log(`🤖 Бот-сервер успешно запущен!`);
  console.log(`Слушаю запросы на http://localhost:${port}/api/chat`);
  if (
    !process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY === "ТВОЙ_КЛЮЧ_СЮДА"
  ) {
    console.warn("⚠️ ВНИМАНИЕ: GEMINI_API_KEY не установлен в файле .env!");
  }
});
