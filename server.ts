import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Initialize Gemini API
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

const BOT_NAMES = [
  "المفتش كولومبو",
  "الذئب المنفرد",
  "صقر المدينة",
  "العميل الصامت",
  "أبو العريف",
  "القناع الأسود",
  "الفهد الأسمر",
  "الظل الخفي",
  "المحقق الذكي",
  "شيرلوك هولمز",
  "Silent Shadow",
  "Midnight Spy",
  "Alpha Agent",
  "Inspector Morse",
  "Phoenix",
  "Ghost Rider",
  "Cunning Fox",
  "Desert Falcon",
  "حارس الغموض",
  "العقل المدبر",
];

// ==========================================
// 1. DATA STRUCTURES & INTERFACES
// ==========================================

export interface Player {
  id: string;
  nickname: string;
  avatarId: number; // 1 to 8 (humans) or 1 to 12 (bots)
  isHost: boolean;
  isAlive: boolean;
  isOffline: boolean;
  role: string; // 'mafia_killer' | 'mafia_muter' | 'mafia_single' | 'doctor' | 'sniper' | 'sheikh' | 'joker' | 'citizen' | ''
  isMuted: boolean; // Muted for the current day
  revealedSheikh: boolean; // If Sheikh has revealed himself
  socket?: WebSocket;
  isBot?: boolean;
}

export interface Message {
  id: string;
  senderId: string | null; // null for system
  senderName: string;
  text: string;
  time: string;
  isSystem: boolean;
  isDeadChat: boolean;
}

export interface GameEvent {
  id: string;
  icon: string;
  text: string;
  time: string;
  round: number;
}

export interface Room {
  code: string;
  players: Player[];
  status: "lobby" | "showing_roles" | "night" | "day" | "voting" | "game_over";
  eventsLog?: GameEvent[];
  round: number;
  dayDuration: number; // in seconds
  timer: number; // current phase timer
  timerInterval?: NodeJS.Timeout;
  
  // Game state variables
  mafiaTarget: string | null;  // Player ID to kill
  muteTarget: string | null;   // Player ID to mute
  doctorTarget: string | null; // Player ID to protect
  sniperTarget: string | null; // Player ID to shoot
  
  lastDoctorTarget: string | null; // Prevent protecting same player twice in a row
  sniperHasShot: boolean;          // Has the sniper shot in this game?
  
  jokerChoice: "first_night_death" | "first_vote_elimination" | null;
  jokerCopiedRole: string | null; // The role the joker copied
  
  firstNightDeathOccurred: boolean; // Has the first night death happened?
  firstVoteEliminationOccurred: boolean; // Has the first vote elimination happened?
  
  votes: Record<string, string>; // Voter Player ID -> Voted Player ID
  messages: Message[];
  winner: "citizens" | "mafia" | null;
  
  // Transitions & info alerts
  nightOutcomeText: string;
  voteOutcomeText: string;

  // Bot brains
  botBrains?: Record<string, { suspicionScores: Record<string, number> }>;
}

// Global in-memory rooms database
const rooms: Record<string, Room> = {};

// ==========================================
// 2. HELPER UTILITIES
// ==========================================

// Generate a random 5-character room code (uppercase alphanumeric)
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars like I, O, 0, 1
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]); // Ensure unique
  return code;
}

// Generate a random unique message ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Get clean formatted time (HH:MM)
function getFormattedTime(): string {
  const now = new Date();
  return now.toTimeString().split(" ")[0].substring(0, 5);
}

// Log message to a room
function addSystemMessage(room: Room, text: string, isDeadChat = false) {
  const message: Message = {
    id: generateId(),
    senderId: null,
    senderName: "النظام",
    text,
    time: getFormattedTime(),
    isSystem: true,
    isDeadChat,
  };
  room.messages.push(message);
}

// Log a game event
function addGameEvent(room: Room, icon: string, text: string) {
  if (!room.eventsLog) {
    room.eventsLog = [];
  }
  const newEvent: GameEvent = {
    id: generateId(),
    icon,
    text,
    time: getFormattedTime(),
    round: room.round,
  };
  room.eventsLog.push(newEvent);
}

// ==========================================
// 3. SECURITY & STATE SANITIZATION
// ==========================================

/**
 * Returns a clean, secure view of the room state for a specific player.
 * Ensures players cannot see other players' private roles or night targets.
 */
function getCleanRoomState(room: Room, playerId: string) {
  const viewer = room.players.find((p) => p.id === playerId);
  const viewerRole = viewer?.role || "";
  const isViewerMafia = viewerRole.startsWith("mafia_");

  const cleanPlayers = room.players.map((p) => {
    // Determine if we should reveal this player's role to the viewer
    let revealedRole = "";
    
    if (p.id === playerId) {
      revealedRole = p.role;
    } else if (room.status === "game_over") {
      revealedRole = p.role;
    } else if (!p.isAlive) {
      revealedRole = p.role;
    } else if (p.revealedSheikh) {
      revealedRole = "sheikh"; // Only show "sheikh", nothing else
    } else if (isViewerMafia && p.role.startsWith("mafia_")) {
      revealedRole = "mafia_team"; // Mafia members know other Mafia members but not their exact detailed role
    }

    return {
      id: p.id,
      nickname: p.nickname,
      avatarId: p.avatarId,
      isHost: p.isHost,
      isAlive: p.isAlive,
      isOffline: p.isOffline,
      role: revealedRole, // Stripped or revealed based on rules
      isMuted: p.isMuted,
      revealedSheikh: p.revealedSheikh,
    };
  });

  // Strip sensitive night targets from non-authorized roles
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
        // Only dead players can read dead chat
        return viewer && !viewer.isAlive;
      }
      return true; // All players can read general chat
    }),
    
    // Share night target info ONLY with appropriate players for UI feedback
    mafiaTarget: (isViewerMafia && (viewerRole === "mafia_killer" || viewerRole === "mafia_single")) ? room.mafiaTarget : null,
    muteTarget: (isViewerMafia && (viewerRole === "mafia_muter" || viewerRole === "mafia_single")) ? room.muteTarget : null,
    doctorTarget: (viewerRole === "doctor") ? room.doctorTarget : null,
    sniperTarget: (viewerRole === "sniper") ? room.sniperTarget : null,
    sniperHasShot: room.sniperHasShot,
    jokerChoice: (viewerRole === "joker") ? room.jokerChoice : null,
    eventsLog: room.eventsLog || [],
  };

  return cleanRoom;
}

