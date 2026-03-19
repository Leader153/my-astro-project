const { google } = require("googleapis");
const fs = require("fs");
const readline = require("readline");

// Читаем наш новый credentials.json
const credentials = JSON.parse(fs.readFileSync("credentials.json"));
const { client_secret, client_id, redirect_uris } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);

// Генерируем ссылку для авторизации (ТОЛЬКО ЧТЕНИЕ!)
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/calendar.readonly"],
});

console.log("====================================================");
console.log("1. Удерживая Ctrl, кликни по ссылке ниже, чтобы открыть браузер:");
console.log(authUrl);
console.log(
  "\n2. Выбери свой аккаунт (danielflider78@gmail.com) и нажми Continue / Allow (Разрешить).",
);
console.log(
  '3. В самом конце браузер перекинет тебя на страницу с ошибкой (что-то вроде "Не удается получить доступ к сайту localhost"). ЭТО НОРМАЛЬНО!',
);
console.log(
  "4. Скопируй ВЕСЬ адрес из адресной строки браузера (он будет длинным) и вставь его сюда в консоль.",
);
console.log("====================================================\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Вставь скопированную ссылку сюда и нажми Enter: ", async (url) => {
  rl.close();
  try {
    const code = new URL(url.trim()).searchParams.get("code");
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    console.log(
      "\n✅ УСПЕХ! Файл token.json успешно создан. Мы закончили с авторизацией!",
    );
  } catch (e) {
    console.error(
      "\n❌ Ошибка. Убедись, что скопировал ссылку целиком из браузера.",
      e.message,
    );
  }
});
