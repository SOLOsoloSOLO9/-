import { Player, Message, GameEvent, Room } from "../types";

export interface PlayerPrivate {
  role: string;
  mafiaTeammates?: string[];
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function getFormattedTime(): string {
  const now = new Date();
  return now.toTimeString().split(" ")[0].substring(0, 5);
}

export function getRoleNameInArabic(role: string): string {
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

export function addSystemMessage(messages: Message[], text: string, isDeadChat = false): Message[] {
  const newMessage: Message = {
    id: generateId(),
    senderId: null,
    senderName: "النظام",
    text,
    time: getFormattedTime(),
    isSystem: true,
    isDeadChat,
  };
  return [...messages, newMessage];
}

export function addGameEvent(events: GameEvent[], icon: string, text: string, round: number): GameEvent[] {
  const newEvent: GameEvent = {
    id: generateId(),
    icon,
    text,
    time: getFormattedTime(),
    round,
  };
  return [...(events || []), newEvent];
}

export function checkVictoryConditions(room: Room): "citizens" | "mafia" | null {
  const alivePlayers = room.players.filter((p) => p.isAlive);
  
  // Count how many are mafia
  const mafiaAlive = alivePlayers.filter(
    (p) => p.role.startsWith("mafia_")
  ).length;

  const citizensAlive = alivePlayers.length - mafiaAlive;

  // 1. If no mafia are alive, Citizens win!
  if (mafiaAlive === 0) {
    return "citizens";
  }

  // 2. If mafia number is equal to or greater than citizens, Mafia wins!
  if (mafiaAlive >= citizensAlive) {
    return "mafia";
  }

  return null;
}

export function distributeRoles(players: Player[]): {
  updatedPlayers: Player[];
  privateRoles: Record<string, PlayerPrivate>;
} {
  const numPlayers = players.length;

  // Mafia counts: 1 if 7 players, 2 otherwise
  const mafiaCount = numPlayers === 7 ? 1 : 2;

  const specialRoles = ["doctor", "sniper", "sheikh", "joker"];
  const mafiaRoles: string[] = [];

  if (mafiaCount === 1) {
    mafiaRoles.push("mafia_single");
  } else {
    mafiaRoles.push("mafia_killer", "mafia_muter");
  }

  const citizenCount = numPlayers - mafiaCount - specialRoles.length;
  const citizens = Array(Math.max(0, citizenCount)).fill("citizen");

  const rolesPool = [...mafiaRoles, ...specialRoles, ...citizens];

  // Fisher-Yates shuffle
  for (let i = rolesPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
  }

  const updatedPlayers = players.map((player, index) => {
    return {
      ...player,
      role: "", // Clear public role for the game starting
      isAlive: true,
      isMuted: false,
      revealedSheikh: false,
    };
  });

  // Assign roles in private records
  const privateRoles: Record<string, PlayerPrivate> = {};
  const mafiaIds = updatedPlayers.filter((_, i) => rolesPool[i].startsWith("mafia_")).map((p, i) => p.id);

  updatedPlayers.forEach((player, index) => {
    const role = rolesPool[index];
    const isMafia = role.startsWith("mafia_");
    
    privateRoles[player.id] = {
      role,
      mafiaTeammates: isMafia ? mafiaIds : [],
    };
  });

  return { updatedPlayers, privateRoles };
}

export function updateMafiaRolesIfNeeded(players: Player[], privateRoles: Record<string, PlayerPrivate>): Record<string, PlayerPrivate> {
  const updatedPrivate = { ...privateRoles };
  const livingMafia = players.filter(
    (p) => p.isAlive && (updatedPrivate[p.id]?.role.startsWith("mafia_"))
  );

  if (livingMafia.length === 1) {
    const singleMafiaId = livingMafia[0].id;
    if (updatedPrivate[singleMafiaId].role !== "mafia_single") {
      updatedPrivate[singleMafiaId] = {
        ...updatedPrivate[singleMafiaId],
        role: "mafia_single",
      };
    }
  }

  return updatedPrivate;
}

export function resolveNightPhase(
  room: Room,
  privateRoles: Record<string, PlayerPrivate>
): {
  updatedRoom: Room;
  updatedPrivateRoles: Record<string, PlayerPrivate>;
} {
  let messages = [...room.messages];
  let events = [...(room.eventsLog || [])];
  let players = [...room.players];
  let updatedPrivate = { ...privateRoles };

  // Clear player mute statuses from previous day
  players = players.map((p) => ({ ...p, isMuted: false }));

  let killedPlayerId: string | null = null;

  // 1. Resolve Mute
  const activeMuter = players.find(
    (p) => p.isAlive && (updatedPrivate[p.id]?.role === "mafia_muter" || updatedPrivate[p.id]?.role === "mafia_single")
  );
  if (activeMuter && room.muteTarget) {
    const target = players.find((p) => p.id === room.muteTarget && p.isAlive);
    if (target) {
      target.isMuted = true;
      messages = addSystemMessage(messages, `🤐 تم تسكيت لاعب هذه الليلة وسيعاني في النهار المقبل.`, true);
      events = addGameEvent(events, "🤐", "قامت المافيا بإسكان أحد اللاعبين لهذه الجولة.", room.round);
    }
  }

  // 2. Resolve Mafia Kill
  const activeKiller = players.find(
    (p) => p.isAlive && (updatedPrivate[p.id]?.role === "mafia_killer" || updatedPrivate[p.id]?.role === "mafia_single")
  );
  let mafiaTargetId: string | null = null;
  if (activeKiller && room.mafiaTarget) {
    const target = players.find((p) => p.id === room.mafiaTarget && p.isAlive);
    if (target) {
      mafiaTargetId = target.id;
    }
  }

  // 3. Resolve Doctor Protection
  const activeDoctor = players.find((p) => p.isAlive && updatedPrivate[p.id]?.role === "doctor");
  let isProtected = false;
  if (activeDoctor && room.doctorTarget) {
    if (room.doctorTarget === mafiaTargetId) {
      isProtected = true;
      events = addGameEvent(events, "🩺", "نجح الطبيب في إنقاذ أحد اللاعبين هذه الليلة.", room.round);
    }
  }

  // If mafia killed someone and doctor did not protect them
  if (mafiaTargetId && !isProtected) {
    killedPlayerId = mafiaTargetId;
    events = addGameEvent(events, "🔪", "قامت المافيا بإقصاء أحد اللاعبين هذه الليلة.", room.round);
  }

  // 4. Resolve Sniper shot
  const activeSniper = players.find((p) => p.isAlive && updatedPrivate[p.id]?.role === "sniper");
  if (activeSniper && room.sniperTarget && !room.sniperHasShot) {
    const sniperTarget = players.find((p) => p.id === room.sniperTarget && p.isAlive);
    if (sniperTarget) {
      killedPlayerId = sniperTarget.id; // Sniper is lethal and overrides doctor
      events = addGameEvent(events, "🎯", "قام القناص بإطلاق طلقته هذه الليلة.", room.round);
    }
  }

  // Apply death
  let deadPlayer: Player | null = null;
  if (killedPlayerId) {
    players = players.map((p) => {
      if (p.id === killedPlayerId) {
        deadPlayer = { ...p, isAlive: false, role: updatedPrivate[p.id]?.role || "citizen" };
        return deadPlayer;
      }
      return p;
    });
  }

  // 5. Apply Joker trigger if Joker is alive and trigger is 'first_night_death'
  const joker = players.find((p) => p.isAlive && updatedPrivate[p.id]?.role === "joker");
  if (joker && deadPlayer && !room.firstNightDeathOccurred && room.jokerChoice === "first_night_death") {
    const roleToCopy = (deadPlayer as Player).role;
    
    // Update private role of Joker
    updatedPrivate[joker.id] = {
      ...updatedPrivate[joker.id],
      role: roleToCopy,
    };

    messages = addSystemMessage(messages, `🃏 تحول الجوكر سراً إلى دور جديد!`, true);

    if (roleToCopy.startsWith("mafia_")) {
      messages = addSystemMessage(messages, `😈 انضم الجوكر إلى فريق المافيا باسم: ${joker.nickname}`, true);
    }
  }

  // Update Mafia roles if one of them died
  updatedPrivate = updateMafiaRolesIfNeeded(players, updatedPrivate);

  // Setup outcome text
  let outcomeText = "";
  if (deadPlayer) {
    const actualRole = updatedPrivate[(deadPlayer as Player).id]?.role || "citizen";
    outcomeText = `تم العثور على جثة اللاعب ${(deadPlayer as Player).nickname} مقتولاً الليلة، ودوره الحقيقي هو: ${getRoleNameInArabic(actualRole)}.`;
    messages = addSystemMessage(messages, `💀 عثر الأهالي على جثة ${(deadPlayer as Player).nickname} في الصباح ودوره كان: ${getRoleNameInArabic(actualRole)}.`);
    events = addGameEvent(events, "💀", `تم كشف مقتل اللاعب ${(deadPlayer as Player).nickname} الليلة، ودوره الحقيقي هو: ${getRoleNameInArabic(actualRole)}.`, room.round);
  } else {
    outcomeText = "لم يمت أحد هذه الليلة.";
    messages = addSystemMessage(messages, "☀️ استيقظت المدينة ولم يمت أحد هذه الليلة. الحمد لله!");
    events = addGameEvent(events, "☀️", "استيقظت المدينة ولم يمت أحد هذه الليلة.", room.round);
  }

  const nextStatus = "day";

  const updatedRoom: Room = {
    ...room,
    players,
    messages,
    eventsLog: events,
    nightOutcomeText: outcomeText,
    status: nextStatus as any,
    votes: {},
    mafiaTarget: null,
    muteTarget: null,
    doctorTarget: null,
    sniperTarget: null,
    sniperHasShot: room.sniperTarget ? true : room.sniperHasShot,
  };

  return { updatedRoom, updatedPrivateRoles: updatedPrivate };
}

export function resolveVotingPhase(
  room: Room,
  privateRoles: Record<string, PlayerPrivate>
): {
  updatedRoom: Room;
  updatedPrivateRoles: Record<string, PlayerPrivate>;
} {
  let messages = [...room.messages];
  let events = [...(room.eventsLog || [])];
  let players = [...room.players];
  let updatedPrivate = { ...privateRoles };

  const alivePlayers = players.filter((p) => p.isAlive);
  const voteTally: Record<string, number> = {};
  alivePlayers.forEach((p) => {
    voteTally[p.id] = 0;
  });

  Object.entries(room.votes).forEach(([voterId, votedId]) => {
    const voter = players.find((p) => p.id === voterId);
    if (voter && voter.isAlive && !voter.isMuted) {
      const isSheikh = updatedPrivate[voterId]?.role === "sheikh";
      const voteWeight = isSheikh && voter.revealedSheikh ? 3 : 1;
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
    players = players.map((p) => {
      if (p.id === pId) {
        eliminatedPlayer = { ...p, isAlive: false, role: updatedPrivate[p.id]?.role || "citizen" };
        return eliminatedPlayer;
      }
      return p;
    });
  }

  // Apply Joker trigger if trigger is 'first_vote_elimination' and Joker is alive
  const joker = players.find((p) => p.isAlive && updatedPrivate[p.id]?.role === "joker");
  if (joker && eliminatedPlayer && !room.firstVoteEliminationOccurred && room.jokerChoice === "first_vote_elimination") {
    const roleToCopy = (eliminatedPlayer as Player).role;

    updatedPrivate[joker.id] = {
      ...updatedPrivate[joker.id],
      role: roleToCopy,
    };

    messages = addSystemMessage(messages, `🃏 تحول الجوكر سراً إلى دور جديد!`, true);

    if (roleToCopy.startsWith("mafia_")) {
      messages = addSystemMessage(messages, `😈 انضم الجوكر إلى فريق المافيا باسم: ${joker.nickname}`, true);
    }
  }

  // Update Mafia roles if one of them died
  updatedPrivate = updateMafiaRolesIfNeeded(players, updatedPrivate);

  let outcomeText = "";
  if (eliminatedPlayer) {
    const actualRole = updatedPrivate[(eliminatedPlayer as Player).id]?.role || "citizen";
    outcomeText = `بأغلبية الأصوات (${maxVotes} صوت)، تقرر إقصاء اللاعب ${(eliminatedPlayer as Player).nickname}، ودوره الحقيقي هو: ${getRoleNameInArabic(actualRole)}.`;
    messages = addSystemMessage(messages, `⚖️ طردت المدينة اللاعب ${(eliminatedPlayer as Player).nickname} ودوره كان: ${getRoleNameInArabic(actualRole)}.`);
    events = addGameEvent(events, "🗳️", `تم إقصاء ${(eliminatedPlayer as Player).nickname} بالتصويت، وبطاقته الحقيقية هي: ${getRoleNameInArabic(actualRole)}.`, room.round);
  } else {
    outcomeText = "تعادل في التصويت، لم يتم إقصاء أحد.";
    messages = addSystemMessage(messages, "⚖️ تعادل في التصويت! لم يتفق أهالي المدينة على طرد أحد.");
    events = addGameEvent(events, "⚖️", "انتهى التصويت بالتعادل، ولم يتم إقصاء أي لاعب.", room.round);
  }

  const updatedRoom: Room = {
    ...room,
    players,
    messages,
    eventsLog: events,
    voteOutcomeText: outcomeText,
    votes: {},
  };

  return { updatedRoom, updatedPrivateRoles: updatedPrivate };
}

export function triggerBotNightActions(
  room: Room,
  privateRoles: Record<string, PlayerPrivate>
): Partial<Room> {
  const aliveBots = room.players.filter((p) => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return {};

  let mafiaTarget = room.mafiaTarget;
  let muteTarget = room.muteTarget;
  let doctorTarget = room.doctorTarget;
  let sniperTarget = room.sniperTarget;

  aliveBots.forEach((bot) => {
    const botRole = privateRoles[bot.id]?.role;
    const alivePlayers = room.players.filter((p) => p.isAlive);
    const otherPlayers = alivePlayers.filter((p) => p.id !== bot.id);

    if (otherPlayers.length === 0) return;

    if (botRole === "mafia_killer" || botRole === "mafia_single") {
      const citizens = otherPlayers.filter(
        (p) => !privateRoles[p.id]?.role.startsWith("mafia_")
      );
      if (citizens.length > 0) {
        mafiaTarget = citizens[Math.floor(Math.random() * citizens.length)].id;
      }
    } else if (botRole === "mafia_muter") {
      const citizens = otherPlayers.filter(
        (p) => !privateRoles[p.id]?.role.startsWith("mafia_")
      );
      if (citizens.length > 0) {
        muteTarget = citizens[Math.floor(Math.random() * citizens.length)].id;
      }
    } else if (botRole === "doctor") {
      const possibleTargets = alivePlayers; // Doctor can protect themselves too!
      if (possibleTargets.length > 0) {
        doctorTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)].id;
      }
    } else if (botRole === "sniper" && !room.sniperHasShot) {
      // Sniper acts with low probability, or shoots a random other player
      if (Math.random() < 0.2) {
        sniperTarget = otherPlayers[Math.floor(Math.random() * otherPlayers.length)].id;
      }
    }
  });

  return {
    mafiaTarget,
    muteTarget,
    doctorTarget,
    sniperTarget,
  };
}

export function triggerBotVoting(
  room: Room,
  privateRoles: Record<string, PlayerPrivate>
): Record<string, string> {
  const aliveBots = room.players.filter((p) => p.isAlive && p.isBot);
  const updatedVotes = { ...room.votes };

  aliveBots.forEach((bot) => {
    const alivePlayers = room.players.filter((p) => p.isAlive);
    const otherPlayers = alivePlayers.filter((p) => p.id !== bot.id);
    if (otherPlayers.length > 0) {
      const target = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
      updatedVotes[bot.id] = target.id;
    }
  });

  return updatedVotes;
}

export function getBotSpeechPrompt(
  bot: Player,
  botRole: string,
  room: Room,
  privateRoles: Record<string, PlayerPrivate>
): string {
  const playersInfo = room.players
    .map((p) => {
      let details = `${p.nickname} (ID: ${p.id}) - ${p.isAlive ? "حي" : "ميت"}`;
      if (p.isBot) details += " (بوت)";
      if (p.revealedSheikh) details += " (شيخ معلن)";
      return details;
    })
    .join("\n");

  const deadPlayersWithRoles = room.players
    .filter((p) => !p.isAlive)
    .map((p) => {
      return `${p.nickname} (دوره الحقيقي: ${getRoleNameInArabic(p.role || privateRoles[p.id]?.role)})`;
    })
    .join("، ") || "لا أحد";

  const recentChat = room.messages
    .slice(-15)
    .map((m) => {
      return `${m.senderName}: ${m.text}`;
    })
    .join("\n");

  const otherMafia = room.players
    .filter((p) => p.id !== bot.id && privateRoles[p.id]?.role.startsWith("mafia_") && p.isAlive)
    .map((p) => p.nickname)
    .join("، ") || "لا أحد";

  return `
أنت تلعب لعبة المافيا (Mafia/Werewolf) الاجتماعية باللغة العربية.
هويتك في هذه اللعبة:
- اسمك المستعار: ${bot.nickname}
- دورك السري: ${getRoleNameInArabic(botRole)} (${botRole})
- حالتك: حي

معلومات اللعبة الحالية:
- الجولة: ${room.round}
- المرحلة الحالية: ${room.status === "day" ? "النهار (نقاش)" : "التصويت"}
- اللاعبون المتواجدون وحالتهم:
${playersInfo}
- اللاعبون الذين ماتوا وأدوارهم: ${deadPlayersWithRoles}
${botRole.startsWith("mafia_") ? `- شركاؤك في المافيا الأحياء: ${otherMafia}` : ""}

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
}
