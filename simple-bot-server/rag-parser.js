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

// Функция для рекурсивного поиска всех файлов .astro
function getAllAstroFiles(dirPath, arrayOfFiles = []) {
  const items = fs.readdirSync(dirPath);

  items.forEach(function(item) {
    if (item === "node_modules" || item.startsWith(".")) return;
    const fullPath = path.join(dirPath, item);

    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllAstroFiles(fullPath, arrayOfFiles);
    } else {
      if (item.endsWith(".astro")) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

// Функция создания эмбеддингов (векторов) через Gemini
async function getEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// Функция для парсинга файлов (нарезка на смысловые фрагменты - Chunks)
function parseAstroFile(filePath, fileName) {
  const rawContent = fs.readFileSync(filePath, "utf-8");
  const chunks = []; // Сюда соберем все фрагменты этого файла

  // --- СПЕЦНАЗ: Обработка вопросов-ответов из массивов кода (например faq.astro) ---
  // Ищем совпадения в формате q: "...", a: "..."
  const faqRegex = /q:\s*(["'])(.*?)\1,\s*a:\s*(["'])([\s\S]*?)\3/g;
  let match;
  let faqCount = 0;
  while ((match = faqRegex.exec(rawContent)) !== null) {
    const question = match[2].trim();
    const answer = match[4].trim();
    
    // Создаем отдельный независимый чанк для КАЖДОГО вопроса
    chunks.push({
      id: uuidv4(),
      source_file: fileName,
      content: `[שאלה ותשובה מדף: ${fileName}]\nשאלה: ${question}\nתשובה: ${answer}`,
    });
    faqCount++;
  }
  
  if (faqCount > 0) {
    console.log(`   💡 Найдено ${faqCount} Q&A (вопрос-ответ) пар.`);
  }

  // --- СПЕЦНАЗ 2: Обработка цен в переменных (coupleYachts и т.д.) ---
  // Так как парсер удаляет блок ---...---, он не видит цены, которые прописаны в массиве coupleYachts.
  // Мы вырежем их вручную:
  const coupleYachtsRegex = /(?:const|let|var)\s+coupleYachts\s*=\s*\[([\s\S]*?)\];/;
  const matchYachts = coupleYachtsRegex.exec(rawContent);
  if (matchYachts) {
    const yachtsStr = matchYachts[1];
    
    // Грубый парсинг объектов внутри массива
    const nameRegex = /name:\s*['"](.*?)['"]/g;
    const price1Regex = /price1:\s*['"](.*?)['"]/g;
    const price15Regex = /price15:\s*['"](.*?)['"]/g;
    const price2Regex = /price2:\s*['"](.*?)['"]/g;
    
    let parts = yachtsStr.split('{');
    let pricesCount = 0;
    let combinedPricingText = `[מחירון רומנטי זוגי מתוך: ${fileName}]\n`;
    
    for (let part of parts) {
      if (part.includes('name:')) {
        const nameMatch = part.match(/name:\s*(["'])(.*?)\1/);
        const name = nameMatch ? nameMatch[2] : "";
        
        const p1 = (part.match(/price1:\s*['"](.*?)['"]/) || [])[1] || "";
        const p15 = (part.match(/price15:\s*['"](.*?)['"]/) || [])[1] || "";
        const p2 = (part.match(/price2:\s*['"](.*?)['"]/) || [])[1] || "";
        const extra = (part.match(/extraHour:\s*['"](.*?)['"]/) || [])[1] || "";
        
        if (name && (p1 || p2)) {
          combinedPricingText += `- יאכטה ${name}: שעה 1 תעלה ${p1} ש"ח | שעה וחצי ${p15} ש"ח | שעתיים ${p2} ש"ח | כל שעה נוספת ${extra} ש"ח\n`;
          pricesCount++;
        }
      }
    }
    
    if (pricesCount > 0) {
      combinedPricingText += `\nהמחיר הזוגי הזה לרוב כולל: בקבוק שמפניה, בלונים, שלט מזל טוב, מוזיקה (בלוטוס), שתייה מים, סקיפר מקצועי וביטוח לכל משתתף.`;
      
      chunks.push({
        id: uuidv4(),
        source_file: fileName,
        content: combinedPricingText
      });
      console.log(`   💎 Добавлен ОБЩИЙ ПРАЙС-ЛИСТ для ${pricesCount} яхт (парсинг переменных).`);
    }
  }

  // --- ОБРАБОТКА ОБЫЧНОГО HTML-ТЕКСТА ---
  // 1. Убираем блок внутри --- (метаданные)
  let bodyContent = rawContent.replace(/---[\s\S]*?---/, "");

  // 2. Убираем блоки стилей, скриптов и системного Schema.org
  bodyContent = bodyContent.replace(/<style[\s\S]*?<\/style>/gi, "");
  bodyContent = bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "");

  // 3. Извлекаем сырой текст
  const $ = cheerio.load(bodyContent);
  const cleanText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  // Добавляем обычный текст страницы (если он есть и достаточно длинный)
  if (cleanText && cleanText.length > 30) {
    chunks.push({
      id: uuidv4(),
      source_file: fileName,
      content: `מידע כללי מסעיף ${fileName}: ${cleanText}`,
    });
  }

  return chunks;
}

// Главная функция парсинга и загрузки
async function runIngestion() {
  console.log(`🔍 Начинаю сканирование файлов в папке: ${PAGES_DIR}`);

  const files = fs.readdirSync(PAGES_DIR);
  let allChunks = [];

  for (const file of files) {
    if (file.endsWith(".astro")) {
      const filePath = path.join(PAGES_DIR, file);
      console.log(`📄 Обрабатываю файл: ${file}...`);

      const fileChunks = parseAstroFile(filePath, file);
      if (fileChunks && fileChunks.length > 0) {
        allChunks = allChunks.concat(fileChunks);
      }
    }
  }

  console.log(`\n✅ Найдено ${allChunks.length} независимых кусков текста (чанков). Начинаю векторизацию...`);

  // ОЧИСТКА СТАРЫХ ДАННЫХ (Чтобы не плодить дубликаты перед новой загрузкой)
  console.log(`🧹 Очищаю старые данные в коллекции ${COLLECTION_NAME}...`);
  try {
    // В Qdrant можно пересоздать коллекцию
    await qdrantClient.deleteCollection(COLLECTION_NAME);
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: { size: 3072, distance: "Cosine" },
    });
    console.log(`🧹 База чиста как палуба!`);
  } catch (e) {
    console.log("⚠️ Не удалось удалить/пересоздать базу (возможно она еще не существовала). Игнорируем.");
  }

  const pointsToInsert = [];

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    console.log(`🧠 Создаю вектор (${i + 1}/${allChunks.length}). Знаков: ${chunk.content.length}`);

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
      console.error(`❌ Ошибка вектора для ID ${chunk.id}:`, error);
    }
  }

  if (pointsToInsert.length > 0) {
    console.log(`\n📥 Загружаю ${pointsToInsert.length} новых умных векторов в базу Qdrant...`);
    try {
      await qdrantClient.upsert(COLLECTION_NAME, {
        wait: true,
        points: pointsToInsert,
      });
      console.log(`🎉 ГОТОВО! Бот теперь сверх-умный и видит все нюансы!`);
    } catch (error) {
      console.error("❌ Ошибка при загрузке в Qdrant:", error);
    }
  } else {
    console.log("⚠️ Не найдено данных для загрузки.");
  }
}

// Запуск
runIngestion();
