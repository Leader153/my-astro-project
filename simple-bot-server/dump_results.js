const { GoogleGenerativeAI } = require("@google/generative-ai");
const { QdrantClient } = require("@qdrant/js-client-rest");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function run() {
  const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const embeddingResult = await embeddingModel.embedContent("מחיר יאכטה לזוג בהרצליה לשעה אחד");
  const questionVector = embeddingResult.embedding.values;

  const searchResults = await qdrantClient.search("yachts_knowledge", {
    vector: questionVector,
    limit: 3,
    score_threshold: 0.75,
    with_payload: true,
  });

  require('fs').writeFileSync('rag-results.json', JSON.stringify(searchResults, null, 2));
}

run();
