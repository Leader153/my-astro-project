require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { QdrantClient } = require("@qdrant/js-client-rest");

// Подключаемся к Gemini и Qdrant используя ключи из .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "yachts_knowledge";

async function testQuery(userMessage) {
  console.log(`\n==========================================`);
  console.log(`🔍 ТЕСТИРОВАНИЕ ЗАПРОСА: "${userMessage}"`);
  console.log(`==========================================\n`);

  try {
    // 1. Создаем эмбеддинг для запроса
    console.log("➡️ Шаг 1: Превращаем запрос в вектор...");
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const questionVector = embeddingResult.embedding.values;
    console.log(`✅ Вектор создан (размерность: ${questionVector.length})`);

    // 2. Ищем в Qdrant
    console.log("\n➡️ Шаг 2: Ищем совпадения в базе знаний (Qdrant)...");
    const searchResults = await qdrantClient.search(COLLECTION_NAME, {
      vector: questionVector,
      limit: 3,
      score_threshold: 0.75, // Этот же порог мы настроили в server.js
      with_payload: true,
    });

    console.log(`✅ Найдено релевантных фрагментов: ${searchResults.length}`);

    // 3. Выводим результаты
    if (searchResults.length === 0) {
      console.log("\n⚠️ Бот ничего не нашел в базе по этому запросу! (score ниже 0.75)");
      console.log("Это значит, что бот будет отвечать, опираясь только на свою общую логику из prompt.txt.");
      return;
    }

    console.log("\n👇 ВОТ ЧТО КОНКРЕТНО УВИДИТ БОТ В КАЧЕСТВЕ БАЗЫ ДАННЫХ: 👇\n");
    
    searchResults.forEach((hit, index) => {
      const score = hit.score.toFixed(4);
      const sourceLink = hit.payload.source ? `/${hit.payload.source.replace(".astro", "")}` : "Нет источника";
      
      console.log(`--- [Фрагмент #${index + 1} | Точность (Score): ${score} | Ссылка: ${sourceLink}] ---`);
      console.log(hit.payload.text);
      console.log("-------------------------------------------------------------------\n");
    });

  } catch (error) {
    console.error("❌ Ошибка при выполнении тестового запроса:", error);
  }
}

// Забираем запрос из параметров командной строки.
// Если параметров нет, используем тестовый запрос на иврите.
const query = process.argv.slice(2).join(" ") || "כמה עולה להשכיר קטמרן למסיבה בחיפה?";
testQuery(query);
