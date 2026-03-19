const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// --- СЛОВАРЬ СИНОНИМОВ ЯХТ ---
const YACHT_ALIASES = {
  "Joy-B":   ["JOY", "Joy", "ג'וי", "JOYB", "joy", "גוי בי", "Joy-B", "ג׳וי בי", "גוי", "גוי יוסי", "ג'וי יוסי"],
  "Louise":  ["Louse", "Loise", "לואיז", "Luize", "לויז", "Louise", "לואיס", "לואיז יוסי", "לויז יוסי"],
  "Dolphin": ["Dolfin", "Dolphin", "דולפין", "קטמרן דולפין"],
  "Lee-Yam": ["Lee-Yam", "Lee Yam", "לי ים", "ליים", "leeyam", "לי-ים"],
  "Bagira":  ["Bagira", "בגירה"],
  "Yami":    ["Yami", "יאמי"],
  "Sea-u":   ["Sea-u", "סי יו", "Sea u", "סי-יו"],
};

// --- КАРТА КАЛЕНДАРЕЙ ---
const YACHT_CALENDAR_IDS = {
  "Joy-B": process.env.CALENDAR_ID_JOY_B,
  "Bagira": process.env.CALENDAR_ID_BAGIRA,
  "Louise": process.env.CALENDAR_ID_LOUISE,
  "Lee-Yam": process.env.CALENDAR_ID_LEE_YAM,
  "Dolphin": process.env.CALENDAR_ID_DOLPHIN,
  "Sea-u": process.env.CALENDAR_ID_AYA_YAM,
  "Yami": process.env.CALENDAR_ID_AYA_YAM,
};

/**
 * Инициализация клиента Google Calendar (через OAuth2)
 */
async function getCalendarClient() {
  // Файлы ключей лежат на уровень выше (в папке simple-bot-server)
  const credentialsPath = path.resolve(__dirname, "../credentials.json");
  const tokenPath = path.resolve(__dirname, "../token.json");

  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
    throw new Error(`Файлы credentials.json или token.json не найдены!`);
  }

  // Читаем основной ключ
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Читаем наш полученный токен
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  oAuth2Client.setCredentials(token);

  console.log(`🔐 Авторизация ביומן (OAuth2) עברה בהצלחה!`);

  return google.calendar({ version: "v3", auth: oAuth2Client });
}

/**
 * Проверка, относится ли событие к конкретной яхте
 */
function isEventForYacht(summary, description, targetYacht) {
  const textToSearch = `${summary || ""} ${description || ""}`.toLowerCase();
  const target = targetYacht.toLowerCase();

  // Проверяем прямое вхождение
  if (textToSearch.includes(target)) return true;

  // Проверяем через синонимы
  for (const [canonicalName, aliases] of Object.entries(YACHT_ALIASES)) {
    if (
      target.includes(canonicalName.toLowerCase()) ||
      canonicalName.toLowerCase().includes(target)
    ) {
      return aliases.some((alias) =>
        textToSearch.includes(alias.toLowerCase()),
      );
    }
  }
  return false;
}

/**
 * ГЛАВНАЯ ФУНКЦИЯ: Поиск свободных окон без наложений
 */