// Broadcast to all connected players in a room (with safe customized state for each)
function broadcastRoomState(room: Room) {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "room_state",
          data: {
            room: getCleanRoomState(room, player.id),
            playerId: player.id,
          },
        })
      );
    }
  });
}

// Send a sound cue to all connected players in a room
function broadcastSound(room: Room, soundType: string) {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "sound",
          data: { sound: soundType },
        })
      );
    }
  });
}

// Send a visual notification/alert to all connected players in a room
function broadcastNotification(room: Room, message: string, type: "info" | "success" | "danger" = "info") {
  room.players.forEach((player) => {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(
        JSON.stringify({
          type: "notification",
          data: { message, type },
        })
      );
    }
  });
}

// ==========================================
// 3. AI BOT ENGINE
// ==========================================

async function generateBotResponseWithFallback(prompt: string): Promise<any> {
  const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });
        const text = response.text || "";
        return JSON.parse(text.trim());
      } catch (err: any) {
        lastError = err;
        console.warn(`Attempt ${attempt} using ${model} failed for bot speech:`, err?.message || err);
        // Wait briefly (backoff)
        await new Promise(resolve => setTimeout(resolve, attempt * 600));
      }
    }
  }
  throw lastError;
}

async function handleBotSpeaks(room: Room, bot: Player) {
  if (!room.botBrains) {
    room.botBrains = {};
  }
  if (!room.botBrains[bot.id]) {
    room.botBrains[bot.id] = { suspicionScores: {} };
  }

  const brain = room.botBrains[bot.id];

  const arabicFallbacks = [
    "أعتقد أن هناك شيئاً مريباً يحدث هنا... يجب أن نركز!",
    "أنا مواطن بريء تماماً، أرجوكم لا تتسرعوا في الحكم.",
    "من هو برأيكم المشبوه الأكبر في هذه الجولة؟",
    "علينا أن نكون حذرين، المافيا تحاول تشتيتنا.",
    "الشيخ هو من يستطيع كشف الحقيقة، دعونا ننتظر إشارته.",
    "لماذا تلتزم الصمت يا صديقي؟ هذا يثير الشكوك!",
    "أنا أثق بقرارات الدكتور، أتمنى أن يحمينا جميعاً.",
    "التصويت العشوائي سيضر بمصلحة البلدة، فلنفكر جيداً.",
    "المافيا بيننا... أشعر بوجودهم!"
  ];

  let text = "";

  if (process.env.GEMINI_API_KEY) {
    try {
      const playersInfo = room.players.map(p => {
        let details = `${p.nickname} (ID: ${p.id}) - ${p.isAlive ? "حي" : "ميت"}`;
        if (p.isBot) details += " (بوت)";
        if (p.role === "sheikh" && p.revealedSheikh) details += " (شيخ معلن)";
        return details;
      }).join("\n");

      const deadPlayersWithRoles = room.players.filter(p => !p.isAlive).map(p => {
        return `${p.nickname} (دوره الحقيقي: ${getRoleNameInArabic(p.role)})`;
      }).join("، ") || "لا أحد";

      const recentChat = room.messages.slice(-15).map(m => {
        return `${m.senderName}: ${m.text}`;
      }).join("\n");

      const otherMafia = room.players.filter(p => p.id !== bot.id && p.role.startsWith("mafia_") && p.isAlive).map(p => p.nickname).join("، ") || "لا أحد";

      const prompt = `
أنت تلعب لعبة المافيا (Mafia/Werewolf) الاجتماعية باللغة العربية.
هويتك في هذه اللعبة:
- اسمك المستعار: ${bot.nickname}
- دورك السري: ${getRoleNameInArabic(bot.role)} (${bot.role})
- حالتك: حي

معلومات اللعبة الحالية:
- الجولة: ${room.round}
- المرحلة الحالية: ${room.status === "day" ? "النهار (نقاش)" : "التصويت"}
- اللاعبون المتواجدون وحالتهم:
${playersInfo}
- اللاعبون الذين ماتوا وأدوارهم: ${deadPlayersWithRoles}
${bot.role.startsWith("mafia_") ? `- شركاؤك في المافيا الأحياء: ${otherMafia}` : ""}

المحادثات الأخيرة في الشات العام:
${recentChat || "لا توجد رسائل بعد."}

المطلب:
1. اكتب رسالة قصيرة ومقنعة وطبيعية باللغة العربية الفصحى أو بلهجة عربية عامية خفيفة (رسالة واحدة فقط لا تزيد عن سطرين). تفاعل مع الرسائل السابقة وادفع بآرائك:
   - إذا تم اتهامك مؤخراً، دافع عن نفسك بقوة ولا تكن بارداً.
   - إذا كنت مافيا، اكذب لتوجيه الشكوك بعيداً عنك وعن شركائك.
   - إذا كنت مواطناً، حاول اقتراح مشبوهين بناءً على من يتصرف بغرابة أو يصمت كثيراً.
2. قيّم شكوكك في كل لاعب حي آخر من 0 إلى 100.

أعد النتيجة ككائن JSON حصراً بهذا الشكل (لا تضع أي كلام آخر خارج الـ JSON):
{
  "message": "نص الرسالة بالكامل",
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

  const newMessage: Message = {
    id: generateId(),
    senderId: bot.id,
    senderName: bot.nickname,
    text: text.trim(),
    time: getFormattedTime(),
    isSystem: false,
    isDeadChat: false,
  };

  room.messages.push(newMessage);
  broadcastRoomState(room);
}

function triggerBotDayStartResponses(room: Room) {
  const aliveBots = room.players.filter(p => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;

  const botsToSpeak = aliveBots.sort(() => 0.5 - Math.random()).slice(0, Math.min(aliveBots.length, 2));

  botsToSpeak.forEach((bot, index) => {
    const delay = (2 + Math.random() * 5) * 1000 + (index * 4000); // 2-7s + spacing
    setTimeout(() => {
      if (room.status !== "day" || !bot.isAlive) return;
      handleBotSpeaks(room, bot);
    }, delay);
  });
}

function triggerBotNightActions(room: Room) {
  if (room.status !== "night") return;

  const aliveBots = room.players.filter(p => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;

  aliveBots.forEach(bot => {
    const delay = 3000 + Math.random() * 7000; // 3 to 10 seconds
    setTimeout(async () => {
      if (room.status !== "night" || !bot.isAlive) return;

      const alivePlayers = room.players.filter(p => p.isAlive);
      const otherPlayers = alivePlayers.filter(p => p.id !== bot.id);
      if (otherPlayers.length === 0) return;

      if (bot.role === "mafia_killer" || bot.role === "mafia_single") {
        const citizens = otherPlayers.filter(p => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const target = citizens[Math.floor(Math.random() * citizens.length)];
          room.mafiaTarget = target.id;
          broadcastRoomState(room);
        }
      } 
      else if (bot.role === "mafia_muter") {
        const citizens = otherPlayers.filter(p => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const target = citizens[Math.floor(Math.random() * citizens.length)];
          room.muteTarget = target.id;
          broadcastRoomState(room);
        }
      }
      else if (bot.role === "doctor") {
        const possibleTargets = alivePlayers.filter(p => p.id !== room.lastDoctorTarget);
        if (possibleTargets.length > 0) {
          const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
          room.doctorTarget = target.id;
          broadcastRoomState(room);
        }
      }
      else if (bot.role === "sniper" && !room.sniperHasShot) {
        const brain = room.botBrains?.[bot.id];
        let targetId: string | null = null;
        if (brain) {
          const highSuspects = Object.entries(brain.suspicionScores)
            .filter(([id, score]) => score > 70 && room.players.find(p => p.id === id && p.isAlive))
            .sort((a, b) => b[1] - a[1]);
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

function triggerBotVoting(room: Room) {
  if (room.status !== "voting") return;

  const aliveBots = room.players.filter(p => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;

  aliveBots.forEach(bot => {
    const delay = 4000 + Math.random() * 8000; // 4 to 12 seconds
    setTimeout(async () => {
      if (room.status !== "voting" || !bot.isAlive) return;
      if (room.votes[bot.id]) return;

      const otherAlivePlayers = room.players.filter(p => p.isAlive && p.id !== bot.id);
      if (otherAlivePlayers.length === 0) return;

      let targetId: string | null = null;

      if (bot.role.startsWith("mafia_")) {
        const citizens = otherAlivePlayers.filter(p => !p.role.startsWith("mafia_"));
        if (citizens.length > 0) {
          const brain = room.botBrains?.[bot.id];
          if (brain) {
            const citizensWithScores = citizens.map(c => ({
              id: c.id,
              score: brain.suspicionScores[c.id] || 50
            })).sort((a, b) => b.score - a.score);
            targetId = citizensWithScores[0].id;
          } else {
            targetId = citizens[Math.floor(Math.random() * citizens.length)].id;
          }
        }
      } 
      else {
        const brain = room.botBrains?.[bot.id];
        if (brain) {
          const suspects = otherAlivePlayers.map(p => ({
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
        addSystemMessage(room, `🗳️ أدلى اللاعب ${bot.nickname} بصوته.`);
        broadcastRoomState(room);

        const activeVoters = room.players.filter(p => p.isAlive && !p.isMuted);
        const totalVotedCount = Object.keys(room.votes).length;
        if (totalVotedCount === activeVoters.length) {
          stopTimer(room);
          resolveVotingPhase(room);
        }
      }
    }, delay);
  });
}

// ==========================================
// 4. GAME VICTORY LOGIC
// ==========================================

function checkVictoryConditions(room: Room): boolean {
  const alivePlayers = room.players.filter((p) => p.isAlive);
  const aliveMafia = alivePlayers.filter((p) => p.role.startsWith("mafia_"));
  const aliveCitizens = alivePlayers.filter((p) => !p.role.startsWith("mafia_"));

  // 1. Citizens Win: No Mafia alive
  if (aliveMafia.length === 0) {
    room.status = "game_over";
    room.winner = "citizens";
    addSystemMessage(room, "🎉 مبروك! فاز فريق المواطنين بالقضاء على جميع أفراد المافيا.");
    broadcastSound(room, "victory");
    stopTimer(room);
    return true;
  }

  // 2. Mafia Win: Mafia count >= Citizens count
  if (aliveMafia.length >= aliveCitizens.length) {
    room.status = "game_over";
    room.winner = "mafia";
    addSystemMessage(room, "👿 فازت المافيا! لقد سيطروا على المدينة وأصبح عددهم مساوياً أو أكبر من المواطنين الأحياء.");
    broadcastSound(room, "victory");
    stopTimer(room);
    return true;
  }

  return false;
}

// ==========================================
// 5. ROLE DISTRIBUTION ALGORITHM
// ==========================================

function distributeRoles(room: Room) {
  const players = room.players;
  const numPlayers = players.length;

  // Reset events log for a fresh game
  room.eventsLog = [];

  // Roles pool
  let mafiaCount = 2;
  if (numPlayers === 7) {
    mafiaCount = 1;
  }

  // Define roles to distribute
  const specialRoles: string[] = ["doctor", "sniper", "sheikh", "joker"];
  const mafiaRoles: string[] = [];
  
  if (mafiaCount === 1) {
    mafiaRoles.push("mafia_single");
  } else {
    mafiaRoles.push("mafia_killer", "mafia_muter");
  }

  const citizenCount = numPlayers - mafiaCount - specialRoles.length;
  const citizens: string[] = Array(citizenCount).fill("citizen");

  // Combine all roles
  const rolesPool = [...mafiaRoles, ...specialRoles, ...citizens];

  // Shuffle rolesPool using Fisher-Yates shuffle
  for (let i = rolesPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
  }

  // Assign to players
  players.forEach((player, index) => {
    player.role = rolesPool[index];
    player.isAlive = true;
    player.isMuted = false;
    player.revealedSheikh = false;
  });

  // Reset room state and initialize bot brains
  room.botBrains = {};
  players.forEach((player) => {
    if (player.isBot) {
      room.botBrains![player.id] = { suspicionScores: {} };
      
      // Auto-assign Joker choice if bot is Joker
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

  addSystemMessage(room, "🏁 بدأت اللعبة! جاري توزيع الأدوار والبطاقات سراً...");
}

// ==========================================
// 6. GAME LOOP RUNTIME TIMERS
// ==========================================

function stopTimer(room: Room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = undefined;
  }
}

function startPhaseTimer(room: Room, duration: number, onComplete: () => void) {
  stopTimer(room);
  room.timer = duration;
  
  room.timerInterval = setInterval(() => {
    room.timer--;
    if (room.timer <= 0) {
      stopTimer(room);
      onComplete();
    } else {
      // Periodic update for ticks
      broadcastRoomState(room);
    }
  }, 1000);
}

// Transition to Night Phase
function enterNightPhase(room: Room) {
  room.status = "night";
  room.votes = {}; // Clear votes
  
  // Clear players muted status from the previous round (as mute is for one day only)
  // But wait! "التسكيت يستمر نهاراً واحداً فقط ثم يزول تلقائياً"
  // So they are muted during the Day, but during the following Night they are fine.
  // Actually, let's keep isMuted true during the night? No, they can use their abilities during the night except if they are muted.
  // Wait, let's read carefully: "لا يستطيع استخدام أي قدرة أثناء ذلك النهار."
  // So the muting is active only during the Day (النهار).
  room.players.forEach(p => { p.isMuted = false; });

  // Reset night selections
  room.mafiaTarget = null;
  room.muteTarget = null;
  room.doctorTarget = null;
  room.sniperTarget = null;

  addSystemMessage(room, `🌙 حلّ الليل... الجولة ${room.round}. الجميع يغمض عينيه الآن.`);
  broadcastSound(room, "night_start");

  // Trigger AI bot night actions
  triggerBotNightActions(room);

  // Night duration is exactly 30 seconds
  startPhaseTimer(room, 30, () => {
    resolveNightPhase(room);
  });
}

// Resolves all night actions in strict sequence
function resolveNightPhase(room: Room) {
  broadcastSound(room, "timer_end");
  
  // Keep track of who died tonight
  let killedPlayerId: string | null = null;
  
  // 1. Resolve Mute
  const activeMuter = room.players.find(p => p.isAlive && (p.role === "mafia_muter" || p.role === "mafia_single"));
  if (activeMuter && room.muteTarget) {
    const target = room.players.find(p => p.id === room.muteTarget && p.isAlive);
    if (target) {
      // Check if target is Sheikh and hasn't revealed yet (Sheikh can still use their reveal action, but let's set mute state)
      target.isMuted = true;
      addSystemMessage(room, `🤐 تم تسكيت لاعب هذه الليلة وسيعاني في النهار المقبل.`, true); // Dead chat / Server log
      addGameEvent(room, "🤐", "قامت المافيا بإسكات أحد اللاعبين لهذه الجولة.");
    }
  }

  // 2. Resolve Mafia Kill
  const activeKiller = room.players.find(p => p.isAlive && (p.role === "mafia_killer" || p.role === "mafia_single"));
  let mafiaTargetId: string | null = null;
  if (activeKiller && room.mafiaTarget) {
    const target = room.players.find(p => p.id === room.mafiaTarget && p.isAlive);
    if (target) {
      mafiaTargetId = target.id;
    }
  }

  // 3. Resolve Doctor Protection
  const activeDoctor = room.players.find(p => p.isAlive && p.role === "doctor");
  let isProtected = false;
  if (activeDoctor && room.doctorTarget) {
    if (room.doctorTarget === mafiaTargetId) {
      isProtected = true;
      room.lastDoctorTarget = room.doctorTarget; // Update last protected for next night check
      addGameEvent(room, "🩺", "نجح الطبيب في إنقاذ أحد اللاعبين هذه الليلة.");
    } else {
      room.lastDoctorTarget = room.doctorTarget;
    }
  } else {
    room.lastDoctorTarget = null;
  }

  // If mafia killed someone and doctor did not protect them
  if (mafiaTargetId && !isProtected) {
    killedPlayerId = mafiaTargetId;
    addGameEvent(room, "🔪", "قامت المافيا بإقصاء أحد اللاعبين هذه الليلة.");
  }

  // 4. Resolve Sniper shot (acts after Doctor and Mafia, unstoppable)
  const activeSniper = room.players.find(p => p.isAlive && p.role === "sniper");
  if (activeSniper && room.sniperTarget && !room.sniperHasShot) {
    room.sniperHasShot = true; // Spend bullet permanently
    const sniperTarget = room.players.find(p => p.id === room.sniperTarget && p.isAlive);
    if (sniperTarget) {
      killedPlayerId = sniperTarget.id; // Lethal bullet, overrides doctor or mafia target
      addGameEvent(room, "🎯", "قام القناص بإطلاق طلقته هذه الليلة.");
    }
  }

  // Apply death if anyone died
  let deadPlayer: Player | null = null;
  if (killedPlayerId) {
    const target = room.players.find(p => p.id === killedPlayerId);
    if (target) {
      target.isAlive = false;
      deadPlayer = target;
    }
  }

  // Apply Joker trigger if Joker is alive and trigger is 'first_night_death'
  const joker = room.players.find(p => p.isAlive && p.role === "joker");
  if (joker && deadPlayer && !room.firstNightDeathOccurred && room.jokerChoice === "first_night_death") {
    room.firstNightDeathOccurred = true;
    
    // Copy the role of the dead player!
    const roleToCopy = deadPlayer.role;
    joker.role = roleToCopy;
    room.jokerCopiedRole = roleToCopy;

    addSystemMessage(room, `🃏 تحول الجوكر سراً إلى دور جديد!`, true);

    // If copied Mafia, notify other Mafia members by system log
    if (roleToCopy.startsWith("mafia_")) {
      addSystemMessage(room, `😈 انضم الجوكر إلى فريق المافيا باسم: ${joker.nickname}`, true);
    }
  }

  // Update Mafia roles if one of them died
  updateMafiaRolesIfNeeded(room);

  // Setup transition outcome text
  if (deadPlayer) {
    room.nightOutcomeText = `تم العثور على جثة اللاعب ${deadPlayer.nickname} مقتولاً الليلة، ودوره الحقيقي هو: ${getRoleNameInArabic(deadPlayer.role)}.`;
    addSystemMessage(room, `💀 عثر الأهالي على جثة ${deadPlayer.nickname} في الصباح ودوره كان: ${getRoleNameInArabic(deadPlayer.role)}.`);
    addGameEvent(room, "💀", `تم كشف مقتل اللاعب ${deadPlayer.nickname} الليلة، ودوره الحقيقي هو: ${getRoleNameInArabic(deadPlayer.role)}.`);
  } else {
    room.nightOutcomeText = "لم يمت أحد هذه الليلة.";
    addSystemMessage(room, "☀️ استيقظت المدينة ولم يمت أحد هذه الليلة. الحمد لله!");
    addGameEvent(room, "☀️", "استيقظت المدينة ولم يمت أحد هذه الليلة.");
  }

  // Check victory conditions before entering day
  const isGameOver = checkVictoryConditions(room);
  if (!isGameOver) {
    enterDayPhase(room);
  } else {
    broadcastRoomState(room);
  }
}

/**
 * If only one living Mafia member remains, their role is automatically promoted
 * to 'mafia_single' so they possess both 'kill' and 'mute' abilities silently.
 */
function updateMafiaRolesIfNeeded(room: Room) {
  const livingMafia = room.players.filter(p => p.isAlive && (p.role === "mafia_killer" || p.role === "mafia_muter" || p.role === "mafia_single"));
  if (livingMafia.length === 1) {
    const singleMafia = livingMafia[0];
    if (singleMafia.role !== "mafia_single") {
      singleMafia.role = "mafia_single";
    }
  }
}

// Translate system roles to Arabic names
function getRoleNameInArabic(role: string): string {
  switch (role) {
    case "mafia_single":
    case "mafia_killer":
    case "mafia_muter":
      return "مافيا";
    case "doctor":
      return "الدكتور";
    case "sniper":
      return "القناص";
    case "sheikh":
      return "الشيخ";
    case "joker":
      return "الجوكر";
    case "citizen":
      return "مواطن";
    default:
      return "مواطن";
  }
}

// Transition to Day Phase
function enterDayPhase(room: Room) {
  room.status = "day";
  room.votes = {}; // Reset votes
  room.voteOutcomeText = "";

  broadcastSound(room, "day_start");

  // Trigger bot chat reactions for the new day
  triggerBotDayStartResponses(room);

  // Day countdown as chosen by host
  startPhaseTimer(room, room.dayDuration, () => {
    enterVotingPhase(room);
  });
}

// Transition to Voting Phase
function enterVotingPhase(room: Room) {
  room.status = "voting";
  room.votes = {};

  addSystemMessage(room, "⚖️ انتهى النقاش! تبدأ الآن مرحلة التصويت لاختيار الشخص المشتبه به. لديكم 20 ثانية.");
  broadcastSound(room, "day_start"); // Or a transition cue

  // Trigger bot voting behavior
  triggerBotVoting(room);

  // Voting duration is strictly 20 seconds
  startPhaseTimer(room, 20, () => {
    resolveVotingPhase(room);
  });
}

// Resolve day voting and eliminate player
function resolveVotingPhase(room: Room) {
  broadcastSound(room, "timer_end");

  const alivePlayers = room.players.filter((p) => p.isAlive);
  
  // Calculate votes count with Sheikh weight (3 votes if revealed)
  const voteTally: Record<string, number> = {};
  alivePlayers.forEach((p) => { voteTally[p.id] = 0; });

  Object.entries(room.votes).forEach(([voterId, votedId]) => {
    const voter = room.players.find(p => p.id === voterId);
    if (voter && voter.isAlive && !voter.isMuted) {
      const voteWeight = (voter.role === "sheikh" && voter.revealedSheikh) ? 3 : 1;
      if (voteTally[votedId] !== undefined) {
        voteTally[votedId] += voteWeight;
      }
    }
  });

  // Find unique maximum
  let maxVotes = 0;
  let candidatesWithMax: string[] = [];

  Object.entries(voteTally).forEach(([id, votes]) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      candidatesWithMax = [id];
    } else if (votes === maxVotes && votes > 0) {
      candidatesWithMax.push(id);
    }
  });

  let eliminatedPlayer: Player | null = null;

  if (maxVotes > 0 && candidatesWithMax.length === 1) {
    const pId = candidatesWithMax[0];
    const target = room.players.find(p => p.id === pId);
    if (target) {
      target.isAlive = false;
      eliminatedPlayer = target;
    }
  }

  // Apply Joker trigger if trigger is 'first_vote_elimination' and Joker is alive
  const joker = room.players.find(p => p.isAlive && p.role === "joker");
  if (joker && eliminatedPlayer && !room.firstVoteEliminationOccurred && room.jokerChoice === "first_vote_elimination") {
    room.firstVoteEliminationOccurred = true;

    const roleToCopy = eliminatedPlayer.role;
    joker.role = roleToCopy;
    room.jokerCopiedRole = roleToCopy;

    addSystemMessage(room, `🃏 تحول الجوكر سراً إلى دور جديد!`, true);

    if (roleToCopy.startsWith("mafia_")) {
      addSystemMessage(room, `😈 انضم الجوكر إلى فريق المافيا باسم: ${joker.nickname}`, true);
    }
  }

  // Update Mafia roles if one of them was eliminated
  updateMafiaRolesIfNeeded(room);

  // Set Outcome and notify players
  if (eliminatedPlayer) {
    room.voteOutcomeText = `بأغلبية الأصوات (${maxVotes} صوت)، تقرر إقصاء اللاعب ${eliminatedPlayer.nickname}، ودوره الحقيقي هو: ${getRoleNameInArabic(eliminatedPlayer.role)}.`;
    addSystemMessage(room, `⚖️ طردت المدينة اللاعب ${eliminatedPlayer.nickname} ودوره كان: ${getRoleNameInArabic(eliminatedPlayer.role)}.`);
    addGameEvent(room, "🗳️", `تم إقصاء ${eliminatedPlayer.nickname} بالتصويت، وبطاقته الحقيقية هي: ${getRoleNameInArabic(eliminatedPlayer.role)}.`);
  } else {
    room.voteOutcomeText = "تعادل في التصويت، لم يتم إقصاء أحد.";
    addSystemMessage(room, "⚖️ تعادل في التصويت! لم يتفق أهالي المدينة على طرد أحد.");
    addGameEvent(room, "⚖️", "انتهى التصويت بالتعادل، ولم يتم إقصاء أي لاعب.");
  }

  // Check victory conditions
  const isGameOver = checkVictoryConditions(room);
  if (!isGameOver) {
    room.round++;
    enterNightPhase(room);
  } else {
    broadcastRoomState(room);
  }
}

// ==========================================
// 7. CLIENT ACTIONS HANDLER
// ==========================================

function handleClientMessage(ws: WebSocket, clientId: string, messageStr: string) {
  let parsed;
  try {
    parsed = JSON.parse(messageStr);
  } catch (err) {
    return;
  }

  const { type, data } = parsed;

  // Find if this client belongs to any room
  let clientRoom: Room | null = null;
  let clientPlayer: Player | null = null;

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
        ws.send(JSON.stringify({ type: "error", data: { message: "الاسم المستعار غير صالح" } }));
        return;
      }
      const parsedDuration = parseInt(dayDuration);
      if (isNaN(parsedDuration) || parsedDuration < 30) {
        ws.send(JSON.stringify({ type: "error", data: { message: "وقت النهار يجب أن لا يقل عن 30 ثانية" } }));
        return;
      }

      const roomCode = generateRoomCode();
      const newPlayer: Player = {
        id: clientId,
        nickname: nickname.trim(),
        avatarId: Math.floor(Math.random() * 8) + 1,
        isHost: true,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        socket: ws,
      };

      const newRoom: Room = {
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
        voteOutcomeText: "",
      };

      rooms[roomCode] = newRoom;
      addSystemMessage(newRoom, `👋 قام ${newPlayer.nickname} بإنشاء الغرفة والضم إليها.`);
      broadcastRoomState(newRoom);
      break;
    }

    case "join_room": {
      const { nickname, roomCode } = data;
      if (!nickname || typeof nickname !== "string" || nickname.trim() === "") {
        ws.send(JSON.stringify({ type: "error", data: { message: "الاسم المستعار غير صالح" } }));
        return;
      }
      if (!roomCode || typeof roomCode !== "string") {
        ws.send(JSON.stringify({ type: "error", data: { message: "كود الغرفة غير صالح" } }));
        return;
      }

      const targetRoomCode = roomCode.toUpperCase().trim();
      const room = rooms[targetRoomCode];

      if (!room) {
        ws.send(JSON.stringify({ type: "error", data: { message: "الغرفة غير موجودة، يرجى التحقق من الكود" } }));
        return;
      }

      if (room.status !== "lobby") {
        ws.send(JSON.stringify({ type: "error", data: { message: "اللعبة بدأت بالفعل في هذه الغرفة" } }));
        return;
      }

      if (room.players.length >= 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "الغرفة ممتلئة بالكامل (الحد الأقصى 18 لاعب)" } }));
        return;
      }

      // Check duplicate nickname
      const nameExists = room.players.some((p) => p.nickname.toLowerCase() === nickname.trim().toLowerCase());
      if (nameExists) {
        ws.send(JSON.stringify({ type: "error", data: { message: "هذا الاسم مستخدم بالفعل في الغرفة" } }));
        return;
      }

      const newPlayer: Player = {
        id: clientId,
        nickname: nickname.trim(),
        avatarId: Math.floor(Math.random() * 8) + 1,
        isHost: false,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        socket: ws,
      };

      room.players.push(newPlayer);
      addSystemMessage(room, `👋 انضم ${newPlayer.nickname} إلى الغرفة.`);
      broadcastRoomState(room);
      break;
    }

    case "add_bot": {
      if (!clientRoom || !clientPlayer) return;
      if (!clientPlayer.isHost) {
        ws.send(JSON.stringify({ type: "error", data: { message: "فقط صاحب الغرفة يمكنه إضافة بوتات" } }));
        return;
      }
      if (clientRoom.status !== "lobby") {
        ws.send(JSON.stringify({ type: "error", data: { message: "لا يمكن إضافة بوتات بعد بدء اللعبة" } }));
        return;
      }

      // Max 7 bots check
      const botCount = clientRoom.players.filter(p => p.isBot).length;
      if (botCount >= 7) {
        ws.send(JSON.stringify({ type: "error", data: { message: "تم الوصول للحد الأقصى للبوتات وهو 7 بوتات!" } }));
        return;
      }

      // Total player limit check
      if (clientRoom.players.length >= 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "تم الوصول للحد الأقصى لعدد اللاعبين وهو 18 لاعبًا!" } }));
        return;
      }

      // Filter unused bot names
      const existingNames = new Set(clientRoom.players.map(p => p.nickname.toLowerCase()));
      const availableNames = BOT_NAMES.filter(name => !existingNames.has(name.toLowerCase()));
      const botName = availableNames.length > 0 
        ? availableNames[Math.floor(Math.random() * availableNames.length)] 
        : `بوت ${botCount + 1}`;

      const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
      const newBot: Player = {
        id: botId,
        nickname: botName,
        avatarId: Math.floor(Math.random() * 12) + 1, // 1 to 12 avatar IDs
        isHost: false,
        isAlive: true,
        isOffline: false,
        role: "",
        isMuted: false,
        revealedSheikh: false,
        isBot: true,
      };

      clientRoom.players.push(newBot);
      addSystemMessage(clientRoom, `🤖 انضم البوت ${newBot.nickname} إلى الغرفة.`);
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
        ws.send(JSON.stringify({ type: "error", data: { message: "صاحب الغرفة فقط يستطيع بدء اللعبة" } }));
        return;
      }
      if (clientRoom.players.length < 7 || clientRoom.players.length > 18) {
        ws.send(JSON.stringify({ type: "error", data: { message: "يجب أن يكون عدد اللاعبين بين 7 و 18 لاعب لبدء اللعبة" } }));
        return;
      }

      distributeRoles(clientRoom);
      clientRoom.status = "showing_roles";
      
      // Start an 8 seconds timer to let players view their roles
      startPhaseTimer(clientRoom, 8, () => {
        enterNightPhase(clientRoom!);
      });
      break;
    }

    case "joker_choice": {
      if (!clientRoom || !clientPlayer) return;
      if (clientPlayer.role !== "joker") return;
      if (clientRoom.status !== "showing_roles") return; // Must choose during showing roles card phase

      const { choice } = data;
      if (choice === "first_night_death" || choice === "first_vote_elimination") {
        clientRoom.jokerChoice = choice;
        ws.send(JSON.stringify({
          type: "notification",
          data: { message: `تم تأكيد خيار النسخ: ${choice === 'first_night_death' ? 'أول ميت بالليل' : 'أول مطرود بالتصويت'}`, type: "success" }
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

      // Validate targets are active alive players
      const targetPlayer = clientRoom.players.find(p => p.id === targetId && p.isAlive);
      if (targetId && !targetPlayer) {
        ws.send(JSON.stringify({ type: "error", data: { message: "اللاعب المحدد غير موجود أو ميت" } }));
        return;
      }

      // Check actions allowed for each role
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
            ws.send(JSON.stringify({ type: "error", data: { message: "لا يمكنك حماية نفس الشخص ليلتين متتاليتين!" } }));
            return;
          }
          clientRoom.doctorTarget = targetId || null;
        }
      } else if (clientPlayer.role === "sniper") {
        if (actionType === "shoot") {
          if (clientRoom.sniperHasShot) {
            ws.send(JSON.stringify({ type: "error", data: { message: "لقد استهلكت طلقتك الوحيدة بالفعل!" } }));
            return;
          }
          clientRoom.sniperTarget = targetId || null;
        }
      }

      // Play selection sound cue
      ws.send(JSON.stringify({ type: "sound", data: { sound: "vote_submit" } }));
      broadcastRoomState(clientRoom);
      break;
    }

    case "sheikh_reveal": {
      if (!clientRoom || !clientPlayer) return;
      if (clientRoom.status !== "day" && clientRoom.status !== "voting") return;
      if (!clientPlayer.isAlive) return;
      if (clientPlayer.role !== "sheikh") return;
      if (clientPlayer.revealedSheikh) return; // Already revealed

      clientPlayer.revealedSheikh = true;
      
      // Sheikh gets revealed immediately.
      addSystemMessage(clientRoom, `👳 كشف الشيخ ${clientPlayer.nickname} عن هويته الحقيقية! صوته الآن يحتسب بـ 3 أصوات.`);
      addGameEvent(clientRoom, "👳", "كشف الشيخ عن هويته، وأصبح صوته يعادل ثلاثة أصوات.");
      broadcastNotification(clientRoom, `👳 كشف الشيخ ${clientPlayer.nickname} عن هويته الحقيقية!`, "success");
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

      // Closed chat checks
      if (clientRoom.status === "night") {
        ws.send(JSON.stringify({ type: "error", data: { message: "لا يمكن التحدث في الشات خلال مرحلة الليل!" } }));
        return;
      }

      if (isMuted && !isDead) {
        ws.send(JSON.stringify({ type: "error", data: { message: "أنت مسكّت ولا تستطيع إرسال الرسائل!" } }));
        return;
      }

      const newMessage: Message = {
        id: generateId(),
        senderId: clientPlayer.id,
        senderName: clientPlayer.nickname,
        text: text.trim(),
        time: getFormattedTime(),
        isSystem: false,
        isDeadChat: isDead,
      };

      clientRoom.messages.push(newMessage);
      broadcastRoomState(clientRoom);

      // Trigger a potential bot response after a human sends a message
      if (clientRoom.status === "day" && !clientPlayer.isBot) {
        const aliveBots = clientRoom.players.filter(p => p.isAlive && p.isBot);
        if (aliveBots.length > 0 && Math.random() < 0.35) {
          // Choose 1 random bot to respond
          const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
          const delay = (2 + Math.random() * 5) * 1000; // 2 to 7 seconds delay
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
        ws.send(JSON.stringify({ type: "error", data: { message: "أنت مسكّت اليوم ولا يمكنك التصويت!" } }));
        return;
      }

      const { targetId } = data;
      const targetPlayer = clientRoom.players.find(p => p.id === targetId && p.isAlive);
      if (!targetPlayer) {
        ws.send(JSON.stringify({ type: "error", data: { message: "اللاعب المحدد للتصويت غير متوفر أو ميت" } }));
        return;
      }

      // Lock vote (Once submitted, cannot be changed)
      if (clientRoom.votes[clientPlayer.id]) {
        ws.send(JSON.stringify({ type: "error", data: { message: "لقد قمت بالتصويت بالفعل، لا يمكن تغييره!" } }));
        return;
      }

      clientRoom.votes[clientPlayer.id] = targetId;
      addSystemMessage(clientRoom, `🗳️ صوت ${clientPlayer.nickname} لصالح ${targetPlayer.nickname}.`);
      broadcastSound(clientRoom, "vote_submit");
      broadcastRoomState(clientRoom);

      // Optimistic check: if all active eligible voters voted, resolve voting early
      const totalEligibleVoters = clientRoom.players.filter(p => p.isAlive && !p.isMuted).length;
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
        ws.send(JSON.stringify({ type: "error", data: { message: "صاحب الغرفة فقط يستطيع إعادة اللعبة" } }));
        return;
      }

      // Reset room back to lobby status
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

      addSystemMessage(clientRoom, `🏁 تم إعادة اللعبة إلى اللوبي بواسطة صاحب الغرفة. يمكن للاعبين الاستعداد.`);
      broadcastRoomState(clientRoom);
      break;
    }

    case "heartbeat": {
      // Keep alive response
      ws.send(JSON.stringify({ type: "heartbeat_ack" }));
      break;
    }
  }
}

// ==========================================
// 8. DISCONNECTION & ROOM CLEANUP LOGIC
// ==========================================

function removePlayerFromRoom(room: Room, playerId: string) {
  const playerIndex = room.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) return;

  const player = room.players[playerIndex];

  // Completely remove player from the array
  room.players.splice(playerIndex, 1);

  addSystemMessage(room, `🚪 غادر ${player.nickname} الغرفة.`);

  // If host left, assign ownership to the next player (whether human or bot)
  if (player.isHost && room.players.length > 0) {
    room.players[0].isHost = true;
    addSystemMessage(room, `👑 انتقلت ملكية الغرفة تلقائياً إلى ${room.players[0].nickname}.`);
  }

  // If game is in progress and player was alive, check victory conditions
  if (room.status !== "lobby" && room.status !== "game_over" && player.isAlive) {
    checkVictoryConditions(room);
  }

  // If no human players are left, delete the room
  const humanPlayers = room.players.filter((p) => !p.isBot);
  if (humanPlayers.length === 0) {
    stopTimer(room);
    delete rooms[room.code];
  } else {
    broadcastRoomState(room);
  }
}

function handlePlayerDisconnect(clientId: string) {
  let matchedRoom: Room | null = null;
  let matchedPlayer: Player | null = null;

  for (const r of Object.values(rooms)) {
    const p = r.players.find((player) => player.id === clientId);
    if (p) {
      matchedRoom = r;
      matchedPlayer = p;
      break;
    }
  }

  if (!matchedRoom || !matchedPlayer) return;

  // Erase player completely as requested
  removePlayerFromRoom(matchedRoom, clientId);
}

// ==========================================
// 9. EXPRESS HTTP + WEBSOCKET INTEGRATION
// ==========================================

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // Attach WebSocket server sharing port 3000
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    // Assign a unique client ID
    const clientId = generateId();

    ws.on("message", (messageStr) => {
      handleClientMessage(ws, clientId, messageStr.toString());
    });

    ws.on("close", () => {
      handlePlayerDisconnect(clientId);
    });

    // Send connection ACK
    ws.send(JSON.stringify({ type: "connection_ack", data: { clientId } }));
  });

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRoomsCount: Object.keys(rooms).length });
  });

  // Integrate Vite for dev, or serve static assets in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
