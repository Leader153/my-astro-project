require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

// Убедись, что добавил ключ в файл .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

    if (!userMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    console.log(`\n💬 [Клиент]: ${userMessage}`);

    // Инициализация модели (используем самую умную модель)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(userMessage);
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
