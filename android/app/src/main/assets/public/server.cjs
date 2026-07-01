var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
module.exports = __toCommonJS(server_exports);
var import_express = __toESM(require("express"), 1);
var import_http = __toESM(require("http"), 1);
var import_path = __toESM(require("path"), 1);
var import_ws = require("ws");
var import_vite = require("vite");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
import_dotenv.default.config();
var ai = new import_genai.GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});
var BOT_NAMES = [
  "\u0627\u0644\u0645\u0641\u062A\u0634 \u0643\u0648\u0644\u0648\u0645\u0628\u0648",
  "\u0627\u0644\u0630\u0626\u0628 \u0627\u0644\u0645\u0646\u0641\u0631\u062F",
  "\u0635\u0642\u0631 \u0627\u0644\u0645\u062F\u064A\u0646\u0629",
  "\u0627\u0644\u0639\u0645\u064A\u0644 \u0627\u0644\u0635\u0627\u0645\u062A",
  "\u0623\u0628\u0648 \u0627\u0644\u0639\u0631\u064A\u0641",
  "\u0627\u0644\u0642\u0646\u0627\u0639 \u0627\u0644\u0623\u0633\u0648\u062F",
  "\u0627\u0644\u0641\u0647\u062F \u0627\u0644\u0623\u0633\u0645\u0631",
  "\u0627\u0644\u0638\u0644 \u0627\u0644\u062E\u0641\u064A",
  "\u0627\u0644\u0645\u062D\u0642\u0642 \u0627\u0644\u0630\u0643\u064A",
  "\u0634\u064A\u0631\u0644\u0648\u0643 \u0647\u0648\u0644\u0645\u0632",
  "Silent Shadow",
  "Midnight Spy",
  "Alpha Agent",
  "Inspector Morse",
  "Phoenix",
  "Ghost Rider",
  "Cunning Fox",
  "Desert Falcon",
  "\u062D\u0627\u0631\u0633 \u0627\u0644\u063A\u0645\u0648\u0636",
  "\u0627\u0644\u0639\u0642\u0644 \u0627\u0644\u0645\u062F\u0628\u0631"
];
var rooms = {};
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}
function getFormattedTime() {
  const now = /* @__PURE__ */ new Date();
  return now.toTimeString().split(" ")[0].substring(0, 5);
}
function addSystemMessage(room, text, isDeadChat = false) {
  const message = {
    id: generateId(),
    senderId: null,
    senderName: "\u0627\u0644\u0646\u0638\u0627\u0645",
    text,
    time: getFormattedTime(),
    isSystem: true,
    isDeadChat
  };
  room.messages.push(message);
}
function addGameEvent(room, icon, text) {
  if (!room.eventsLog) {
    room.eventsLog = [];
  }
  const newEvent = {
    id: generateId(),
    icon,
    text,
    time: getFormattedTime(),
    round: room.round
  };
  room.eventsLog.push(newEvent);
}
function getCleanRoomState(room, playerId) {
  const viewer = room.players.find((p) => p.id === playerId);
  const viewerRole = viewer?.role || "";
  const isViewerMafia = viewerRole.startsWith("mafia_");
  const cleanPlayers = room.players.map((p) => {
    let revealedRole = "";
    if (p.id === playerId) {
      revealedRole = p.role;
    } else if (room.status === "game_over") {
      revealedRole = p.role;
    } else if (!p.isAlive) {
      revealedRole = p.role;
    } else if (p.revealedSheikh) {
      revealedRole = "sheikh";
    } else if (isViewerMafia && p.role.startsWith("mafia_")) {
      revealedRole = "mafia_team";
    }
    return {
      id: p.id,
      nickname: p.nickname,
      avatarId: p.avatarId,
      isHost: p.isHost,
      isAlive: p.isAlive,
      isOffline: p.isOffline,
      role: revealedRole,
      // Stripped or revealed based on rules
      isMuted: p.isMuted,
      revealedSheikh: p.revealedSheikh
    };
  });
  const cleanRoom = {
    code: room.code,
    players: cleanPlayers,
    status: room.status,
    round: room.round,
    dayDuration: room.dayDuration,
    timer: room.timer,
    winner: room.winner,
    nightOutcomeText: room.nightOutcomeText,
    voteOutcomeText: room.voteOutcomeText,
    // Only share current voter statuses, not who they voted for (until reveal/finished in client or as shown in voting logs)
    // Actually, "بمجرد أن يصوت لاعب: يشاهد الجميع لمن صوّت. ويتم تحديث عدد الأصوات مباشرة لحظيًا."
    // So votes are public in real-time as per instructions!
    votes: room.votes,
    // Filter messages based on player alive/dead status
    messages: room.messages.filter((msg) => {
      if (msg.isDeadChat) {
        return viewer && !viewer.isAlive;
      }
      return true;
    }),
    // Share night target info ONLY with appropriate players for UI feedback
    mafiaTarget: isViewerMafia && (viewerRole === "mafia_killer" || viewerRole === "mafia_single") ? room.mafiaTarget : null,
    muteTarget: isViewerMafia && (viewerRole === "mafia_muter" || viewerRole === "mafia_single") ? room.muteTarget : null,
    doctorTarget: viewerRole === "doctor" ? room.doctorTarget : null,
    sniperTarget: viewerRole === "sniper" ? room.sniperTarget : null,
    sniperHasShot: room.sniperHasShot,
    jokerChoice: viewerRole === "joker" ? room.jokerChoice : null,
    eventsLog: room.eventsLog || []
  };
  return cleanRoom;
}
function broadcastRoomState(room) {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === import_ws.WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "room_state",
          data: {
            room: getCleanRoomState(room, player.id),
            playerId: player.id
          }
        })
      );
    }
  });
}
function broadcastSound(room, soundType) {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === import_ws.WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "sound",
          data: { sound: soundType }
        })
      );
    }
  });
}
function broadcastNotification(room, message, type = "info") {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === import_ws.WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "notification",
          data: { message, type }
        })
      );
    }
  });
}
async function generateBotResponseWithFallback(prompt) {
  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
  let lastError = null;
  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });
        const text = response.text || "";
        return JSON.parse(text.trim());
      } catch (err) {
        lastError = err;
        console.warn(`Attempt ${attempt} using ${model} failed for bot speech:`, err?.message || err);
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
      }
    }
  }
  throw lastError;
}
async function handleBotSpeaks(room, bot) {
  if (!room.botBrains) {
    room.botBrains = {};
  }
  if (!room.botBrains[bot.id]) {
    room.botBrains[bot.id] = { suspicionScores: {} };
  }
  const brain = room.botBrains[bot.id];
  const arabicFallbacks = [
    "\u0623\u0639\u062A\u0642\u062F \u0623\u0646 \u0647\u0646\u0627\u0643 \u0634\u064A\u0626\u0627\u064B \u0645\u0631\u064A\u0628\u0627\u064B \u064A\u062D\u062F\u062B \u0647\u0646\u0627... \u064A\u062C\u0628 \u0623\u0646 \u0646\u0631\u0643\u0632!",
    "\u0623\u0646\u0627 \u0645\u0648\u0627\u0637\u0646 \u0628\u0631\u064A\u0621 \u062A\u0645\u0627\u0645\u0627\u064B\u060C \u0623\u0631\u062C\u0648\u0643\u0645 \u0644\u0627 \u062A\u062A\u0633\u0631\u0639\u0648\u0627 \u0641\u064A \u0627\u0644\u062D\u0643\u0645.",
    "\u0645\u0646 \u0647\u0648 \u0628\u0631\u0623\u064A\u0643\u0645 \u0627\u0644\u0645\u0634\u0628\u0648\u0647 \u0627\u0644\u0623\u0643\u0628\u0631 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0648\u0644\u0629\u061F",
    "\u0639\u0644\u064A\u0646\u0627 \u0623\u0646 \u0646\u0643\u0648\u0646 \u062D\u0630\u0631\u064A\u0646\u060C \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u062A\u062D\u0627\u0648\u0644 \u062A\u0634\u062A\u064A\u062A\u0646\u0627.",
    "\u0627\u0644\u0634\u064A\u062E \u0647\u0648 \u0645\u0646 \u064A\u0633\u062A\u0637\u064A\u0639 \u0643\u0634\u0641 \u0627\u0644\u062D\u0642\u064A\u0642\u0629\u060C \u062F\u0639\u0648\u0646\u0627 \u0646\u0646\u062A\u0638\u0631 \u0625\u0634\u0627\u0631\u062A\u0647.",
    "\u0644\u0645\u0627\u0630\u0627 \u062A\u0644\u062A\u0632\u0645 \u0627\u0644\u0635\u0645\u062A \u064A\u0627 \u0635\u062F\u064A\u0642\u064A\u061F \u0647\u0630\u0627 \u064A\u062B\u064A\u0631 \u0627\u0644\u0634\u0643\u0648\u0643!",
    "\u0623\u0646\u0627 \u0623\u062B\u0642 \u0628\u0642\u0631\u0627\u0631\u0627\u062A \u0627\u0644\u062F\u0643\u062A\u0648\u0631\u060C \u0623\u062A\u0645\u0646\u0649 \u0623\u0646 \u064A\u062D\u0645\u064A\u0646\u0627 \u062C\u0645\u064A\u0639\u0627\u064B.",
    "\u0627\u0644\u062A\u0635\u0648\u064A\u062A \u0627\u0644\u0639\u0634\u0648\u0627\u0626\u064A \u0633\u064A\u0636\u0631 \u0628\u0645\u0635\u0644\u062D\u0629 \u0627\u0644\u0628\u0644\u062F\u0629\u060C \u0641\u0644\u0646\u0641\u0643\u0631 \u062C\u064A\u062F\u0627\u064B.",
    "\u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0628\u064A\u0646\u0646\u0627... \u0623\u0634\u0639\u0631 \u0628\u0648\u062C\u0648\u062F\u0647\u0645!"
  ];
  let text = "";
  if (process.env.GEMINI_API_KEY) {
    try {
      const playersInfo = room.players.map((p) => {
        let details = `${p.nickname} (ID: ${p.id}) - ${p.isAlive ? "\u062D\u064A" : "\u0645\u064A\u062A"}`;
        if (p.isBot) details += " (\u0628\u0648\u062A)";
        if (p.role === "sheikh" && p.revealedSheikh) details += " (\u0634\u064A\u062E \u0645\u0639\u0644\u0646)";
        return details;
      }).join("\n");
      const deadPlayersWithRoles = room.players.filter((p) => !p.isAlive).map((p) => {
        return `${p.nickname} (\u062F\u0648\u0631\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A: ${getRoleNameInArabic(p.role)})`;
      }).join("\u060C ") || "\u0644\u0627 \u0623\u062D\u062F";
      const recentChat = room.messages.slice(-15).map((m) => {
        return `${m.senderName}: ${m.text}`;
      }).join("\n");
      const otherMafia = room.players.filter((p) => p.id !== bot.id && p.role.startsWith("mafia_") && p.isAlive).map((p) => p.nickname).join("\u060C ") || "\u0644\u0627 \u0623\u062D\u062F";
      const prompt = `
\u0623\u0646\u062A \u062A\u0644\u0639\u0628 \u0644\u0639\u0628\u0629 \u0627\u0644\u0645\u0627\u0641\u064A\u0627 (Mafia/Werewolf) \u0627\u0644\u0627\u062C\u062A\u0645\u0627\u0639\u064A\u0629 \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629.
\u0647\u0648\u064A\u062A\u0643 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0644\u0639\u0628\u0629:
- \u0627\u0633\u0645\u0643 \u0627\u0644\u0645\u0633\u062A\u0639\u0627\u0631: ${bot.nickname}
- \u062F\u0648\u0631\u0643 \u0627\u0644\u0633\u0631\u064A: ${getRoleNameInArabic(bot.role)} (${bot.role})
- \u062D\u0627\u0644\u062A\u0643: \u062D\u064A

\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0644\u0639\u0628\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629:
- \u0627\u0644\u062C\u0648\u0644\u0629: ${room.round}
- \u0627\u0644\u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629: ${room.status === "day" ? "\u0627\u0644\u0646\u0647\u0627\u0631 (\u0646\u0642\u0627\u0634)" : "\u0627\u0644\u062A\u0635\u0648\u064A\u062A"}
- \u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646 \u0627\u0644\u0645\u062A\u0648\u0627\u062C\u062F\u0648\u0646 \u0648\u062D\u0627\u0644\u062A\u0647\u0645:
${playersInfo}
- \u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646 \u0627\u0644\u0630\u064A\u0646 \u0645\u0627\u062A\u0648\u0627 \u0648\u0623\u062F\u0648\u0627\u0631\u0647\u0645: ${deadPlayersWithRoles}
${bot.role.startsWith("mafia_") ? `- \u0634\u0631\u0643\u0627\u0624\u0643 \u0641\u064A \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0627\u0644\u0623\u062D\u064A\u0627\u0621: ${otherMafia}` : ""}

\u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629 \u0641\u064A \u0627\u0644\u0634\u0627\u062A \u0627\u0644\u0639\u0627\u0645:
${recentChat || "\u0644\u0627 \u062A\u0648\u062C\u062F \u0631\u0633\u0627\u0626\u0644 \u0628\u0639\u062F."}

\u0627\u0644\u0645\u0637\u0644\u0628:
1. \u0627\u0643\u062A\u0628 \u0631\u0633\u0627\u0644\u0629 \u0642\u0635\u064A\u0631\u0629 \u0648\u0645\u0642\u0646\u0639\u0629 \u0648\u0637\u0628\u064A\u0639\u064A\u0629 \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 \u0623\u0648 \u0628\u0644\u0647\u062C\u0629 \u0639\u0631\u0628\u064A\u0629 \u0639\u0627\u0645\u064A\u0629 \u062E\u0641\u064A\u0641\u0629 (\u0631\u0633\u0627\u0644\u0629 \u0648\u0627\u062D\u062F\u0629 \u0641\u0642\u0637 \u0644\u0627 \u062A\u0632\u064A\u062F \u0639\u0646 \u0633\u0637\u0631\u064A\u0646). \u062A\u0641\u0627\u0639\u0644 \u0645\u0639 \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0633\u0627\u0628\u0642\u0629 \u0648\u0627\u062F\u0641\u0639 \u0628\u0622\u0631\u0627\u0626\u0643:
   - \u0625\u0630\u0627 \u062A\u0645 \u0627\u062A\u0647\u0627\u0645\u0643 \u0645\u0624\u062E\u0631\u0627\u064B\u060C \u062F\u0627\u0641\u0639 \u0639\u0646 \u0646\u0641\u0633\u0643 \u0628\u0642\u0648\u0629 \u0648\u0644\u0627 \u062A\u0643\u0646 \u0628\u0627\u0631\u062F\u0627\u064B.
   - \u0625\u0630\u0627 \u0643\u0646\u062A \u0645\u0627\u0641\u064A\u0627\u060C \u0627\u0643\u0630\u0628 \u0644\u062A\u0648\u062C\u064A\u0647 \u0627\u0644\u0634\u0643\u0648\u0643 \u0628\u0639\u064A\u062F\u0627\u064B \u0639\u0646\u0643 \u0648\u0639\u0646 \u0634\u0631\u0643\u0627\u0626\u0643.
   - \u0625\u0630\u0627 \u0643\u0646\u062A \u0645\u0648\u0627\u0637\u0646\u0627\u064B\u060C \u062D\u0627\u0648\u0644 \u0627\u0642\u062A\u0631\u0627\u062D \u0645\u0634\u0628\u0648\u0647\u064A\u0646 \u0628\u0646\u0627\u0621\u064B \u0639\u0644\u0649 \u0645\u0646 \u064A\u062A\u0635\u0631\u0641 \u0628\u063A\u0631\u0627\u0628\u0629 \u0623\u0648 \u064A\u0635\u0645\u062A \u0643\u062B\u064A\u0631\u0627\u064B.
2. \u0642\u064A\u0651\u0645 \u0634\u0643\u0648\u0643\u0643 \u0641\u064A \u0643\u0644 \u0644\u0627\u0639\u0628 \u062D\u064A \u0622\u062E\u0631 \u0645\u0646 0 \u0625\u0644\u0649 100.

\u0623\u0639\u062F \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0643\u0643\u0627\u0626\u0646 JSON \u062D\u0635\u0631\u0627\u064B \u0628\u0647\u0630\u0627 \u0627\u0644\u0634\u0643\u0644 (\u0644\u0627 \u062A\u0636\u0639 \u0623\u064A \u0643\u0644\u0627\u0645 \u0622\u062E\u0631 \u062E\u0627\u0631\u062C \u0627\u0644\u0640 JSON):
{
  "message": "\u0646\u0635 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644",
  "suspects": {
    "player_id_1": 85,
    "player_id_2": 10
  }
}
`;
      const parsed = await generateBotResponseWithFallback(prompt);
      if (parsed && parsed.message) {
        text = parsed.message;
        if (parsed.suspects) {
          Object.entries(parsed.suspects).forEach(([id, score]) => {
            brain.suspicionScores[id] = Number(score);
          });
        }
      }
    } catch (err) {
      console.error("Gemini API error, using fallback for bot:", bot.nickname, err);
      text = arabicFallbacks[Math.floor(Math.random() * arabicFallbacks.length)];
    }
  } else {
    text = arabicFallbacks[Math.floor(Math.random() * arabicFallbacks.length)];
  }
  if (room.status === "night") return;
  const newMessage = {
    id: generateId(),
    senderId: bot.id,
    senderName: bot.nickname,
    text: text.trim(),
    time: getFormattedTime(),
    isSystem: false,
    isDeadChat: false
  };
  room.messages.push(newMessage);
  broadcastRoomState(room);
}
function triggerBotDayStartResponses(room) {
  const aliveBots = room.players.filter((p) => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;
  const botsToSpeak = aliveBots.sort(() => 0.5 - Math.random()).slice(0, Math.min(aliveBots.length, 2));
  botsToSpeak.forEach((bot, index) => {
    const delay = (2 + Math.random() * 5) * 1e3 + index * 4e3;
    setTimeout(() => {
      if (room.status !== "day" || !bot.isAlive) return;
      handleBotSpeaks(room, bot);
    }, delay);
  });
}
function triggerBotNightActions(room) {
  if (room.status !== "night") return;
  const aliveBots = room.players.filter((p) => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;
  aliveBots.forEach((bot) => {
    const delay = 3e3 + Math.random() * 7e3;
    setTimeout(async () => {
      if (room.status !== "night" || !bot.isAlive) return;
      const alivePlayers = room.players.filter((p) => p.isAlive);
      const otherPlayers = alivePlayers.filter((p) => p.id !== bot.id);
      if (otherPlayers.length === 0) return;
      if (bot.role === "mafia_killer" || bot.role === "mafia_single") {
        const citizens = otherPlayers.filter((p) => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const target = citizens[Math.floor(Math.random() * citizens.length)];
          room.mafiaTarget = target.id;
          broadcastRoomState(room);
        }
      } else if (bot.role === "mafia_muter") {
        const citizens = otherPlayers.filter((p) => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const target = citizens[Math.floor(Math.random() * citizens.length)];
          room.muteTarget = target.id;
          broadcastRoomState(room);
        }
      } else if (bot.role === "doctor") {
        const possibleTargets = alivePlayers.filter((p) => p.id !== room.lastDoctorTarget);
        if (possibleTargets.length > 0) {
          const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
          room.doctorTarget = target.id;
          broadcastRoomState(room);
        }
      } else if (bot.role === "sniper" && !room.sniperHasShot) {
        const brain = room.botBrains?.[bot.id];
        let targetId = null;
        if (brain) {
          const highSuspects = Object.entries(brain.suspicionScores).filter(([id, score]) => score > 70 && room.players.find((p) => p.id === id && p.isAlive)).sort((a, b) => b[1] - a[1]);
          if (highSuspects.length > 0) {
            targetId = highSuspects[0][0];
          }
        }
        if (!targetId && room.round > 2 && Math.random() < 0.15) {
          const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
          targetId = target.id;
        }
        if (targetId) {
          room.sniperTarget = targetId;
          broadcastRoomState(room);
        }
      }
    }, delay);
  });
}
function triggerBotVoting(room) {
  if (room.status !== "voting") return;
  const aliveBots = room.players.filter((p) => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;
  aliveBots.forEach((bot) => {
    const delay = 4e3 + Math.random() * 8e3;
    setTimeout(async () => {
      if (room.status !== "voting" || !bot.isAlive) return;
      if (room.votes[bot.id]) return;
      const otherAlivePlayers = room.players.filter((p) => p.isAlive && p.id !== bot.id);
      if (otherAlivePlayers.length === 0) return;
      let targetId = null;
      if (bot.role.startsWith("mafia_")) {
        const citizens = otherAlivePlayers.filter((p) => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const brain = room.botBrains?.[bot.id];
          if (brain) {
            const citizensWithScores = citizens.map((c) => ({
              id: c.id,
              score: brain.suspicionScores[c.id] || 50
            })).sort((a, b) => b.score - a.score);
            targetId = citizensWithScores[0].id;
          } else {
            targetId = citizens[Math.floor(Math.random() * citizens.length)].id;
          }
        }
      } else {
        const brain = room.botBrains?.[bot.id];
        if (brain) {
          const suspects = otherAlivePlayers.map((p) => ({
            id: p.id,
            score: brain.suspicionScores[p.id] || 50
          })).sort((a, b) => b.score - a.score);
          if (suspects[0] && suspects[0].score > 50) {
            targetId = suspects[0].id;
          }
        } else {
          if (Math.random() < 0.5) {
            targetId = otherAlivePlayers[Math.floor(Math.random() * otherAlivePlayers.length)].id;
          }
        }
      }
      if (targetId) {
        room.votes[bot.id] = targetId;
        addSystemMessage(room, `\u{1F5F3}\uFE0F \u0623\u062F\u0644\u0649 \u0627\u0644\u0644\u0627\u0639\u0628 ${bot.nickname} \u0628\u0635\u0648\u062A\u0647.`);
        broadcastRoomState(room);
        const activeVoters = room.players.filter((p) => p.isAlive && !p.isMuted);
        const totalVotedCount = Object.keys(room.votes).length;
        if (totalVotedCount === activeVoters.length) {
          stopTimer(room);
          resolveVotingPhase(room);
        }
      }
    }, delay);
  });
}
function checkVictoryConditions(room) {
  const alivePlayers = room.players.filter((p) => p.isAlive);
  const aliveMafia = alivePlayers.filter((p) => p.role.startsWith("mafia_"));
  const aliveCitizens = alivePlayers.filter((p) => !p.role.startsWith("mafia_"));
  if (aliveMafia.length === 0) {
    room.status = "game_over";
    room.winner = "citizens";
    addSystemMessage(room, "\u{1F389} \u0645\u0628\u0631\u0648\u0643! \u0641\u0627\u0632 \u0641\u0631\u064A\u0642 \u0627\u0644\u0645\u0648\u0627\u0637\u0646\u064A\u0646 \u0628\u0627\u0644\u0642\u0636\u0627\u0621 \u0639\u0644\u0649 \u062C\u0645\u064A\u0639 \u0623\u0641\u0631\u0627\u062F \u0627\u0644\u0645\u0627\u0641\u064A\u0627.");
    broadcastSound(room, "victory");
    stopTimer(room);
    return true;
  }
  if (aliveMafia.length >= aliveCitizens.length) {
    room.status = "game_over";
    room.winner = "mafia";
    addSystemMessage(room, "\u{1F47F} \u0641\u0627\u0632\u062A \u0627\u0644\u0645\u0627\u0641\u064A\u0627! \u0644\u0642\u062F \u0633\u064A\u0637\u0631\u0648\u0627 \u0639\u0644\u0649 \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0648\u0623\u0635\u0628\u062D \u0639\u062F\u062F\u0647\u0645 \u0645\u0633\u0627\u0648\u064A\u0627\u064B \u0623\u0648 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0645\u0648\u0627\u0637\u0646\u064A\u0646 \u0627\u0644\u0623\u062D\u064A\u0627\u0621.");
    broadcastSound(room, "victory");
    stopTimer(room);
    return true;
  }
  return false;
}
function distributeRoles(room) {
  const players = room.players;
  const numPlayers = players.length;
  room.eventsLog = [];
  let mafiaCount = 2;
  if (numPlayers === 7) {
    mafiaCount = 1;
  }
  const specialRoles = ["doctor", "sniper", "sheikh", "joker"];
  const mafiaRoles = [];
  if (mafiaCount === 1) {
    mafiaRoles.push("mafia_single");
  } else {
    mafiaRoles.push("mafia_killer", "mafia_muter");
  }
  const citizenCount = numPlayers - mafiaCount - specialRoles.length;
  const citizens = Array(citizenCount).fill("citizen");
  const rolesPool = [...mafiaRoles, ...specialRoles, ...citizens];
  for (let i = rolesPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
  }
  players.forEach((player, index) => {
    player.role = rolesPool[index];
    player.isAlive = true;
    player.isMuted = false;
    player.revealedSheikh = false;
  });
  room.botBrains = {};
  players.forEach((player) => {
    if (player.isBot) {
      room.botBrains[player.id] = { suspicionScores: {} };
      if (player.role === "joker") {
        room.jokerChoice = Math.random() < 0.5 ? "first_night_death" : "first_vote_elimination";
      }
    }
  });
  room.round = 1;
  room.mafiaTarget = null;
  room.muteTarget = null;
  room.doctorTarget = null;
  room.sniperTarget = null;
  room.lastDoctorTarget = null;
  room.sniperHasShot = false;
  room.jokerChoice = null;
  room.jokerCopiedRole = null;
  room.firstNightDeathOccurred = false;
  room.firstVoteEliminationOccurred = false;
  room.votes = {};
  room.winner = null;
  room.nightOutcomeText = "";
  room.voteOutcomeText = "";
  room.messages = [];
  addSystemMessage(room, "\u{1F3C1} \u0628\u062F\u0623\u062A \u0627\u0644\u0644\u0639\u0628\u0629! \u062C\u0627\u0631\u064A \u062A\u0648\u0632\u064A\u0639 \u0627\u0644\u0623\u062F\u0648\u0627\u0631 \u0648\u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062A \u0633\u0631\u0627\u064B...");
}
function stopTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = void 0;
  }
}
function startPhaseTimer(room, duration, onComplete) {
  stopTimer(room);
  room.timer = duration;
  room.timerInterval = setInterval(() => {
    room.timer--;
    if (room.timer <= 0) {
      stopTimer(room);
      onComplete();
    } else {
      broadcastRoomState(room);
    }
  }, 1e3);
}
function enterNightPhase(room) {
  room.status = "night";
  room.votes = {};
  room.players.forEach((p) => {
    p.isMuted = false;
  });
  room.mafiaTarget = null;
  room.muteTarget = null;
  room.doctorTarget = null;
  room.sniperTarget = null;
  addSystemMessage(room, `\u{1F319} \u062D\u0644\u0651 \u0627\u0644\u0644\u064A\u0644... \u0627\u0644\u062C\u0648\u0644\u0629 ${room.round}. \u0627\u0644\u062C\u0645\u064A\u0639 \u064A\u063A\u0645\u0636 \u0639\u064A\u0646\u064A\u0647 \u0627\u0644\u0622\u0646.`);
  broadcastSound(room, "night_start");
  triggerBotNightActions(room);
  startPhaseTimer(room, 30, () => {
    resolveNightPhase(room);
  });
}
function resolveNightPhase(room) {
  broadcastSound(room, "timer_end");
  let killedPlayerId = null;
  const activeMuter = room.players.find((p) => p.isAlive && (p.role === "mafia_muter" || p.role === "mafia_single"));
  if (activeMuter && room.muteTarget) {
    const target = room.players.find((p) => p.id === room.muteTarget && p.isAlive);
    if (target) {
      target.isMuted = true;
      addSystemMessage(room, `\u{1F910} \u062A\u0645 \u062A\u0633\u0643\u064A\u062A \u0644\u0627\u0639\u0628 \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629 \u0648\u0633\u064A\u0639\u0627\u0646\u064A \u0641\u064A \u0627\u0644\u0646\u0647\u0627\u0631 \u0627\u0644\u0645\u0642\u0628\u0644.`, true);
      addGameEvent(room, "\u{1F910}", "\u0642\u0627\u0645\u062A \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0628\u0625\u0633\u0643\u0627\u062A \u0623\u062D\u062F \u0627\u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0648\u0644\u0629.");
    }
  }
  const activeKiller = room.players.find((p) => p.isAlive && (p.role === "mafia_killer" || p.role === "mafia_single"));
  let mafiaTargetId = null;
  if (activeKiller && room.mafiaTarget) {
    const target = room.players.find((p) => p.id === room.mafiaTarget && p.isAlive);
    if (target) {
      mafiaTargetId = target.id;
    }
  }
  const activeDoctor = room.players.find((p) => p.isAlive && p.role === "doctor");
  let isProtected = false;
  if (activeDoctor && room.doctorTarget) {
    if (room.doctorTarget === mafiaTargetId) {
      isProtected = true;
      room.lastDoctorTarget = room.doctorTarget;
      addGameEvent(room, "\u{1FA7A}", "\u0646\u062C\u062D \u0627\u0644\u0637\u0628\u064A\u0628 \u0641\u064A \u0625\u0646\u0642\u0627\u0630 \u0623\u062D\u062F \u0627\u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629.");
    } else {
      room.lastDoctorTarget = room.doctorTarget;
    }
  } else {
    room.lastDoctorTarget = null;
  }
  if (mafiaTargetId && !isProtected) {
    killedPlayerId = mafiaTargetId;
    addGameEvent(room, "\u{1F52A}", "\u0642\u0627\u0645\u062A \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0628\u0625\u0642\u0635\u0627\u0621 \u0623\u062D\u062F \u0627\u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629.");
  }
  const activeSniper = room.players.find((p) => p.isAlive && p.role === "sniper");
  if (activeSniper && room.sniperTarget && !room.sniperHasShot) {
    room.sniperHasShot = true;
    const sniperTarget = room.players.find((p) => p.id === room.sniperTarget && p.isAlive);
    if (sniperTarget) {
      killedPlayerId = sniperTarget.id;
      addGameEvent(room, "\u{1F3AF}", "\u0642\u0627\u0645 \u0627\u0644\u0642\u0646\u0627\u0635 \u0628\u0625\u0637\u0644\u0627\u0642 \u0637\u0644\u0642\u062A\u0647 \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629.");
    }
  }
  let deadPlayer = null;
  if (killedPlayerId) {
    const target = room.players.find((p) => p.id === killedPlayerId);
    if (target) {
      target.isAlive = false;
      deadPlayer = target;
    }
  }
  const joker = room.players.find((p) => p.isAlive && p.role === "joker");
  if (joker && deadPlayer && !room.firstNightDeathOccurred && room.jokerChoice === "first_night_death") {
    room.firstNightDeathOccurred = true;
    const roleToCopy = deadPlayer.role;
    joker.role = roleToCopy;
    room.jokerCopiedRole = roleToCopy;
    addSystemMessage(room, `\u{1F0CF} \u062A\u062D\u0648\u0644 \u0627\u0644\u062C\u0648\u0643\u0631 \u0633\u0631\u0627\u064B \u0625\u0644\u0649 \u062F\u0648\u0631 \u062C\u062F\u064A\u062F!`, true);
    if (roleToCopy.startsWith("mafia_")) {
      addSystemMessage(room, `\u{1F608} \u0627\u0646\u0636\u0645 \u0627\u0644\u062C\u0648\u0643\u0631 \u0625\u0644\u0649 \u0641\u0631\u064A\u0642 \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0628\u0627\u0633\u0645: ${joker.nickname}`, true);
    }
  }
  updateMafiaRolesIfNeeded(room);
  if (deadPlayer) {
    room.nightOutcomeText = `\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062C\u062B\u0629 \u0627\u0644\u0644\u0627\u0639\u0628 ${deadPlayer.nickname} \u0645\u0642\u062A\u0648\u0644\u0627\u064B \u0627\u0644\u0644\u064A\u0644\u0629\u060C \u0648\u062F\u0648\u0631\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0647\u0648: ${getRoleNameInArabic(deadPlayer.role)}.`;
    addSystemMessage(room, `\u{1F480} \u0639\u062B\u0631 \u0627\u0644\u0623\u0647\u0627\u0644\u064A \u0639\u0644\u0649 \u062C\u062B\u0629 ${deadPlayer.nickname} \u0641\u064A \u0627\u0644\u0635\u0628\u0627\u062D \u0648\u062F\u0648\u0631\u0647 \u0643\u0627\u0646: ${getRoleNameInArabic(deadPlayer.role)}.`);
    addGameEvent(room, "\u{1F480}", `\u062A\u0645 \u0643\u0634\u0641 \u0645\u0642\u062A\u0644 \u0627\u0644\u0644\u0627\u0639\u0628 ${deadPlayer.nickname} \u0627\u0644\u0644\u064A\u0644\u0629\u060C \u0648\u062F\u0648\u0631\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0647\u0648: ${getRoleNameInArabic(deadPlayer.role)}.`);
  } else {
    room.nightOutcomeText = "\u0644\u0645 \u064A\u0645\u062A \u0623\u062D\u062F \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629.";
    addSystemMessage(room, "\u2600\uFE0F \u0627\u0633\u062A\u064A\u0642\u0638\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0648\u0644\u0645 \u064A\u0645\u062A \u0623\u062D\u062F \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629. \u0627\u0644\u062D\u0645\u062F \u0644\u0644\u0647!");
    addGameEvent(room, "\u2600\uFE0F", "\u0627\u0633\u062A\u064A\u0642\u0638\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0648\u0644\u0645 \u064A\u0645\u062A \u0623\u062D\u062F \u0647\u0630\u0647 \u0627\u0644\u0644\u064A\u0644\u0629.");
  }
  const isGameOver = checkVictoryConditions(room);
  if (!isGameOver) {
    enterDayPhase(room);
  } else {
    broadcastRoomState(room);
  }
}
function updateMafiaRolesIfNeeded(room) {
  const livingMafia = room.players.filter((p) => p.isAlive && (p.role === "mafia_killer" || p.role === "mafia_muter" || p.role === "mafia_single"));
  if (livingMafia.length === 1) {
    const singleMafia = livingMafia[0];
    if (singleMafia.role !== "mafia_single") {
      singleMafia.role = "mafia_single";
    }
  }
}
function getRoleNameInArabic(role) {
  switch (role) {
    case "mafia_single":
    case "mafia_killer":
    case "mafia_muter":
      return "\u0645\u0627\u0641\u064A\u0627";
    case "doctor":
      return "\u0627\u0644\u062F\u0643\u062A\u0648\u0631";
    case "sniper":
      return "\u0627\u0644\u0642\u0646\u0627\u0635";
    case "sheikh":
      return "\u0627\u0644\u0634\u064A\u062E";
    case "joker":
      return "\u0627\u0644\u062C\u0648\u0643\u0631";
    case "citizen":
      return "\u0645\u0648\u0627\u0637\u0646";
    default:
      return "\u0645\u0648\u0627\u0637\u0646";
  }
}
function enterDayPhase(room) {
  room.status = "day";
  room.votes = {};
  room.voteOutcomeText = "";
  broadcastSound(room, "day_start");
  triggerBotDayStartResponses(room);
  startPhaseTimer(room, room.dayDuration, () => {
    enterVotingPhase(room);
  });
}
function enterVotingPhase(room) {
  room.status = "voting";
  room.votes = {};
  addSystemMessage(room, "\u2696\uFE0F \u0627\u0646\u062A\u0647\u0649 \u0627\u0644\u0646\u0642\u0627\u0634! \u062A\u0628\u062F\u0623 \u0627\u0644\u0622\u0646 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u062A\u0635\u0648\u064A\u062A \u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0634\u062E\u0635 \u0627\u0644\u0645\u0634\u062A\u0628\u0647 \u0628\u0647. \u0644\u062F\u064A\u0643\u0645 20 \u062B\u0627\u0646\u064A\u0629.");
  broadcastSound(room, "day_start");
  triggerBotVoting(room);
  startPhaseTimer(room, 20, () => {
    resolveVotingPhase(room);
  });
}
function resolveVotingPhase(room) {
  broadcastSound(room, "timer_end");
  const alivePlayers = room.players.filter((p) => p.isAlive);
  const voteTally = {};
  alivePlayers.forEach((p) => {
    voteTally[p.id] = 0;
  });
  Object.entries(room.votes).forEach(([voterId, votedId]) => {
    const voter = room.players.find((p) => p.id === voterId);
    if (voter && voter.isAlive && !voter.isMuted) {
      const voteWeight = voter.role === "sheikh" && voter.revealedSheikh ? 3 : 1;
      if (voteTally[votedId] !== void 0) {
        voteTally[votedId] += voteWeight;
      }
    }
  });
  let maxVotes = 0;
  let candidatesWithMax = [];
  Object.entries(voteTally).forEach(([id, votes]) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      candidatesWithMax = [id];
    } else if (votes === maxVotes && votes > 0) {
      candidatesWithMax.push(id);
    }
  });
  let eliminatedPlayer = null;
  if (maxVotes > 0 && candidatesWithMax.length === 1) {
    const pId = candidatesWithMax[0];
    const target = room.players.find((p) => p.id === pId);
    if (target) {
      target.isAlive = false;
      eliminatedPlayer = target;
    }
  }
  const joker = room.players.find((p) => p.isAlive && p.role === "joker");
  if (joker && eliminatedPlayer && !room.firstVoteEliminationOccurred && room.jokerChoice === "first_vote_elimination") {
    room.firstVoteEliminationOccurred = true;
    const roleToCopy = eliminatedPlayer.role;
    joker.role = roleToCopy;
    room.jokerCopiedRole = roleToCopy;
    addSystemMessage(room, `\u{1F0CF} \u062A\u062D\u0648\u0644 \u0627\u0644\u062C\u0648\u0643\u0631 \u0633\u0631\u0627\u064B \u0625\u0644\u0649 \u062F\u0648\u0631 \u062C\u062F\u064A\u062F!`, true);
    if (roleToCopy.startsWith("mafia_")) {
      addSystemMessage(room, `\u{1F608} \u0627\u0646\u0636\u0645 \u0627\u0644\u062C\u0648\u0643\u0631 \u0625\u0644\u0649 \u0641\u0631\u064A\u0642 \u0627\u0644\u0645\u0627\u0641\u064A\u0627 \u0628\u0627\u0633\u0645: ${joker.nickname}`, true);
    }
  }
  updateMafiaRolesIfNeeded(room);
  if (eliminatedPlayer) {
    room.voteOutcomeText = `\u0628\u0623\u063A\u0644\u0628\u064A\u0629 \u0627\u0644\u0623\u0635\u0648\u0627\u062A (${maxVotes} \u0635\u0648\u062A)\u060C \u062A\u0642\u0631\u0631 \u0625\u0642\u0635\u0627\u0621 \u0627\u0644\u0644\u0627\u0639\u0628 ${eliminatedPlayer.nickname}\u060C \u0648\u062F\u0648\u0631\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0647\u0648: ${getRoleNameInArabic(eliminatedPlayer.role)}.`;
    addSystemMessage(room, `\u2696\uFE0F \u0637\u0631\u062F\u062A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0627\u0644\u0644\u0627\u0639\u0628 ${eliminatedPlayer.nickname} \u0648\u062F\u0648\u0631\u0647 \u0643\u0627\u0646: ${getRoleNameInArabic(eliminatedPlayer.role)}.`);
    addGameEvent(room, "\u{1F5F3}\uFE0F", `\u062A\u0645 \u0625\u0642\u0635\u0627\u0621 ${eliminatedPlayer.nickname} \u0628\u0627\u0644\u062A\u0635\u0648\u064A\u062A\u060C \u0648\u0628\u0637\u0627\u0642\u062A\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0647\u064A: ${getRoleNameInArabic(eliminatedPlayer.role)}.`);
  } else {
    room.voteOutcomeText = "\u062A\u0639\u0627\u062F\u0644 \u0641\u064A \u0627\u0644\u062A\u0635\u0648\u064A\u062A\u060C \u0644\u0645 \u064A\u062A\u0645 \u0625\u0642\u0635\u0627\u0621 \u0623\u062D\u062F.";
    addSystemMessage(room, "\u2696\uFE0F \u062A\u0639\u0627\u062F\u0644 \u0641\u064A \u0627\u0644\u062A\u0635\u0648\u064A\u062A! \u0644\u0645 \u064A\u062A\u0641\u0642 \u0623\u0647\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0639\u0644\u0649 \u0637\u0631\u062F \u0623\u062D\u062F.");
    addGameEvent(room, "\u2696\uFE0F", "\u0627\u0646\u062A\u0647\u0649 \u0627\u0644\u062A\u0635\u0648\u064A\u062A \u0628\u0627\u0644\u062A\u0639\u0627\u062F\u0644\u060C \u0648\u0644\u0645 \u064A\u062A\u0645 \u0625\u0642\u0635\u0627\u0621 \u0623\u064A \u0644\u0627\u0639\u0628.");
  }
  const isGameOver = checkVictoryConditions(room);
  if (!isGameOver) {
    room.round++;
    enterNightPhase(room);
  } else {
    broadcastRoomState(room);
  }
}
function handleClientMessage(ws, clientId, messageStr) {
  let parsed;
  try {
    parsed = JSON.parse(messageStr);
  } catch (err) {
    return;
  }
  const { type, data } = parsed;
  let clientRoom = null;
  let clientPlayer = null;
  for (const r of Object.values(rooms)) {
    const p = r.players.find((player) => player.id === clientId);
    if (p) {
      clientRoom = r;
      clientPlayer = p;
      break;
    }
  }
  switch (type) {
    case "create_room": {
      const { nickname, dayDuration } = data;
      if (!nickname || typeof nickname !== "string" || nickname.trim() === "") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u0639\u0627\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" } }));
        return;
      }
      const parsedDuration = parseInt(dayDuration);
      if (isNaN(parsedDuration) || parsedDuration < 30) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0648\u0642\u062A \u0627\u0644\u0646\u0647\u0627\u0631 \u064A\u062C\u0628 \u0623\u0646 \u0644\u0627 \u064A\u0642\u0644 \u0639\u0646 30 \u062B\u0627\u0646\u064A\u0629" } }));
        return;
      }
      const roomCode = generateRoomCode();
      const newPlayer = {
        id: clientId,
        nickname: nickname.trim(),
        avatarId: Math.floor(Math.random() * 8) + 1,
        isHost: true,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        socket: ws
      };
      const newRoom = {
        code: roomCode,
        players: [newPlayer],
        status: "lobby",
        round: 1,
        dayDuration: parsedDuration,
        timer: 0,
        mafiaTarget: null,
        muteTarget: null,
        doctorTarget: null,
        sniperTarget: null,
        lastDoctorTarget: null,
        sniperHasShot: false,
        jokerChoice: null,
        jokerCopiedRole: null,
        firstNightDeathOccurred: false,
        firstVoteEliminationOccurred: false,
        votes: {},
        messages: [],
        winner: null,
        nightOutcomeText: "",
        voteOutcomeText: ""
      };
      rooms[roomCode] = newRoom;
      addSystemMessage(newRoom, `\u{1F44B} \u0642\u0627\u0645 ${newPlayer.nickname} \u0628\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u063A\u0631\u0641\u0629 \u0648\u0627\u0644\u0636\u0645 \u0625\u0644\u064A\u0647\u0627.`);
      broadcastRoomState(newRoom);
      break;
    }
    case "join_room": {
      const { nickname, roomCode } = data;
      if (!nickname || typeof nickname !== "string" || nickname.trim() === "") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u0639\u0627\u0631 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" } }));
        return;
      }
      if (!roomCode || typeof roomCode !== "string") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0643\u0648\u062F \u0627\u0644\u063A\u0631\u0641\u0629 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D" } }));
        return;
      }
      const targetRoomCode = roomCode.toUpperCase().trim();
      const room = rooms[targetRoomCode];
      if (!room) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u063A\u0631\u0641\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629\u060C \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0643\u0648\u062F" } }));
        return;
      }
      if (room.status !== "lobby") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u0644\u0639\u0628\u0629 \u0628\u062F\u0623\u062A \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u063A\u0631\u0641\u0629" } }));
        return;
      }
      if (room.players.length >= 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u063A\u0631\u0641\u0629 \u0645\u0645\u062A\u0644\u0626\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 (\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 18 \u0644\u0627\u0639\u0628)" } }));
        return;
      }
      const nameExists = room.players.some((p) => p.nickname.toLowerCase() === nickname.trim().toLowerCase());
      if (nameExists) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u0645\u0633\u062A\u062E\u062F\u0645 \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A \u0627\u0644\u063A\u0631\u0641\u0629" } }));
        return;
      }
      const newPlayer = {
        id: clientId,
        nickname: nickname.trim(),
        avatarId: Math.floor(Math.random() * 8) + 1,
        isHost: false,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        socket: ws
      };
      room.players.push(newPlayer);
      addSystemMessage(room, `\u{1F44B} \u0627\u0646\u0636\u0645 ${newPlayer.nickname} \u0625\u0644\u0649 \u0627\u0644\u063A\u0631\u0641\u0629.`);
      broadcastRoomState(room);
      break;
    }
    case "add_bot": {
      if (!clientRoom || !clientPlayer) return;
      if (!clientPlayer.isHost) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0641\u0642\u0637 \u0635\u0627\u062D\u0628 \u0627\u0644\u063A\u0631\u0641\u0629 \u064A\u0645\u0643\u0646\u0647 \u0625\u0636\u0627\u0641\u0629 \u0628\u0648\u062A\u0627\u062A" } }));
        return;
      }
      if (clientRoom.status !== "lobby") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0625\u0636\u0627\u0641\u0629 \u0628\u0648\u062A\u0627\u062A \u0628\u0639\u062F \u0628\u062F\u0621 \u0627\u0644\u0644\u0639\u0628\u0629" } }));
        return;
      }
      const botCount = clientRoom.players.filter((p) => p.isBot).length;
      if (botCount >= 7) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u062A\u0645 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0628\u0648\u062A\u0627\u062A \u0648\u0647\u0648 7 \u0628\u0648\u062A\u0627\u062A!" } }));
        return;
      }
      if (clientRoom.players.length >= 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u062A\u0645 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0639\u062F\u062F \u0627\u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0648\u0647\u0648 18 \u0644\u0627\u0639\u0628\u064B\u0627!" } }));
        return;
      }
      const existingNames = new Set(clientRoom.players.map((p) => p.nickname.toLowerCase()));
      const availableNames = BOT_NAMES.filter((name) => !existingNames.has(name.toLowerCase()));
      const botName = availableNames.length > 0 ? availableNames[Math.floor(Math.random() * availableNames.length)] : `\u0628\u0648\u062A ${botCount + 1}`;
      const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
      const newBot = {
        id: botId,
        nickname: botName,
        avatarId: Math.floor(Math.random() * 12) + 1,
        // 1 to 12 avatar IDs
        isHost: false,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        isBot: true
      };
      clientRoom.players.push(newBot);
      addSystemMessage(clientRoom, `\u{1F916} \u0627\u0646\u0636\u0645 \u0627\u0644\u0628\u0648\u062A ${newBot.nickname} \u0625\u0644\u0649 \u0627\u0644\u063A\u0631\u0641\u0629.`);
      broadcastRoomState(clientRoom);
      break;
    }
    case "leave_room": {
      if (clientRoom && clientPlayer) {
        removePlayerFromRoom(clientRoom, clientPlayer.id);
      }
      break;
    }
    case "start_game": {
      if (!clientRoom || !clientPlayer) return;
      if (!clientPlayer.isHost) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0635\u0627\u062D\u0628 \u0627\u0644\u063A\u0631\u0641\u0629 \u0641\u0642\u0637 \u064A\u0633\u062A\u0637\u064A\u0639 \u0628\u062F\u0621 \u0627\u0644\u0644\u0639\u0628\u0629" } }));
        return;
      }
      if (clientRoom.players.length < 7 || clientRoom.players.length > 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0639\u062F\u062F \u0627\u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0628\u064A\u0646 7 \u0648 18 \u0644\u0627\u0639\u0628 \u0644\u0628\u062F\u0621 \u0627\u0644\u0644\u0639\u0628\u0629" } }));
        return;
      }
      distributeRoles(clientRoom);
      clientRoom.status = "showing_roles";
      startPhaseTimer(clientRoom, 8, () => {
        enterNightPhase(clientRoom);
      });
      break;
    }
    case "joker_choice": {
      if (!clientRoom || !clientPlayer) return;
      if (clientPlayer.role !== "joker") return;
      if (clientRoom.status !== "showing_roles") return;
      const { choice } = data;
      if (choice === "first_night_death" || choice === "first_vote_elimination") {
        clientRoom.jokerChoice = choice;
        ws.send(JSON.stringify({
          type: "notification",
          data: { message: `\u062A\u0645 \u062A\u0623\u0643\u064A\u062F \u062E\u064A\u0627\u0631 \u0627\u0644\u0646\u0633\u062E: ${choice === "first_night_death" ? "\u0623\u0648\u0644 \u0645\u064A\u062A \u0628\u0627\u0644\u0644\u064A\u0644" : "\u0623\u0648\u0644 \u0645\u0637\u0631\u0648\u062F \u0628\u0627\u0644\u062A\u0635\u0648\u064A\u062A"}`, type: "success" }
        }));
        broadcastRoomState(clientRoom);
      }
      break;
    }
    case "submit_night_action": {
      if (!clientRoom || !clientPlayer) return;
      if (clientRoom.status !== "night") return;
      if (!clientPlayer.isAlive) return;
      const { actionType, targetId } = data;
      const targetPlayer = clientRoom.players.find((p) => p.id === targetId && p.isAlive);
      if (targetId && !targetPlayer) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u0644\u0627\u0639\u0628 \u0627\u0644\u0645\u062D\u062F\u062F \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F \u0623\u0648 \u0645\u064A\u062A" } }));
        return;
      }
      if (clientPlayer.role === "mafia_single") {
        if (actionType === "kill") {
          clientRoom.mafiaTarget = targetId || null;
        } else if (actionType === "mute") {
          clientRoom.muteTarget = targetId || null;
        }
      } else if (clientPlayer.role === "mafia_killer") {
        if (actionType === "kill") {
          clientRoom.mafiaTarget = targetId || null;
        }
      } else if (clientPlayer.role === "mafia_muter") {
        if (actionType === "mute") {
          clientRoom.muteTarget = targetId || null;
        }
      } else if (clientPlayer.role === "doctor") {
        if (actionType === "protect") {
          if (targetId && targetId === clientRoom.lastDoctorTarget) {
            ws.send(JSON.stringify({ type: "error", data: { message: "\u0644\u0627 \u064A\u0645\u0643\u0646\u0643 \u062D\u0645\u0627\u064A\u0629 \u0646\u0641\u0633 \u0627\u0644\u0634\u062E\u0635 \u0644\u064A\u0644\u062A\u064A\u0646 \u0645\u062A\u062A\u0627\u0644\u064A\u062A\u064A\u0646!" } }));
            return;
          }
          clientRoom.doctorTarget = targetId || null;
        }
      } else if (clientPlayer.role === "sniper") {
        if (actionType === "shoot") {
          if (clientRoom.sniperHasShot) {
            ws.send(JSON.stringify({ type: "error", data: { message: "\u0644\u0642\u062F \u0627\u0633\u062A\u0647\u0644\u0643\u062A \u0637\u0644\u0642\u062A\u0643 \u0627\u0644\u0648\u062D\u064A\u062F\u0629 \u0628\u0627\u0644\u0641\u0639\u0644!" } }));
            return;
          }
          clientRoom.sniperTarget = targetId || null;
        }
      }
      ws.send(JSON.stringify({ type: "sound", data: { sound: "vote_submit" } }));
      broadcastRoomState(clientRoom);
      break;
    }
    case "sheikh_reveal": {
      if (!clientRoom || !clientPlayer) return;
      if (clientRoom.status !== "day" && clientRoom.status !== "voting") return;
      if (!clientPlayer.isAlive) return;
      if (clientPlayer.role !== "sheikh") return;
      if (clientPlayer.revealedSheikh) return;
      clientPlayer.revealedSheikh = true;
      addSystemMessage(clientRoom, `\u{1F473} \u0643\u0634\u0641 \u0627\u0644\u0634\u064A\u062E ${clientPlayer.nickname} \u0639\u0646 \u0647\u0648\u064A\u062A\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629! \u0635\u0648\u062A\u0647 \u0627\u0644\u0622\u0646 \u064A\u062D\u062A\u0633\u0628 \u0628\u0640 3 \u0623\u0635\u0648\u0627\u062A.`);
      addGameEvent(clientRoom, "\u{1F473}", "\u0643\u0634\u0641 \u0627\u0644\u0634\u064A\u062E \u0639\u0646 \u0647\u0648\u064A\u062A\u0647\u060C \u0648\u0623\u0635\u0628\u062D \u0635\u0648\u062A\u0647 \u064A\u0639\u0627\u062F\u0644 \u062B\u0644\u0627\u062B\u0629 \u0623\u0635\u0648\u0627\u062A.");
      broadcastNotification(clientRoom, `\u{1F473} \u0643\u0634\u0641 \u0627\u0644\u0634\u064A\u062E ${clientPlayer.nickname} \u0639\u0646 \u0647\u0648\u064A\u062A\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629!`, "success");
      broadcastSound(clientRoom, "victory");
      broadcastRoomState(clientRoom);
      break;
    }
    case "send_message": {
      if (!clientRoom || !clientPlayer) return;
      const { text } = data;
      if (!text || typeof text !== "string" || text.trim() === "") return;
      const isDead = !clientPlayer.isAlive;
      const isMuted = clientPlayer.isMuted;
      if (clientRoom.status === "night") {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u062D\u062F\u062B \u0641\u064A \u0627\u0644\u0634\u0627\u062A \u062E\u0644\u0627\u0644 \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0644\u064A\u0644!" } }));
        return;
      }
      if (isMuted && !isDead) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0623\u0646\u062A \u0645\u0633\u0643\u0651\u062A \u0648\u0644\u0627 \u062A\u0633\u062A\u0637\u064A\u0639 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0631\u0633\u0627\u0626\u0644!" } }));
        return;
      }
      const newMessage = {
        id: generateId(),
        senderId: clientPlayer.id,
        senderName: clientPlayer.nickname,
        text: text.trim(),
        time: getFormattedTime(),
        isSystem: false,
        isDeadChat: isDead
      };
      clientRoom.messages.push(newMessage);
      broadcastRoomState(clientRoom);
      if (clientRoom.status === "day" && !clientPlayer.isBot) {
        const aliveBots = clientRoom.players.filter((p) => p.isAlive && p.isBot);
        if (aliveBots.length > 0 && Math.random() < 0.35) {
          const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
          const delay = (2 + Math.random() * 5) * 1e3;
          setTimeout(() => {
            if (clientRoom && clientRoom.status === "day" && randomBot.isAlive) {
              handleBotSpeaks(clientRoom, randomBot);
            }
          }, delay);
        }
      }
      break;
    }
    case "submit_vote": {
      if (!clientRoom || !clientPlayer) return;
      if (clientRoom.status !== "voting") return;
      if (!clientPlayer.isAlive) return;
      if (clientPlayer.isMuted) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0623\u0646\u062A \u0645\u0633\u0643\u0651\u062A \u0627\u0644\u064A\u0648\u0645 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062A\u0635\u0648\u064A\u062A!" } }));
        return;
      }
      const { targetId } = data;
      const targetPlayer = clientRoom.players.find((p) => p.id === targetId && p.isAlive);
      if (!targetPlayer) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0627\u0644\u0644\u0627\u0639\u0628 \u0627\u0644\u0645\u062D\u062F\u062F \u0644\u0644\u062A\u0635\u0648\u064A\u062A \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0623\u0648 \u0645\u064A\u062A" } }));
        return;
      }
      if (clientRoom.votes[clientPlayer.id]) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0644\u0642\u062F \u0642\u0645\u062A \u0628\u0627\u0644\u062A\u0635\u0648\u064A\u062A \u0628\u0627\u0644\u0641\u0639\u0644\u060C \u0644\u0627 \u064A\u0645\u0643\u0646 \u062A\u063A\u064A\u064A\u0631\u0647!" } }));
        return;
      }
      clientRoom.votes[clientPlayer.id] = targetId;
      addSystemMessage(clientRoom, `\u{1F5F3}\uFE0F \u0635\u0648\u062A ${clientPlayer.nickname} \u0644\u0635\u0627\u0644\u062D ${targetPlayer.nickname}.`);
      broadcastSound(clientRoom, "vote_submit");
      broadcastRoomState(clientRoom);
      const totalEligibleVoters = clientRoom.players.filter((p) => p.isAlive && !p.isMuted).length;
      const totalVotedCount = Object.keys(clientRoom.votes).length;
      if (totalVotedCount === totalEligibleVoters) {
        stopTimer(clientRoom);
        resolveVotingPhase(clientRoom);
      }
      break;
    }
    case "restart_game": {
      if (!clientRoom || !clientPlayer) return;
      if (!clientPlayer.isHost) {
        ws.send(JSON.stringify({ type: "error", data: { message: "\u0635\u0627\u062D\u0628 \u0627\u0644\u063A\u0631\u0641\u0629 \u0641\u0642\u0637 \u064A\u0633\u062A\u0637\u064A\u0639 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0644\u0639\u0628\u0629" } }));
        return;
      }
      clientRoom.status = "lobby";
      clientRoom.round = 1;
      clientRoom.players.forEach((p) => {
        p.role = "";
        p.isAlive = true;
        p.isMuted = false;
        p.revealedSheikh = false;
      });
      clientRoom.messages = [];
      clientRoom.votes = {};
      clientRoom.winner = null;
      clientRoom.nightOutcomeText = "";
      clientRoom.voteOutcomeText = "";
      clientRoom.mafiaTarget = null;
      clientRoom.muteTarget = null;
      clientRoom.doctorTarget = null;
      clientRoom.sniperTarget = null;
      clientRoom.jokerChoice = null;
      clientRoom.jokerCopiedRole = null;
      stopTimer(clientRoom);
      addSystemMessage(clientRoom, `\u{1F3C1} \u062A\u0645 \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0644\u0639\u0628\u0629 \u0625\u0644\u0649 \u0627\u0644\u0644\u0648\u0628\u064A \u0628\u0648\u0627\u0633\u0637\u0629 \u0635\u0627\u062D\u0628 \u0627\u0644\u063A\u0631\u0641\u0629. \u064A\u0645\u0643\u0646 \u0644\u0644\u0627\u0639\u0628\u064A\u0646 \u0627\u0644\u0627\u0633\u062A\u0639\u062F\u0627\u062F.`);
      broadcastRoomState(clientRoom);
      break;
    }
    case "heartbeat": {
      ws.send(JSON.stringify({ type: "heartbeat_ack" }));
      break;
    }
  }
}
function removePlayerFromRoom(room, playerId) {
  const playerIndex = room.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) return;
  const player = room.players[playerIndex];
  room.players.splice(playerIndex, 1);
  addSystemMessage(room, `\u{1F6AA} \u063A\u0627\u062F\u0631 ${player.nickname} \u0627\u0644\u063A\u0631\u0641\u0629.`);
  if (player.isHost && room.players.length > 0) {
    room.players[0].isHost = true;
    addSystemMessage(room, `\u{1F451} \u0627\u0646\u062A\u0642\u0644\u062A \u0645\u0644\u0643\u064A\u0629 \u0627\u0644\u063A\u0631\u0641\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0625\u0644\u0649 ${room.players[0].nickname}.`);
  }
  if (room.status !== "lobby" && room.status !== "game_over" && player.isAlive) {
    checkVictoryConditions(room);
  }
  const humanPlayers = room.players.filter((p) => !p.isBot);
  if (humanPlayers.length === 0) {
    stopTimer(room);
    delete rooms[room.code];
  } else {
    broadcastRoomState(room);
  }
}
function handlePlayerDisconnect(clientId) {
  let matchedRoom = null;
  let matchedPlayer = null;
  for (const r of Object.values(rooms)) {
    const p = r.players.find((player) => player.id === clientId);
    if (p) {
      matchedRoom = r;
      matchedPlayer = p;
      break;
    }
  }
  if (!matchedRoom || !matchedPlayer) return;
  removePlayerFromRoom(matchedRoom, clientId);
}
async function startServer() {
  const app = (0, import_express.default)();
  const server = import_http.default.createServer(app);
  const wss = new import_ws.WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const clientId = generateId();
    ws.on("message", (messageStr) => {
      handleClientMessage(ws, clientId, messageStr.toString());
    });
    ws.on("close", () => {
      handlePlayerDisconnect(clientId);
    });
    ws.send(JSON.stringify({ type: "connection_ack", data: { clientId } }));
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRoomsCount: Object.keys(rooms).length });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const PORT = 3e3;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
