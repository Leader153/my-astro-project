require("dotenv").config();
const { QdrantClient } = require("@qdrant/js-client-rest");

// Инициализация Qdrant клиента
const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "yachts_knowledge";

async function initDB() {
  try {
    console.log("Проверка соединения с Qdrant...");
    const collections = await client.getCollections();

    const exists = collections.collections.some(
      (c) => c.name === COLLECTION_NAME,
    );

    if (!exists) {
      console.log(`Создаем коллекцию "${COLLECTION_NAME}"...`);
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: 3072, // Размерность векторов для модели gemini-embedding-001
          distance: "Cosine", // Используем косинусное сходство для поиска
        },
      });
      console.log(`✅ Коллекция "${COLLECTION_NAME}" успешно создана!`);
    } else {
      console.log(`✅ Коллекция "${COLLECTION_NAME}" уже существует.`);
    }
  } catch (error) {
    console.error("❌ Ошибка при работе с Qdrant:", error);
  }
}

initDB();
