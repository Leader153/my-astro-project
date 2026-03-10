require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");

// Инициализация клиентов
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "yachts_knowledge";
const PAGES_DIR = path.join(__dirname, "..", "src", "pages");

// Функция создания эмбеддингов (векторов) через Gemini
async function getEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// Функция для очистки .astro файлов от лишнего кода
function parseAstroFile(filePath, fileName) {
  const rawContent = fs.readFileSync(filePath, "utf-8");

  // 1. Убираем блок внутри --- (метаданные Astro)
  let bodyContent = rawContent.replace(/---[\s\S]*?---/, "");

  // 2. Убираем блоки <style> и <script>
  bodyContent = bodyContent.replace(/<style[\s\S]*?<\/style>/gi, "");
  bodyContent = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "");

  // 3. Загружаем в cheerio для извлечения сырого текста (без HTML тегов)
  const $ = cheerio.load(bodyContent);
  const cleanText = $("body")
    .text()
    .replace(/\s+/g, " ") // Убираем лишние пробелы и переносы
    .trim();

  // Если страница пустая, пропускаем
  if (!cleanText || cleanText.length < 10) return null;

  return {
    id: uuidv4(), // Генерируем уникальный ID для Qdrant
    source_file: fileName,
    content: `Информация со страницы ${fileName}: ${cleanText}`,
  };
}

// Главная функция парсинга и загрузки
async function runIngestion() {
  console.log(`🔍 Начинаю сканирование файлов в папке: ${PAGES_DIR}`);

  // Читаем все файлы в папке pages
  const files = fs.readdirSync(PAGES_DIR);
  const chunks = [];

  // Проходимся по каждому файлу (ищем яхты, катамараны и т.д.)
  for (const file of files) {
    if (file.endsWith(".astro")) {
      const filePath = path.join(PAGES_DIR, file);
      console.log(`📄 Обрабатываю файл: ${file}...`);

      const parsedData = parseAstroFile(filePath, file);
      if (parsedData) {
        chunks.push(parsedData);
      }
    }
  }

  console.log(
    `✅ Найдено ${chunks.length} информативных файлов. Начинаю векторизацию (обращение к Gemini)...`,
  );

  // Векторизуем каждый кусок текста и готовим для загрузки в Qdrant
  const pointsToInsert = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(
      `🧠 Создаю вектор для: ${chunk.source_file}... (${i + 1}/${chunks.length})`,
    );

    try {
      const vector = await getEmbedding(chunk.content);
      pointsToInsert.push({
        id: chunk.id,
        vector: vector,
        payload: {
          source: chunk.source_file,
          text: chunk.content,
        },
      });
    } catch (error) {
      console.error(
        `❌ Ошибка создания вектора для ${chunk.source_file}:`,
        error,
      );
    }
  }

  if (pointsToInsert.length > 0) {
    console.log(
      `📥 Загружаю ${pointsToInsert.length} векторов в базу Qdrant...`,
    );
    try {
      await qdrantClient.upsert(COLLECTION_NAME, {
        wait: true,
        points: pointsToInsert,
      });
      console.log(`🎉 ГОТОВО! Векторная база знаний успешно обновлена!`);
    } catch (error) {
      console.error("❌ Ошибка при загрузке в Qdrant:", error);
    }
  } else {
    console.log("⚠️ Не найдено данных для загрузки.");
  }
}

// Запуск
runIngestion();