async function getAvailableSlots(
  dateStr,
  yachtName,
  durationHours = 2,
  preferredStartTime = null,
) {
  try {
    const client = await getCalendarClient();
    // Пытаемся найти уникальный календарь для конкретной яхты
    let canonicalYachtName = yachtName;
    for (const [canonical, aliases] of Object.entries(YACHT_ALIASES)) {
      if (
        canonical.toLowerCase() === yachtName.toLowerCase() ||
        aliases.some((alias) => alias.toLowerCase() === yachtName.toLowerCase())
      ) {
        canonicalYachtName = canonical;
        break;
      }
    }

    const calendarId =
      YACHT_CALENDAR_IDS[canonicalYachtName] || process.env.GOOGLE_CALENDAR_ID;

    if (!calendarId) {
      console.error(`❌ Не найден Calendar ID для яхты: ${yachtName}`);
      return `מצטער, אין לי חיבור ליומן של ${yachtName} כרגע.`;
    }

    // Определяем границы дня (08:00 - 20:00)
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(8, 0, 0, 0);

    const endOfDay = new Date(dateStr);
    endOfDay.setHours(20, 0, 0, 0);

    const response = await client.events.list({
      calendarId: calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

const events = response.data.items || [];

    // Список общих календарей, где события нужно фильтровать по названию яхты
    const SHARED_CALENDARS = [
      process.env.GOOGLE_CALENDAR_ID,
      process.env.CALENDAR_ID_AYA_YAM
    ];

    // Фильтруем события
    const busySlots = events
      .filter((event) => {
        // Если мы ищем в ОБЩЕМ календаре (где много яхт)
        if (SHARED_CALENDARS.includes(calendarId)) {
          return isEventForYacht(event.summary, event.description, yachtName);
        }
        
        // Если мы ищем в ИНДИВИДУАЛЬНОМ календаре (Joy-B, Bagira, Dolphin и т.д.)
        // Любое событие означает, что яхта занята (даже если название скрыто)
        return true; 
      })
      .map((event) => ({
        start: new Date(event.start.dateTime || event.start.date),
        end: new Date(event.end.dateTime || event.end.date),
      }))
      .sort((a, b) => a.start - b.start);

    // Ищем свободные промежутки (ЭТУ ЧАСТЬ ОСТАВЛЯЕШЬ БЕЗ ИЗМЕНЕНИЙ)
    const freeSlots = [];
    let cursor = new Date(startOfDay);

    for (const busy of busySlots) {
      // Если между курсором и началом занятости есть место
      if (busy.start > cursor) {
        const diffMs = busy.start - cursor;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= durationHours) {
          freeSlots.push({
            start: new Date(cursor),
            end: new Date(busy.start),
          });
        }
      }
      // Двигаем курсор на конец занятого слота (если он дальше текущего курсора)
      if (busy.end > cursor) {
        cursor = new Date(busy.end);
      }
    }

    // Проверяем остаток дня после последнего события
    if (cursor < endOfDay) {
      const diffMs = endOfDay - cursor;
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours >= durationHours) {
        freeSlots.push({
          start: new Date(cursor),
          end: new Date(endOfDay),
        });
      }
    }

    let specificTimeResponse = "";

    if (preferredStartTime) {
      try {
        const [hours, minutes] = preferredStartTime.split(":").map(Number);
        if (!isNaN(hours)) {
          const reqStart = new Date(dateStr);
          reqStart.setHours(hours, minutes || 0, 0, 0);
          const reqEnd = new Date(
            reqStart.getTime() + durationHours * 60 * 60 * 1000,
          );

          // Проверяем прямое окно пересечения с занятыми слотами
          let isConflict = false;
          for (const busy of busySlots) {
            if (reqStart < busy.end && reqEnd > busy.start) {
              isConflict = true;
              break;
            }
          }

          if (isConflict) {
            specificTimeResponse = `[מידע קריטי מיומן המערכת: הלקוח ביקש להתחיל בשעה ${preferredStartTime} למשך ${durationHours} שעות, אך זמן זה **תפוס** (יש חפיפה עם הזמנה קיימת)! עליך להתנצל באופן נימוסי ולהציע אך ורק את החלופות הפנויות המופיעות מטה:]\n`;
          } else {
            specificTimeResponse = `[מידע מיומן המערכת: השעה המבוקשת ${preferredStartTime} **פנויה**! עליך לשמח את הלקוח ולאשר לו שהשעה זמינה.]\n`;
          }
        }
      } catch (e) {
        console.error("Ошибка проверки preferredStartTime:", e);
      }
    }

    // Форматируем для ответа боту
    if (freeSlots.length === 0) {
      return (
        specificTimeResponse +
        `מצטער, נראה שאין זמינות עבור ${yachtName} בתאריך זה למשך ${durationHours} שעות.`
      );
    }

    const formatted = freeSlots
      .map((slot) => {
        const timeOptions = {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Jerusalem",
        };
        const startStr = slot.start.toLocaleTimeString("he-IL", timeOptions);
        const endStr = slot.end.toLocaleTimeString("he-IL", timeOptions);

        return `חלון זמן פנוי בין ${startStr} ל-${endStr}`;
      })
      .join("\n* ");

    return (
      specificTimeResponse +
      `📌 המידע עבור יאכטה ${yachtName} בתאריך ${dateStr} (עבור הפלגה של ${durationHours} שעות):\n* ${formatted}`
    );
  } catch (error) {
    console.error("Ошибка Calendar Manager:", error);
    return "חלקה שגיאה בבדיקת היומן. אנא נסה שוב מאוחר יותר.";
  }
}

const calendarTool = {
  functionDeclarations: [
    {
      name: "check_yacht_availability",
      description:
        "Проверяет свободные временные слоты для яхты на указанную дату. Используй это, когда клиент спрашивает 'когда свободно' или называет дату.",
      parameters: {
        type: "OBJECT",
        properties: {
          date: {
            type: "string",
            description: "Дата в формате ГГГГ-ММ-ДД (например, '2026-03-21')",
          },
          yachtName: {
            type: "string",
            description: "Название яхты (Joy-B, Bagira, Louise и т.д.)",
          },
          duration: {
            type: "number",
            description: "Длительность аренды в часах (по умолчанию 2)",
          },
          preferredStartTime: {
            type: "string",
            description:
              "Желаемое время начала (только если клиент его указал), в формате ЧЧ:ММ. Пример: '17:00'",
          },
        },
        required: ["date", "yachtName"],
      },
    },
  ],
};

/**
 * Обработчик вызовов инструментов для календаря
 */
async function handleCalendarCall(call) {
  if (call.name === "check_yacht_availability") {
    const { date, yachtName, duration, preferredStartTime } = call.args;
    console.log(
      `🤖 בוט בודק יומן: ${yachtName} בתאריך ${date} ${preferredStartTime ? "בשעה " + preferredStartTime : ""}`,
    );
    return await getAvailableSlots(
      date,
      yachtName,
      duration || 2,
      preferredStartTime,
    );
  }
  return null;
}

module.exports = { getAvailableSlots, calendarTool, handleCalendarCall };
