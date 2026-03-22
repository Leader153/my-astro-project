require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { QdrantClient } = require("@qdrant/js-client-rest");
// Связь с модулем календаря (полная изоляция логики в отдельной папке)
const { calendarTool, handleCalendarCall } = require("./calendar/calendar-manager");

const app = express();
const port = process.env.PORT || 3000;

// SSE Clients for Live Terminal
const sseClients = new Set();

function broadcastLog(logData) {
    const dataString = `data: ${JSON.stringify(logData)}\n\n`;
    for (const client of sseClients) {
        client.write(dataString);
    }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "yachts_knowledge";

app.use(cors());
app.use(express.json());

const promptPath = path.join(__dirname, "prompt.txt");
let SYSTEM_PROMPT = "";
try {
  SYSTEM_PROMPT = fs.readFileSync(promptPath, "utf-8");
} catch (error) {
  console.error("⚠️ Ошибка: файл prompt.txt не найден!");
}

// SSE Endpoint
app.get("/api/logs/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toLocaleTimeString("ru-RU", { hour12: false }), sessionId: "SYSTEM", source: "Server", speaker: "System", message: "Connected to Live Terminal" })}\n\n`);
    
    sseClients.add(res);
    req.on("close", () => {
        sseClients.delete(res);
    });
});


app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    const chatHistory = req.body.history || [];
    const sessionId = req.body.sessionId || `WEB-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const source = req.body.source || "Чат";

    console.log(`\n================== שאלה חדשה ==================`);
    console.log(`👤 לקוח: "${userMessage}"`);

    // Broadcast user message to Live Terminal
    broadcastLog({
        timestamp: new Date().toLocaleTimeString("ru-RU", { hour12: false }),
        sessionId: sessionId,
        source: source,
        speaker: "Клиент",
        message: userMessage
    });

    // --- УМНЫЙ ПОИСК ДЛЯ ПАМЯТИ ---
    // Формируем вектор с учетом 2-х последних сообщений, чтобы не терять контекст
    let queryForQdrant = userMessage;
    if (chatHistory.length > 0) {
      const lastMessages = chatHistory.slice(-2).map((msg) => msg.parts || msg.content).join(" | ");
      queryForQdrant = `${lastMessages} | ${userMessage}`;
    }
    console.log(`🧠 בסיס נתונים: "${queryForQdrant}"`);

    // ШАГ 1: Поиск в Qdrant
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const embeddingResult = await embeddingModel.embedContent(queryForQdrant);
    const questionVector = embeddingResult.embedding.values;

    const searchResults = await qdrantClient.search(COLLECTION_NAME, {
      vector: questionVector,
      limit: 3,
      score_threshold: 0.60,
      with_payload: true,
    });

    const contextTexts = searchResults
      .map((hit) => {
        const sourceLink = hit.payload.source ? `/${hit.payload.source.replace(".astro", "")}` : "";
        return `[מקור: ${sourceLink}]\n${hit.payload.text}`;
      })
      .join("\n\n---\n\n");

    const ragPrompt = `${SYSTEM_PROMPT}\n\n-- מידע עדכני מתוך האתר --\n${contextTexts}`;

    // ШАГ 2: Инициализация Gemini с инструментами
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // Возвращаем 2.5-flash, так как 2.0 сильно галлюцинирует на иврите
      systemInstruction: ragPrompt,
      tools: [calendarTool] // Просто подключаем инструмент из отдельного файла
    });

    const geminiHistory = chatHistory.map((msg) => ({
      role: msg.role === "bot" ? "model" : "user",
      parts: [{ text: String(msg.parts || msg.content) }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    let result = await chat.sendMessage(userMessage);
    let response = result.response;

    // ШАГ 3: Связь с календарем (если бот вызвал функцию)
    const calls = response.functionCalls();
    if (calls && calls.length > 0) {
      const toolResponse = await handleCalendarCall(calls[0]); // Вызов отдельного файла
      
      if (toolResponse) {
        result = await chat.sendMessage([{
          functionResponse: {
            name: calls[0].name,
            response: { content: toolResponse }
          }
        }]);
        response = result.response;
      }
    }

    const finalReply = response.text();
    console.log(`🤖 תשובה: "${finalReply}"`);
    console.log(`==================================================\n`);

    // Broadcast bot message to Live Terminal
    broadcastLog({
        timestamp: new Date().toLocaleTimeString("ru-RU", { hour12: false }),
        sessionId: sessionId,
        source: source,
        speaker: "Бот",
        message: finalReply
    });

    res.json({ reply: finalReply, sessionId: sessionId });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

app.listen(port, () => {
  console.log(`🚀 Бот запущен! Связь с календарем установлена.`);
});
