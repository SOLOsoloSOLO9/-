import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  User,
  Users,
  Crown,
  Copy,
  Check,
  X,
  Send,
  Volume2,
  VolumeX,
  Moon,
  Sun,
  Skull,
  Shield,
  Target,
  MessageSquare,
  LogOut,
  Lock,
  Flame,
  Eye,
  RefreshCw,
  AlertTriangle,
  Heart,
  ScrollText,
} from "lucide-react";
import { Room, Player, Message } from "./types";
import { audioSynth } from "./utils/audio";
import { motion, AnimatePresence } from "motion/react";
import { db, auth } from "./firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDoc,
  runTransaction,
  arrayUnion,
  collection,
  getDocs,
  writeBatch,
  deleteDoc
} from "firebase/firestore";
import {
  generateRoomCode,
  generateId,
  getFormattedTime,
  distributeRoles,
  resolveNightPhase,
  resolveVotingPhase,
  triggerBotNightActions,
  triggerBotVoting,
  getBotSpeechPrompt,
  checkVictoryConditions
} from "./utils/gameEngine";

// Predefined Avatars mapping with elegant gradient backgrounds & themed emojis
const AVATARS = [
  { id: 1, gradient: "from-rose-600 to-red-950", emoji: "🕶️", label: "مجهول" },
  { id: 2, gradient: "from-teal-500 to-cyan-900", emoji: "🩺", label: "حكيم" },
  { id: 3, gradient: "from-emerald-600 to-emerald-950", emoji: "🎯", label: "صياد" },
  { id: 4, gradient: "from-amber-500 to-yellow-950", emoji: "👳", label: "شيخ" },
  { id: 5, gradient: "from-purple-600 to-indigo-950", emoji: "🃏", label: "مهرج" },
  { id: 6, gradient: "from-zinc-500 to-stone-800", emoji: "👤", label: "مواطن" },
  { id: 7, gradient: "from-blue-600 to-blue-950", emoji: "🦊", label: "ذكي" },
  { id: 8, gradient: "from-pink-600 to-rose-950", emoji: "🎭", label: "ممثل" },
];

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

export default function App() {
  const [ws, setWs] = useState<any>(null); // Kept for compatibility if references exist
  const [clientId, setClientId] = useState<string>("");
  const [rawRoom, setRawRoom] = useState<Room | null>(null);
  const [roomCode, setRoomCode] = useState<string>("");
  const [myPrivateRole, setMyPrivateRole] = useState<string>("");
  const [mafiaTeammates, setMafiaTeammates] = useState<string[]>([]);
  const [playerId, setPlayerId] = useState<string>("");
  const [nickname, setNickname] = useState<string>(() => localStorage.getItem("mafia_nickname") || "");
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const [dayDuration, setDayDuration] = useState<number>(60);
  const [activeTab, setActiveTab] = useState<"general" | "dead">("general");
  const [chatMessage, setChatMessage] = useState<string>("");
  
  // UI screens / modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  
  // Notification toast state
  const [notifications, setNotifications] = useState<{ id: string; text: string; type: "info" | "success" | "danger" }[]>([]);
  
  // Audio state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Cinematic and animation states
  const [activeCinematic, setActiveCinematic] = useState<{ type: string; text?: string } | null>(null);
  const [showNightOverlay, setShowNightOverlay] = useState(false);
  const [animatedRound, setAnimatedRound] = useState(-1);
  const [prevStatus, setPrevStatus] = useState("");
  const [revealedSheikhs, setRevealedSheikhs] = useState<string[]>([]);
  const [deadPlayers, setDeadPlayers] = useState<string[]>([]);

  // Connection status state
  const [connStatus, setConnStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  // Chat scroll refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const eventsContainerRef = useRef<HTMLDivElement>(null);

  // Chat window state
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [lastReadCount, setLastReadCount] = useState(0);

  // Timer states
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Toast manager
  const addToast = (text: string, type: "info" | "success" | "danger" = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  };

  // Derived room state with injected private role & teammate flags
  const playersWithMyRole = useMemo(() => {
    if (!rawRoom) return [];
    return rawRoom.players.map(p => {
      let role = p.role;
      if (p.id === playerId && myPrivateRole) {
        role = myPrivateRole;
      }
      if (myPrivateRole?.startsWith("mafia_") && mafiaTeammates.includes(p.id)) {
        role = "mafia_team";
      }
      return {
        ...p,
        role
      };
    });
  }, [rawRoom?.players, playerId, myPrivateRole, mafiaTeammates]);

  const room = useMemo(() => {
    if (!rawRoom) return null;
    return {
      ...rawRoom,
      players: playersWithMyRole,
      timer: secondsLeft, // Sync UI countdown display with secondsLeft state
    };
  }, [rawRoom, playersWithMyRole, secondsLeft]);

  // Copy code utility
  const copyRoomCode = () => {
    if (room?.code) {
      navigator.clipboard.writeText(room.code).then(() => {
        addToast("تم نسخ كود الغرفة بنجاح!", "success");
        if (soundEnabled) audioSynth.playVoteSubmit();
      });
    }
  };

  const isHost = useMemo(() => {
    if (!room) return false;
    const me = room.players.find(p => p.id === playerId);
    return me?.isHost || false;
  }, [room, playerId]);

  // Anonymous Sign In & Session setup
  useEffect(() => {
    setConnStatus("connecting");
    signInAnonymously(auth)
      .then(() => {
        setConnStatus("connected");
      })
      .catch((err) => {
        console.error("Auth failed:", err);
        setConnStatus("disconnected");
        addToast("فشل في المصادقة مع خادم Firebase المجهول", "danger");
      });

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setPlayerId(user.uid);
        setClientId(user.uid);
        setConnStatus("connected");
      } else {
        setConnStatus("disconnected");
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Listen for Room state updates in Firestore
  useEffect(() => {
    if (!roomCode) {
      setRawRoom(null);
      return;
    }

    const roomRef = doc(db, "rooms", roomCode);
    const unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as Room;
        setRawRoom(data);
      } else {
        setRawRoom(null);
        setRoomCode("");
        addToast("تم إغلاق هذه الغرفة من قبل المضيف أو لم يتم العثور عليها", "danger");
      }
    }, (err) => {
      console.error("Room snapshot error:", err);
      addToast("خطأ في الاتصال بقاعدة البيانات اللحظية", "danger");
    });

    return () => unsubscribeRoom();
  }, [roomCode]);

  // Listen for Private Player Role updates in Firestore
  useEffect(() => {
    if (!roomCode || !playerId) {
      setMyPrivateRole("");
      setMafiaTeammates([]);
      return;
    }

    const privRef = doc(db, "rooms", roomCode, "playersPrivate", playerId);
    const unsubscribePriv = onSnapshot(privRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data) {
          setMyPrivateRole(data.role || "");
          setMafiaTeammates(data.mafiaTeammates || []);
        }
      } else {
        setMyPrivateRole("");
        setMafiaTeammates([]);
      }
    }, (err) => {
      // Ignored - role is not assigned yet in early lobby
    });

    return () => unsubscribePriv();
  }, [roomCode, playerId]);

  // Handle phase transitions and play sound effects
  useEffect(() => {
    if (!room) return;

    if (room.status !== prevStatus) {
      if (soundEnabled) {
        if (room.status === "night") audioSynth.playNightStart();
        else if (room.status === "day") audioSynth.playDayStart();
        else if (room.status === "voting") audioSynth.playDayStart();
        else if (room.status === "game_over") audioSynth.playVictory();
      }
      setPrevStatus(room.status);
    }
  }, [room?.status, soundEnabled, prevStatus]);

  // Self-healing host handover logic if there is no active host in the room
  useEffect(() => {
    if (!room || !roomCode || !playerId) return;

    const activePlayers = room.players.filter(p => !p.isOffline);
    const hasActiveHost = activePlayers.some(p => p.isHost);
    
    if (!hasActiveHost && activePlayers.length > 0 && activePlayers[0].id === playerId) {
      const roomRef = doc(db, "rooms", roomCode);
      const updatedPlayers = room.players.map(p => ({
        ...p,
        isHost: p.id === playerId ? true : p.isHost
      }));
      updateDoc(roomRef, {
        players: updatedPlayers,
        hostId: playerId
      }).then(() => {
        addToast("لقد أصبحت مضيف الغرفة الجديد لتولي إدارة اللعبة!", "success");
      });
    }
  }, [room?.players, roomCode, playerId]);

  // Timer countdown and host transition coordinator
  useEffect(() => {
    if (!room || !room.phaseEndsAt || room.status === "lobby" || room.status === "game_over") {
      setSecondsLeft(0);
      return;
    }

    const updateTimer = () => {
      const msLeft = room.phaseEndsAt - Date.now();
      const sec = Math.max(0, Math.ceil(msLeft / 1000));
      setSecondsLeft(sec);

      if (sec <= 0 && isHost) {
        handlePhaseTimeout();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);

    return () => clearInterval(interval);
  }, [room?.phaseEndsAt, room?.status, isHost]);

  // Trigger simulated bot night actions
  const triggerHostBotNightActions = async (currentRoom: Room, privateRoles: Record<string, any>) => {
    const bots = currentRoom.players.filter(p => p.isAlive && p.isBot);
    if (bots.length === 0) return;

    bots.forEach(bot => {
      const delay = 3000 + Math.random() * 7000;
      setTimeout(async () => {
        const docSnap = await getDoc(doc(db, "rooms", roomCode));
        if (!docSnap.exists()) return;
        const latestRoom = docSnap.data() as Room;
        if (latestRoom.status !== "night" || !latestRoom.players.find(p => p.id === bot.id)?.isAlive) return;

        const actionUpdates = triggerBotNightActions(latestRoom, privateRoles);
        if (Object.keys(actionUpdates).length > 0) {
          await updateDoc(doc(db, "rooms", roomCode), actionUpdates);
        }
      }, delay);
    });
  };

  // Trigger simulated bot voting actions
  const triggerHostBotVoting = async (currentRoom: Room, privateRoles: Record<string, any>) => {
    const bots = currentRoom.players.filter(p => p.isAlive && p.isBot);
    if (bots.length === 0) return;

    bots.forEach(bot => {
      const delay = 2000 + Math.random() * 8000;
      setTimeout(async () => {
        const docSnap = await getDoc(doc(db, "rooms", roomCode));
        if (!docSnap.exists()) return;
        const latestRoom = docSnap.data() as Room;
        if (latestRoom.status !== "voting" || !latestRoom.players.find(p => p.id === bot.id)?.isAlive) return;

        const votes = triggerBotVoting(latestRoom, privateRoles);
        await updateDoc(doc(db, "rooms", roomCode), { votes });
      }, delay);
    });
  };

  // Trigger AI-generated bot day speech
  const triggerHostBotDaySpeech = async (currentRoom: Room, privateRoles: Record<string, any>) => {
    const aliveBots = currentRoom.players.filter(p => p.isAlive && p.isBot);
    if (aliveBots.length === 0) return;

    const botsToSpeak = aliveBots.sort(() => 0.5 - Math.random()).slice(0, Math.min(aliveBots.length, 2));

    botsToSpeak.forEach((bot, index) => {
      const delay = (2 + Math.random() * 5) * 1000 + (index * 4000);
      setTimeout(async () => {
        const docSnap = await getDoc(doc(db, "rooms", roomCode));
        if (!docSnap.exists()) return;
        const latestRoom = docSnap.data() as Room;
        if (latestRoom.status !== "day" || !latestRoom.players.find(p => p.id === bot.id)?.isAlive) return;

        const botRole = privateRoles[bot.id]?.role || "citizen";
        const prompt = getBotSpeechPrompt(bot, botRole, latestRoom, privateRoles);

        let text = "";
        const fallbacks = [
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

        try {
          const response = await fetch("/api/bot-speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt })
          });
          
          if (response.ok) {
            const parsed = await response.json();
            if (parsed && parsed.message) {
              text = parsed.message;
            }
          }
        } catch (err) {
          console.warn("Failed to generate bot response using Gemini proxy, using local fallback:", err);
        }

        if (!text) {
          text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        const newMessage: Message = {
          id: Math.random().toString(36).substring(2, 9),
          senderId: bot.id,
          senderName: bot.nickname,
          text: text.trim(),
          time: new Date().toTimeString().split(" ")[0].substring(0, 5),
          isSystem: false,
          isDeadChat: false,
        };

        await updateDoc(doc(db, "rooms", roomCode), {
          messages: arrayUnion(newMessage)
        });
      }, delay);
    });
  };

  // Host phase timeout executor
  const handlePhaseTimeout = async () => {
    if (!rawRoom || !roomCode) return;

    const roomRef = doc(db, "rooms", roomCode);
    const privDocs = await getDocs(collection(db, "rooms", roomCode, "playersPrivate"));
    const privateRoles: Record<string, any> = {};
    privDocs.forEach((doc) => {
      privateRoles[doc.id] = doc.data();
    });

    if (rawRoom.status === "showing_roles") {
      const nextEndsAt = Date.now() + 30 * 1000;
      const updatedPlayers = rawRoom.players.map(p => ({ ...p, isMuted: false }));
      
      await updateDoc(roomRef, {
        status: "night",
        votes: {},
        players: updatedPlayers,
        nightOutcomeText: "",
        voteOutcomeText: "",
        mafiaTarget: null,
        muteTarget: null,
        doctorTarget: null,
        sniperTarget: null,
        phaseEndsAt: nextEndsAt,
        messages: arrayUnion({
          id: Math.random().toString(36).substring(2, 9),
          senderId: null,
          senderName: "النظام",
          text: `🌙 حلّ الليل... الجولة ${rawRoom.round}. الجميع يغمض عينيه الآن.`,
          time: new Date().toTimeString().split(" ")[0].substring(0, 5),
          isSystem: true,
          isDeadChat: false,
        })
      });
      
      triggerHostBotNightActions(rawRoom, privateRoles);
    } 
    else if (rawRoom.status === "night") {
      const { updatedRoom, updatedPrivateRoles } = resolveNightPhase(rawRoom, privateRoles);
      const winner = checkVictoryConditions(updatedRoom);
      
      if (winner) {
        const playersWithRoles = updatedRoom.players.map(p => ({
          ...p,
          role: updatedPrivateRoles[p.id]?.role || "citizen"
        }));

        await updateDoc(roomRef, {
          ...updatedRoom,
          players: playersWithRoles,
          status: "game_over",
          winner,
          phaseEndsAt: 0,
          messages: arrayUnion({
            id: Math.random().toString(36).substring(2, 9),
            senderId: null,
            senderName: "النظام",
            text: `🎉 انتهت اللعبة! فاز فريق ${winner === "mafia" ? "المافيا" : "الأهالي"}!`,
            time: new Date().toTimeString().split(" ")[0].substring(0, 5),
            isSystem: true,
            isDeadChat: false,
          })
        });
      } else {
        const nextEndsAt = Date.now() + rawRoom.dayDuration * 1000;
        await updateDoc(roomRef, {
          ...updatedRoom,
          status: "day",
          phaseEndsAt: nextEndsAt,
        });

        triggerHostBotDaySpeech(updatedRoom, updatedPrivateRoles);
      }
    } 
    else if (rawRoom.status === "day") {
      const nextEndsAt = Date.now() + 20 * 1000;
      await updateDoc(roomRef, {
        status: "voting",
        votes: {},
        phaseEndsAt: nextEndsAt,
        messages: arrayUnion({
          id: Math.random().toString(36).substring(2, 9),
          senderId: null,
          senderName: "النظام",
          text: "⚖️ انتهى النقاش! تبدأ الآن مرحلة التصويت لاختيار الشخص المشتبه به. لديكم 20 ثانية.",
          time: new Date().toTimeString().split(" ")[0].substring(0, 5),
          isSystem: true,
          isDeadChat: false,
        })
      });

      triggerHostBotVoting(rawRoom, privateRoles);
    } 
    else if (rawRoom.status === "voting") {
      const { updatedRoom, updatedPrivateRoles } = resolveVotingPhase(rawRoom, privateRoles);
      const winner = checkVictoryConditions(updatedRoom);
      
      if (winner) {
        const playersWithRoles = updatedRoom.players.map(p => ({
          ...p,
          role: updatedPrivateRoles[p.id]?.role || "citizen"
        }));

        await updateDoc(roomRef, {
          ...updatedRoom,
          players: playersWithRoles,
          status: "game_over",
          winner,
          phaseEndsAt: 0,
          messages: arrayUnion({
            id: Math.random().toString(36).substring(2, 9),
            senderId: null,
            senderName: "النظام",
            text: `🎉 انتهت اللعبة! فاز فريق ${winner === "mafia" ? "المافيا" : "الأهالي"}!`,
            time: new Date().toTimeString().split(" ")[0].substring(0, 5),
            isSystem: true,
            isDeadChat: false,
          })
        });
      } else {
        const nextEndsAt = Date.now() + 30 * 1000;
        const nextRoomState = {
          ...updatedRoom,
          round: updatedRoom.round + 1,
          status: "night" as const,
          phaseEndsAt: nextEndsAt,
          votes: {},
          mafiaTarget: null,
          muteTarget: null,
          doctorTarget: null,
          sniperTarget: null,
        };

        await updateDoc(roomRef, {
          ...nextRoomState,
          messages: arrayUnion({
            id: Math.random().toString(36).substring(2, 9),
            senderId: null,
            senderName: "النظام",
            text: `🌙 حلّ الليل... الجولة ${nextRoomState.round}. الجميع يغمض عينيه الآن.`,
            time: new Date().toTimeString().split(" ")[0].substring(0, 5),
            isSystem: true,
            isDeadChat: false,
          })
        });

        triggerHostBotNightActions(nextRoomState, updatedPrivateRoles);
      }
    }
  };

  // Persist nickname
  useEffect(() => {
    if (nickname) {
      localStorage.setItem("mafia_nickname", nickname);
    }
  }, [nickname]);

  // Scroll chat to bottom on new message
  const lastMessagesLength = useRef(0);
  useEffect(() => {
    const currentLength = room?.messages?.length || 0;
    if (currentLength > lastMessagesLength.current) {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    }
    lastMessagesLength.current = currentLength;
  }, [room?.messages?.length]);

  // Scroll event log to bottom on new event
  const lastEventsLength = useRef(0);
  useEffect(() => {
    const currentLength = room?.eventsLog?.length || 0;
    if (currentLength > lastEventsLength.current) {
      if (eventsContainerRef.current) {
        eventsContainerRef.current.scrollTo({
          top: eventsContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    }
    lastEventsLength.current = currentLength;
  }, [room?.eventsLog?.length]);

  // Keep chat scrolled to bottom when opening or switching tabs
  useEffect(() => {
    if (isChatOpen && chatContainerRef.current) {
      const timer = setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isChatOpen, activeTab]);

  // Get messages visible to the user
  const visibleMessages = useMemo(() => {
    if (!room) return [];
    const myPlayer = room.players.find((p) => p.id === playerId);
    if (!myPlayer) return [];
    return room.messages.filter((msg) => {
      if (myPlayer.isAlive) {
        return !msg.isDeadChat;
      }
      return true; // Dead players can see all messages
    });
  }, [room?.messages, room?.players, playerId]);

  // Mark all as read when chat is open
  useEffect(() => {
    if (isChatOpen) {
      setLastReadCount(visibleMessages.length);
    }
  }, [isChatOpen, visibleMessages.length]);

  // Reset lastReadCount when joining a new room
  useEffect(() => {
    if (room?.code) {
      setLastReadCount(visibleMessages.length);
    }
  }, [room?.code]);

  const unreadCount = Math.max(0, visibleMessages.length - lastReadCount);

  // Auto transition to dead chat if dead (only when transitioning from alive to dead)
  const wasAliveRef = useRef<boolean>(true);
  useEffect(() => {
    const myPlayer = room?.players.find((p) => p.id === playerId);
    if (room && myPlayer) {
      if (wasAliveRef.current && !myPlayer.isAlive && activeTab !== "dead") {
        setActiveTab("dead");
        addToast("لقد تمت تصفيتك! تم نقلك تلقائياً إلى شات الأموات السري 👻", "danger");
      }
      wasAliveRef.current = myPlayer.isAlive;
    } else {
      wasAliveRef.current = true;
    }
  }, [room?.players, playerId, activeTab]);

  // Transition listeners for cinematic events and sounds
  useEffect(() => {
    if (!room) return;

    // 1. Check game start transition
    if (prevStatus === "lobby" && room.status === "showing_roles") {
      setActiveCinematic({ type: "game_start" });
      if (soundEnabled) audioSynth.playGameStart();
      setTimeout(() => {
        setActiveCinematic(null);
        if (me) {
          audioSynth.playRoleReveal(me.role);
        }
      }, 2500);
    }

    // 2. Check voting transition
    if (prevStatus !== "voting" && room.status === "voting") {
      setActiveCinematic({ type: "voting" });
      if (soundEnabled) audioSynth.playVotingTransition();
      setTimeout(() => {
        setActiveCinematic(null);
      }, 2000);
    }

    // 3. Check night transition
    if (prevStatus !== "night" && room.status === "night") {
      setShowNightOverlay(true);
      if (soundEnabled) audioSynth.playNightStart();
      setTimeout(() => {
        setShowNightOverlay(false);
      }, 3000);
    }

    // 4. Check day transition (resolving night outcomes)
    if (room.status === "day" && room.round !== animatedRound) {
      // Find events that belong to the current round
      const roundEvents = (room.eventsLog || []).filter(e => e.round === room.round);
      
      const queue: any[] = [];
      
      const hasKill = roundEvents.some(e => e.icon === "🔪");
      const hasSave = roundEvents.some(e => e.icon === "🩺");
      const hasShot = roundEvents.some(e => e.icon === "🎯");
      const hasMute = roundEvents.some(e => e.icon === "🤐");

      if (hasKill) queue.push({ type: "mafia_kill" });
      if (hasSave) queue.push({ type: "doctor_save" });
      if (hasShot) queue.push({ type: "sniper_shot" });
      if (hasMute) queue.push({ type: "mute" });

      if (queue.length > 0) {
        let currentIndex = 0;
        
        const runNext = () => {
          if (currentIndex < queue.length) {
            const anim = queue[currentIndex];
            setActiveCinematic(anim);
            
            if (soundEnabled) {
              if (anim.type === "mafia_kill") audioSynth.playMafiaKill();
              else if (anim.type === "doctor_save") audioSynth.playDoctorSave();
              else if (anim.type === "sniper_shot") audioSynth.playSniperShot();
              else if (anim.type === "mute") audioSynth.playMuteEffect();
            }
            
            currentIndex++;
            setTimeout(runNext, 2500);
          } else {
            setActiveCinematic(null);
            setAnimatedRound(room.round);
          }
        };
        
        runNext();
      } else {
        setAnimatedRound(room.round);
      }
    }

    // 5. Check game over transitions (victory screens)
    if (prevStatus !== "game_over" && room.status === "game_over") {
      const isMafiaWinText = room.winner === "mafia" || room.voteOutcomeText?.includes("المافيا") || room.nightOutcomeText?.includes("المافيا") || room.players.filter(p => p.isAlive).every(p => p.role.startsWith("mafia"));
      
      if (isMafiaWinText) {
        setActiveCinematic({ type: "victory_mafia" });
        if (soundEnabled) audioSynth.playMafiaVictory();
      } else {
        setActiveCinematic({ type: "victory_citizens" });
        if (soundEnabled) audioSynth.playVictory();
      }
      setTimeout(() => {
        setActiveCinematic(null);
      }, 5000);
    }

    // 6. Check tie transition
    const hasTie = (room.eventsLog || []).some(e => e.round === room.round && e.icon === "⚖️" && e.text.includes("تعادل"));
    if (hasTie && prevStatus === "voting" && room.status !== "voting" && room.round !== animatedRound) {
      setActiveCinematic({ type: "tie" });
      if (soundEnabled) audioSynth.playVotingTie();
      setTimeout(() => {
        setActiveCinematic(null);
      }, 2500);
    }

    setPrevStatus(room.status);

  }, [room?.status, room?.round, room?.eventsLog?.length]);

  // Track sheikh revelations
  useEffect(() => {
    if (!room) return;
    const currentRevealed = room.players.filter(p => p.revealedSheikh && p.isAlive).map(p => p.id);
    const newlyRevealed = currentRevealed.filter(id => !revealedSheikhs.includes(id));
    if (newlyRevealed.length > 0) {
      if (soundEnabled) audioSynth.playSheikhReveal();
      setRevealedSheikhs(currentRevealed);
      addToast("👳 كشف الشيخ عن هويته العادلة!", "success");
    } else if (currentRevealed.length !== revealedSheikhs.length) {
      setRevealedSheikhs(currentRevealed);
    }
  }, [room?.players]);

  // Track player deaths for role reveals on death
  useEffect(() => {
    if (!room) return;
    const currentDead = room.players.filter(p => !p.isAlive).map(p => p.id);
    const newlyDead = currentDead.filter(id => !deadPlayers.includes(id));
    if (newlyDead.length > 0) {
      const deadPlayer = room.players.find(p => p.id === newlyDead[0]);
      if (deadPlayer && soundEnabled) {
        audioSynth.playRoleReveal(deadPlayer.role);
      }
      setDeadPlayers(currentDead);
    } else if (currentDead.length !== deadPlayers.length) {
      setDeadPlayers(currentDead);
    }
  }, [room?.players]);

  // Click audio trigger
  const playClick = () => {
    if (soundEnabled) {
      audioSynth.playButtonClick();
    }
  };

  // Handlers for client messages
  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      addToast("يرجى إدخال اسمك المستعار أولاً", "danger");
      return;
    }
    if (dayDuration < 30) {
      addToast("أقل مدة للنهار هي 30 ثانية", "danger");
      return;
    }

    try {
      // Generate unique room code
      const code = generateRoomCode();
      const roomRef = doc(db, "rooms", code);

      const newRoom: Room = {
        code,
        status: "lobby",
        round: 0,
        dayDuration,
        timer: 0,
        winner: null,
        sniperHasShot: false,
        players: [
          {
            id: playerId,
            nickname: nickname.trim(),
            avatarId: 1,
            isHost: true,
            isAlive: true,
            isOffline: false,
            role: "",
            isMuted: false,
            revealedSheikh: false,
            isBot: false,
          },
        ],
        votes: {},
        messages: [
          {
            id: generateId(),
            senderId: null,
            senderName: "النظام",
            text: `🏠 تم إنشاء الغرفة بنجاح! كود الغرفة الخاص بك هو ${code}. أرسله لأصدقائك للانضمام!`,
            time: getFormattedTime(),
            isSystem: true,
            isDeadChat: false,
          },
        ],
        eventsLog: [
          {
            id: generateId(),
            icon: "🚪",
            text: `🚪 أنشأ ${nickname.trim()} الغرفة.`,
            time: getFormattedTime(),
            round: 0,
          },
        ],
        hostId: playerId,
        jokerChoice: null,
        mafiaTarget: null,
        muteTarget: null,
        doctorTarget: null,
        sniperTarget: null,
        phaseEndsAt: 0,
        nightOutcomeText: "",
        voteOutcomeText: "",
      };

      // Write public room state
      await setDoc(roomRef, newRoom);

      // Create private role document for player
      const privateRef = doc(db, "rooms", code, "playersPrivate", playerId);
      await setDoc(privateRef, { role: "", mafiaTeammates: [] });

      setRoomCode(code);
      setShowCreateModal(false);
      addToast("تم إنشاء الغرفة بنجاح!", "success");
    } catch (err) {
      console.error("Create room failed:", err);
      addToast("حدث خطأ أثناء إنشاء الغرفة", "danger");
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) {
      addToast("يرجى إدخال اسمك المستعار أولاً", "danger");
      return;
    }
    const targetCode = roomCodeInput.trim().toUpperCase();
    if (!targetCode) {
      addToast("يرجى إدخال كود الغرفة", "danger");
      return;
    }

    try {
      const roomRef = doc(db, "rooms", targetCode);

      await runTransaction(db, async (transaction) => {
        const roomDoc = await transaction.get(roomRef);
        if (!roomDoc.exists()) {
          throw new Error("not_found");
        }

        const roomData = roomDoc.data() as Room;
        if (roomData.status !== "lobby") {
          throw new Error("already_started");
        }

        if (roomData.players.length >= 18) {
          throw new Error("room_full");
        }

        const playerExists = roomData.players.some((p) => p.id === playerId);
        let updatedPlayers = [...roomData.players];

        if (!playerExists) {
          const newPlayer: Player = {
            id: playerId,
            nickname: nickname.trim(),
            avatarId: (roomData.players.length % 8) + 1,
            isHost: false,
            isAlive: true,
            isOffline: false,
            role: "",
            isMuted: false,
            revealedSheikh: false,
            isBot: false,
          };
          updatedPlayers.push(newPlayer);
        } else {
          // Reconnecting / joining again - mark as online
          updatedPlayers = updatedPlayers.map((p) =>
            p.id === playerId ? { ...p, isOffline: false, nickname: nickname.trim() } : p
          );
        }

        const newSystemMessage = {
          id: generateId(),
          senderId: null,
          senderName: "النظام",
          text: `👋 انضم اللاعب ${nickname.trim()} إلى الغرفة!`,
          time: getFormattedTime(),
          isSystem: true,
          isDeadChat: false,
        };

        const newEvent = {
          id: generateId(),
          icon: "👋",
          text: `👋 انضم اللاعب ${nickname.trim()} إلى الغرفة!`,
          time: getFormattedTime(),
          round: roomData.round || 0,
        };

        transaction.update(roomRef, {
          players: updatedPlayers,
          messages: [...roomData.messages, newSystemMessage],
          eventsLog: [...(roomData.eventsLog || []), newEvent],
        });
      });

      // Create private role document for player
      const privateRef = doc(db, "rooms", targetCode, "playersPrivate", playerId);
      await setDoc(privateRef, { role: "", mafiaTeammates: [] });

      setRoomCode(targetCode);
      setShowJoinModal(false);
      addToast("تم الانضمام للغرفة اللحظية بنجاح!", "success");
    } catch (err: any) {
      console.error("Join room failed:", err);
      if (err.message === "not_found") {
        addToast("كود الغرفة غير موجود أو خاطئ", "danger");
      } else if (err.message === "already_started") {
        addToast("لا يمكن الانضمام للغرفة حالياً، اللعبة بدأت بالفعل", "danger");
      } else if (err.message === "room_full") {
        addToast("الغرفة ممتلئة بالكامل بالحد الأقصى (18 لاعب)", "danger");
      } else {
        addToast("حدث خطأ أثناء الانضمام للغرفة", "danger");
      }
    }
  };

  const startGame = async () => {
    if (!room || !roomCode) return;
    if (room.players.length < 7) {
      addToast("تحتاج إلى 7 لاعبين على الأقل لبدء المباراة", "danger");
      return;
    }

    try {
      const roomRef = doc(db, "rooms", roomCode);

      // Distribute roles
      const { updatedPlayers, privateRoles } = distributeRoles(room.players);

      // Create batch to write private roles
      const batch = writeBatch(db);
      Object.entries(privateRoles).forEach(([pId, pPriv]) => {
        const privRef = doc(db, "rooms", roomCode, "playersPrivate", pId);
        batch.set(privRef, pPriv);
      });
      await batch.commit();

      const nextEndsAt = Date.now() + 10 * 1000; // 10 seconds to show roles

      await updateDoc(roomRef, {
        status: "showing_roles",
        round: 1,
        players: updatedPlayers,
        votes: {},
        phaseEndsAt: nextEndsAt,
        messages: arrayUnion({
          id: generateId(),
          senderId: null,
          senderName: "النظام",
          text: "🏁 بدأت اللعبة! جاري توزيع الأدوار والبطاقات سرياً... تحقق من بطاقتك الآن!",
          time: getFormattedTime(),
          isSystem: true,
          isDeadChat: false,
        }),
        eventsLog: arrayUnion({
          id: generateId(),
          icon: "🏁",
          text: "🏁 بدأت اللعبة وتم توزيع الأدوار سراً على الجميع.",
          time: getFormattedTime(),
          round: 1,
        }),
      });

      addToast("تم توزيع الأدوار وبدء المباراة اللحظية بنجاح!", "success");
    } catch (err) {
      console.error("Start game failed:", err);
      addToast("حدث خطأ أثناء توزيع الأدوار وبدء اللعبة", "danger");
    }
  };

  const selectJokerChoice = async (choice: "first_night_death" | "first_vote_elimination") => {
    if (!room || !roomCode) return;
    try {
      const roomRef = doc(db, "rooms", roomCode);
      await updateDoc(roomRef, {
        jokerChoice: choice,
      });
      addToast("تم تسجيل اختيار الجوكر بنجاح سراً", "success");
    } catch (err) {
      console.error("Joker choice failed:", err);
      addToast("فشل في تعيين خيار الجوكر", "danger");
    }
  };

  const submitNightAction = async (actionType: "kill" | "mute" | "protect" | "shoot", targetId: string | null) => {
    if (!room || !roomCode) return;
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const updates: any = {};
      if (actionType === "kill") updates.mafiaTarget = targetId;
      else if (actionType === "mute") updates.muteTarget = targetId;
      else if (actionType === "protect") updates.doctorTarget = targetId;
      else if (actionType === "shoot") updates.sniperTarget = targetId;

      await updateDoc(roomRef, updates);
      
      // Local visual confirmation sound
      if (soundEnabled) audioSynth.playVoteSubmit();
      addToast("تم تسجيل اختيارك الليلي بنجاح", "success");
    } catch (err) {
      console.error("Submit action failed:", err);
      addToast("فشل في تقديم الفعل الليلي", "danger");
    }
  };

  const submitVote = async (targetId: string) => {
    if (!room || !roomCode) return;
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const newVotes = { ...room.votes, [playerId]: targetId };
      await updateDoc(roomRef, {
        votes: newVotes,
      });

      if (soundEnabled) audioSynth.playVoteSubmit();
      addToast("تم تسجيل صوتك بنجاح!", "success");
    } catch (err) {
      console.error("Submit vote failed:", err);
      addToast("حدث خطأ في تسجيل صوتك", "danger");
    }
  };

  const sheikhReveal = async () => {
    if (!room || !roomCode) return;
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const updatedPlayers = room.players.map((p) =>
        p.id === playerId ? { ...p, revealedSheikh: true } : p
      );

      await updateDoc(roomRef, {
        players: updatedPlayers,
        messages: arrayUnion({
          id: generateId(),
          senderId: null,
          senderName: "النظام",
          text: `👳 كشف الشيخ ${nickname} عن هويته الحقيقية للجميع! أصوات الشيخ الآن تُحسب بثلاثة أضعاف!`,
          time: getFormattedTime(),
          isSystem: true,
          isDeadChat: false,
        }),
        eventsLog: arrayUnion({
          id: generateId(),
          icon: "👳",
          text: `👳 كشف الشيخ ${nickname} عن نفسه للبلدة.`,
          time: getFormattedTime(),
          round: room?.round || 0,
        }),
      });

      addToast("لقد كشفت هويتك الحقيقية لجميع اللاعبين!", "success");
    } catch (err) {
      console.error("Sheikh reveal failed:", err);
      addToast("حدث خطأ أثناء محاولة كشف هويتك", "danger");
    }
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !room || !roomCode) return;

    try {
      const isDead = me?.isAlive === false;
      const newMessage: Message = {
        id: generateId(),
        senderId: playerId,
        senderName: nickname,
        text: chatMessage.trim(),
        time: getFormattedTime(),
        isSystem: false,
        isDeadChat: isDead,
      };

      const roomRef = doc(db, "rooms", roomCode);
      await updateDoc(roomRef, {
        messages: arrayUnion(newMessage),
      });

      setChatMessage("");
    } catch (err) {
      console.error("Send message failed:", err);
      addToast("فشل إرسال الرسالة", "danger");
    }
  };

  const restartGame = async () => {
    if (!room || !roomCode) return;
    try {
      const roomRef = doc(db, "rooms", roomCode);

      // Reset players lists
      const resetPlayers = room.players.map((p) => ({
        ...p,
        isAlive: true,
        isMuted: false,
        revealedSheikh: false,
        role: "",
      }));

      // Delete all private roles in a batch to keep things completely pristine
      const privDocs = await getDocs(collection(db, "rooms", roomCode, "playersPrivate"));
      const batch = writeBatch(db);
      privDocs.forEach((doc) => {
        batch.set(doc.ref, { role: "", mafiaTeammates: [] });
      });
      await batch.commit();

      await updateDoc(roomRef, {
        status: "lobby",
        round: 0,
        winner: null,
        votes: {},
        players: resetPlayers,
        nightOutcomeText: "",
        voteOutcomeText: "",
        jokerChoice: null,
        mafiaTarget: null,
        muteTarget: null,
        doctorTarget: null,
        sniperTarget: null,
        phaseEndsAt: 0,
        messages: [
          {
            id: generateId(),
            senderId: null,
            senderName: "النظام",
            text: "🔄 تمت إعادة ضبط اللعبة بنجاح من قبل المضيف وهي جاهزة لبدء جولة جديدة الآن!",
            time: getFormattedTime(),
            isSystem: true,
            isDeadChat: false,
          },
        ],
        eventsLog: [
          {
            id: generateId(),
            icon: "🔄",
            text: "🔄 تمت إعادة ضبط اللعبة لجولة جديدة.",
            time: getFormattedTime(),
            round: 0,
          },
        ],
      });

      addToast("تمت إعادة ضبط اللعبة اللحظية بنجاح جولة جديدة!", "success");
    } catch (err) {
      console.error("Restart game failed:", err);
      addToast("فشل في إعادة ضبط اللعبة", "danger");
    }
  };

  const addBot = async () => {
    if (!room || !roomCode) return;
    if (room.players.length >= 18) {
      addToast("الغرفة ممتلئة بالكامل، لا يمكن إضافة روبوتات", "danger");
      return;
    }

    const botNames = ["حمد", "فيصل", "خالد", "سارة", "عبدالعزيز", "نورة", "فهد", "ريم", "مساعد", "جواهر"];
    // Choose a bot name not in the room
    const existingNames = room.players.map((p) => p.nickname);
    const availableNames = botNames.filter((name) => !existingNames.includes(name));
    const botName = availableNames[Math.floor(Math.random() * availableNames.length)] || `بوت_${generateId().substring(0, 3)}`;

    const botId = `bot_${generateId()}`;
    const botPlayer: Player = {
      id: botId,
      nickname: botName,
      avatarId: Math.floor(Math.random() * 8) + 1,
      isHost: false,
      isAlive: true,
      isOffline: false,
      role: "",
      isMuted: false,
      revealedSheikh: false,
      isBot: true,
    };

    try {
      const roomRef = doc(db, "rooms", roomCode);
      await updateDoc(roomRef, {
        players: [...room.players, botPlayer],
        messages: arrayUnion({
          id: generateId(),
          senderId: null,
          senderName: "النظام",
          text: `🤖 انضم الروبوت الذكي ${botName} إلى الغرفة!`,
          time: getFormattedTime(),
          isSystem: true,
          isDeadChat: false,
        }),
      });

      // Create blank private record
      await setDoc(doc(db, "rooms", roomCode, "playersPrivate", botId), { role: "", mafiaTeammates: [] });

      addToast("تمت إضافة الروبوت الذكي للغرفة بنجاح!", "success");
    } catch (err) {
      console.error("Add bot failed:", err);
      addToast("فشل في إضافة الروبوت", "danger");
    }
  };

  const leaveRoom = async () => {
    if (!room || !roomCode) {
      setRoomCode("");
      return;
    }

    try {
      const roomRef = doc(db, "rooms", roomCode);
      const isMeHost = me?.isHost;
      const filteredPlayers = room.players.filter((p) => p.id !== playerId);

      if (filteredPlayers.length === 0) {
        // Room empty, delete room
        await deleteDoc(roomRef);
      } else {
        // Handover host if I am leaving
        if (isMeHost) {
          const nextActiveHost = filteredPlayers.find(p => !p.isOffline && !p.isBot) || filteredPlayers[0];
          nextActiveHost.isHost = true;
          
          await updateDoc(roomRef, {
            players: filteredPlayers.map(p => p.id === nextActiveHost.id ? { ...p, isHost: true } : p),
            hostId: nextActiveHost.id,
            messages: arrayUnion({
              id: generateId(),
              senderId: null,
              senderName: "النظام",
              text: `🚪 غادر المضيف ${nickname}. المضيف الجديد للغرفة هو ${nextActiveHost.nickname}.`,
              time: getFormattedTime(),
              isSystem: true,
              isDeadChat: false,
            })
          });
        } else {
          await updateDoc(roomRef, {
            players: filteredPlayers,
            messages: arrayUnion({
              id: generateId(),
              senderId: null,
              senderName: "النظام",
              text: `🚪 غادر اللاعب ${nickname} الغرفة.`,
              time: getFormattedTime(),
              isSystem: true,
              isDeadChat: false,
            })
          });
        }
      }

      // Cleanup local room code
      setRoomCode("");
      setRoomCodeInput("");
      addToast("غادرت الغرفة بنجاح", "info");
    } catch (err) {
      console.error("Leave room failed:", err);
      addToast("فشل في مغادرة الغرفة", "danger");
    }
  };

  // Find player representation of current client
  const me = room?.players.find((p) => p.id === playerId);
  const isAlive = me?.isAlive || false;

  // Render Helpers
  const getPlayerAvatar = (p: Player, sizeClass = "w-12 h-12 text-xl") => {
    const avatar = AVATARS.find((a) => a.id === p.avatarId) || AVATARS[5];
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br ${avatar.gradient} flex items-center justify-center shadow-lg border border-white/10 relative shrink-0 transition-all duration-300`}
      >
        <span className="select-none">{avatar.emoji}</span>
        {p.isOffline && (
          <div className="absolute -bottom-1 -right-1 bg-amber-500 rounded-full p-0.5 border border-black text-[9px] font-bold text-black" title="غير متصل">
            ⚠️
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen w-full bg-[#100C08] text-white flex flex-col relative overflow-hidden select-none" style={{ direction: "rtl" }}>
      {/* Ambient noise overlay */}
      <div className="absolute inset-0 noise-overlay z-0 pointer-events-none" />

      {/* Floating Status / Connection Check & Sounds */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-2.5 rounded-full bg-stone-900 border border-stone-800 text-stone-400 hover:text-white transition-all cursor-pointer"
          title={soundEnabled ? "كتم الصوت" : "تشغيل الصوت"}
        >
          {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-[#95122C]" />}
        </button>
        <div
          className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
            connStatus === "connected"
              ? "bg-emerald-950 text-emerald-400 border border-emerald-800/40"
              : "bg-amber-950 text-amber-400 border border-amber-800/40 animate-pulse"
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${connStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
          {connStatus === "connected" ? "متصل بالخادم" : "جاري الاتصال..."}
        </div>
      </div>

      {/* TOAST NOTIFICATION CONTAINER */}
      <div className="fixed top-16 left-4 right-4 z-50 flex flex-col gap-2 max-w-sm mx-auto pointer-events-none">
        <AnimatePresence>
          {notifications.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              className={`p-4 rounded-xl shadow-2xl border flex items-center gap-3 pointer-events-auto ${
                toast.type === "success"
                  ? "bg-emerald-950 border-emerald-800 text-emerald-100"
                  : toast.type === "danger"
                  ? "bg-red-950 border-red-800 text-red-100"
                  : "bg-stone-900 border-stone-800 text-stone-100"
              }`}
            >
              <div className="shrink-0 text-lg">
                {toast.type === "success" && "✔️"}
                {toast.type === "danger" && "⚠️"}
                {toast.type === "info" && "ℹ️"}
              </div>
              <p className="text-sm font-medium leading-relaxed">{toast.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ==========================================
          SCENE 1: WELCOME SCREEN (HOMEPAGE)
         ========================================== */}
      {!room && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-md mx-auto w-full z-10 py-10 overflow-y-auto">
          {/* Glowing Game Logo/Title with rotating 3D effect */}
          <div className="text-center mb-10 select-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="inline-flex items-center justify-center w-24 h-24 rounded-xl bg-[#95122C] border border-red-500/20 shadow mb-5 text-5xl relative cursor-pointer group"
            >
              🕶️
            </motion.div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2 font-sans select-none">
              لعبة <span className="text-[#95122C]">المافيا</span>
            </h1>
            <p className="text-stone-400 text-xs font-medium tracking-wide">لعبة الغموض، الذكاء، والتآمر الجماعي</p>
          </div>

          {/* Nickname Input - Styled with smooth focus and red subtle glows */}
          <div className="w-full mb-6 glass-surface-elevated p-6 rounded-xl shadow relative overflow-hidden group">
            <label className="block text-stone-400 text-xs font-bold mb-3 pr-1">الاسم المستعار قبل البدء:</label>
            <div className="relative">
              <input
                type="text"
                maxLength={15}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="أدخل اسمك المستعار هنا..."
                className="w-full bg-stone-950/90 border border-stone-800 focus:border-[#95122C] focus:ring-1 focus:ring-[#95122C]/40 rounded-xl py-3 px-4 pr-11 text-white text-sm font-semibold outline-none transition-all text-center placeholder-stone-600"
              />
              <User className="absolute right-4 top-3.5 w-4.5 h-4.5 text-stone-500 group-focus-within:text-[#95122C] transition-colors" />
            </div>
          </div>

          {/* Action Buttons with tactile hover, press feedbacks */}
          <div className="w-full flex flex-col gap-3.5">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (!nickname.trim()) {
                  addToast("يرجى إدخال اسمك المستعار أولاً", "danger");
                  return;
                }
                setShowCreateModal(true);
                if (soundEnabled) audioSynth.playButtonClick();
              }}
              className="w-full btn-primary text-white font-bold py-4 px-6 rounded-xl text-sm cursor-pointer text-center"
            >
              ⚙️ إنشاء غرفة جديدة
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (!nickname.trim()) {
                  addToast("يرجى إدخال اسمك المستعار أولاً", "danger");
                  return;
                }
                setShowJoinModal(true);
                if (soundEnabled) audioSynth.playButtonClick();
              }}
              className="w-full bg-stone-900/90 hover:bg-stone-850 border border-stone-800 hover:border-stone-700 text-stone-200 hover:text-white font-bold py-4 px-6 rounded-xl transition-all text-sm cursor-pointer text-center"
            >
              🔑 الانضمام إلى غرفة
            </motion.button>
          </div>

          {/* Create Room Modal */}
          <AnimatePresence>
            {showCreateModal && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
                {/* Backdrop dismiss */}
                <div className="absolute inset-0" onClick={() => setShowCreateModal(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 15 }}
                  className="glass-surface-elevated p-6 rounded-3xl w-full max-w-sm shadow-[0_25px_60px_rgba(0,0,0,0.85)] relative z-10 text-right"
                >
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="absolute top-4 left-4 p-1.5 rounded-lg bg-white/5 text-stone-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <h3 className="text-lg font-bold text-white mb-5 pr-1 border-r-2 border-[#95122C] leading-none">تجهيز الغرفة</h3>
                  
                  <form onSubmit={createRoom} className="space-y-5">
                    <div>
                      <label className="block text-stone-400 text-xs font-bold mb-2">وقت النهار بالثواني:</label>
                      <input
                        type="number"
                        min={30}
                        max={300}
                        value={dayDuration}
                        onChange={(e) => setDayDuration(parseInt(e.target.value) || 30)}
                        className="w-full bg-stone-950 border border-stone-800 focus:border-[#95122C] rounded-xl py-3 px-4 text-white text-sm outline-none text-center font-bold"
                      />
                      <span className="text-[10px] text-stone-500 block mt-1.5 leading-relaxed">الحد الأدنى 30 ثانية. تمنح اللاعبين فرصة للتحليل والنقاش.</span>
                    </div>

                    <button
                      type="submit"
                      className="w-full btn-primary text-white font-bold py-3.5 px-6 rounded-xl text-xs cursor-pointer shadow-lg"
                    >
                      إنشاء ودخول اللوبي 🚀
                    </button>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Join Room Modal */}
          <AnimatePresence>
            {showJoinModal && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
                {/* Backdrop dismiss */}
                <div className="absolute inset-0" onClick={() => setShowJoinModal(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: 15 }}
                  className="glass-surface-elevated p-6 rounded-3xl w-full max-w-sm shadow-[0_25px_60px_rgba(0,0,0,0.85)] relative z-10 text-right"
                >
                  <button
                    type="button"
                    onClick={() => setShowJoinModal(false)}
                    className="absolute top-4 left-4 p-1.5 rounded-lg bg-white/5 text-stone-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer border border-white/5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <h3 className="text-lg font-bold text-white mb-5 pr-1 border-r-2 border-[#95122C] leading-none">انضمام إلى غرفة</h3>
                  
                  <form onSubmit={joinRoom} className="space-y-5">
                    <div>
                      <label className="block text-stone-400 text-xs font-bold mb-2">كود الغرفة المتكون من 5 أحرف:</label>
                      <input
                        type="text"
                        maxLength={5}
                        placeholder="مثال: A7D9X"
                        value={roomCodeInput}
                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                        className="w-full bg-stone-950 border border-stone-800 focus:border-[#95122C] rounded-xl py-3.5 px-4 text-white text-sm font-bold tracking-widest outline-none text-center uppercase placeholder-stone-800"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full btn-primary text-white font-bold py-3.5 px-6 rounded-xl text-xs cursor-pointer shadow-lg"
                    >
                      دخول الآن 🚪
                    </button>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ==========================================
          SCENE 2: LOBBY SCREEN (WAITING AREA)
         ========================================== */}
      {room && room.status === "lobby" && (
        <div className="flex-1 flex flex-col max-w-xl mx-auto w-full z-10 px-4 py-6 overflow-hidden">
          {/* Header Card */}
          <div className="glass-surface-elevated p-6 rounded-xl text-center mb-6 relative shadow">
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={leaveRoom}
              className="absolute top-4 left-4 text-[10px] font-black text-stone-300 hover:text-white bg-white/5 hover:bg-red-950 px-3 py-2 rounded-xl border border-white/10 flex items-center gap-1 cursor-pointer transition-all"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" /> مغادرة
            </motion.button>
            <span className="text-stone-400 text-xs font-bold block mb-3">كود الغرفة لمشاركته مع أصدقائك</span>
            <div className="inline-flex items-center gap-3 bg-stone-950 px-6 py-3 rounded-xl border border-stone-800 shadow-sm select-all mb-3 group hover:border-[#95122C]/40 transition-colors">
              <span className="text-2xl font-black tracking-widest font-mono text-white select-all">{room.code}</span>
              <button
                type="button"
                onClick={copyRoomCode}
                className="p-1.5 rounded-lg bg-stone-900 hover:bg-stone-850 border border-stone-800 text-stone-400 hover:text-white cursor-pointer transition-all"
                title="نسخ الكود"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-stone-500 font-semibold tracking-wide">وقت النهار المحدد للجولة: {room.dayDuration} ثانية</p>
          </div>

          {/* Players List */}
          <div className="flex-1 glass-surface-elevated rounded-xl p-6 flex flex-col overflow-hidden shadow relative">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h3 className="text-sm font-black text-stone-200">قائمة اللاعبين المتواجدين</h3>
              <span className="px-3 py-1 rounded-full bg-stone-950 text-[10px] font-black border border-stone-800 text-stone-400">
                👥 {room.players.length} / 18
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {room.players.map((p, idx) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    p.id === playerId
                      ? "bg-[#95122C]/10 border-[#95122C]/40 shadow-sm"
                      : "bg-stone-950 border-stone-900/80 hover:border-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {getPlayerAvatar(p, "w-10 h-10 text-base")}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-stone-400 text-sm">👤</span>
                        <span className="font-bold text-sm block">
                          {p.nickname} {p.id === playerId && <span className="text-xs text-[#95122C] font-black mr-1">(أنت)</span>}
                          {p.isBot && <span className="text-xs text-blue-400 font-semibold mr-1.5">🤖 بوت ذكاء اصطناعي</span>}
                        </span>
                      </div>
                      {p.isHost && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-500 border border-amber-900/40 font-semibold mt-0.5">
                          <Crown className="w-2.5 h-2.5" /> صاحب الغرفة
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {p.isHost && <Crown className="w-4 h-4 text-amber-500 animate-pulse" />}
                </motion.div>
              ))}
            </div>

            {/* Start Button constraints */}
            <div className="mt-5 border-t border-white/5 pt-4 shrink-0">
              {room.players.length < 7 ? (
                <div className="text-center p-3 rounded-xl bg-amber-950/20 border border-amber-900/30 text-amber-500 text-xs font-semibold mb-3 leading-relaxed">
                  ⚠️ تحتاج إلى 7 لاعبين على الأقل لبدء المباراة. المتبقي: {7 - room.players.length} لاعب.
                </div>
              ) : (
                <div className="text-center p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-xs font-semibold mb-3 leading-relaxed">
                  ✅ عدد اللاعبين كافٍ ومثالي لبدء الإثارة!
                </div>
              )}

              {isHost ? (
                <div className="space-y-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={addBot}
                    disabled={room.players.length >= 18 || room.players.filter(p => p.isBot).length >= 7}
                    className="w-full bg-white/5 hover:bg-white/10 text-stone-200 font-bold py-3 px-4 rounded-xl transition-all text-xs border border-white/10 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    🤖 إضافة بوت (الحد الأقصى 7)
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={room.players.length >= 7 ? { scale: 1.01 } : {}}
                    whileTap={room.players.length >= 7 ? { scale: 0.99 } : {}}
                    disabled={room.players.length < 7}
                    onClick={startGame}
                    className={`w-full py-4 rounded-xl font-bold transition-all text-xs flex items-center justify-center gap-2 cursor-pointer ${
                      room.players.length >= 7
                        ? "btn-primary text-white shadow-[0_0_20px_rgba(149,18,44,0.3)] hover:shadow-[0_0_30px_rgba(149,18,44,0.6)]"
                        : "bg-stone-850 text-stone-600 border border-stone-900 cursor-not-allowed"
                    }`}
                  >
                    🏁 بدء اللعبة الآن
                  </motion.button>
                </div>
              ) : (
                <div className="text-center text-xs text-stone-500 font-black py-3 animate-pulse bg-stone-950/50 rounded-xl border border-stone-900/60">
                  ⏳ بانتظار صاحب الغرفة لبدء المباراة...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          SCENE 3: SHOWING ROLES CARD (8 SECONDS)
         ========================================== */}
      {room && room.status === "showing_roles" && me && (
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full z-10 px-4 py-8">
          <motion.div
            initial={{ rotateY: -180, scale: 0.8, opacity: 0 }}
            animate={{ rotateY: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, type: "spring", damping: 15 }}
            style={{ transformStyle: "preserve-3d" }}
            className={`w-full glass-surface-elevated border-2 text-center relative overflow-hidden p-6 rounded-xl shadow-lg ${
              me.role.startsWith("mafia") ? "border-red-900/40" :
              me.role === "doctor" ? "border-emerald-900/40" :
              me.role === "sniper" ? "border-teal-900/40" :
              me.role === "sheikh" ? "border-amber-900/40" :
              me.role === "joker" ? "border-purple-900/40" :
              "border-stone-800"
            }`}
          >

            <span className="text-[9px] text-stone-500 font-black uppercase tracking-widest block mb-2 select-none">بطاقة دورك السري</span>
            <h2 className="text-xl font-black mb-5 text-stone-200 select-none leading-none">اعرف هويتك...</h2>

            {/* Role Icon / Presentation */}
            <div className="my-8 flex justify-center">
              <div className={`w-28 h-28 rounded-full bg-stone-950/90 flex items-center justify-center border shadow-2xl relative ${
                me.role.startsWith("mafia") ? "border-red-500/30" :
                me.role === "doctor" ? "border-emerald-500/30" :
                me.role === "sniper" ? "border-teal-500/30" :
                me.role === "sheikh" ? "border-amber-500/30" :
                me.role === "joker" ? "border-purple-500/30" :
                "border-stone-800"
              }`}>
                {me.role.startsWith("mafia") && <Skull className="w-12 h-12 text-rose-500 drop-shadow-[0_0_15px_rgba(244,63,94,0.55)] animate-pulse" />}
                {me.role === "doctor" && <Shield className="w-12 h-12 text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.55)] animate-pulse" />}
                {me.role === "sniper" && <Target className="w-12 h-12 text-teal-400 drop-shadow-[0_0_15px_rgba(45,212,191,0.55)]" />}
                {me.role === "sheikh" && <Crown className="w-12 h-12 text-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.55)] animate-pulse" />}
                {me.role === "joker" && <div className="text-5xl drop-shadow-[0_0_15px_rgba(168,85,247,0.55)]">🃏</div>}
                {me.role === "citizen" && <User className="w-12 h-12 text-stone-300 drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />}
              </div>
            </div>

            {/* Role Title in Arabic */}
            <h3
              className={`text-2xl font-black mb-4 select-none ${
                me.role.startsWith("mafia") ? "text-rose-500" :
                me.role === "doctor" ? "text-emerald-400" :
                me.role === "sniper" ? "text-teal-400" :
                me.role === "sheikh" ? "text-amber-400" :
                me.role === "joker" ? "text-purple-400" :
                "text-stone-100"
              }`}
            >
              {me.role.startsWith("mafia") && "المافيا 🕶️"}
              {me.role === "doctor" && "الطبيب (الدكتور) 🩺"}
              {me.role === "sniper" && "القناص 🎯"}
              {me.role === "sheikh" && "الشيخ 👳"}
              {me.role === "joker" && "الجوكر 🃏"}
              {me.role === "citizen" && "المواطن العادي 👤"}
            </h3>

            {/* Role Explanation Description */}
            <p className="text-stone-300 text-xs font-semibold leading-relaxed mb-6 px-4 select-none">
              {me.role.startsWith("mafia") && (
                me.role === "mafia_single"
                  ? "أنت المافيا الوحيد بالمدينة! تمتلك قدرة القتل (اختيار شخص ليقتل بالليل) وقدرة التسكيت (منع شخص من التحدث والتصويت) معاً."
                  : me.role === "mafia_killer"
                  ? "أنت مافيا القتل! دورك اختيار شخص واحد ليقتله فريقكم كل ليلة بالتوافق مع شريكك."
                  : "أنت مافيا التسكيت! دورك اختيار شخص واحد لتسكيته ومنعه من إرسال الرسائل والتصويت في نهار اليوم التالي."
              )}
              {me.role === "doctor" &&
                "أنت طبيب المدينة! كل ليلة يمكنك اختيار لاعب لحمايته من رصاص المافيا. يمكنك حماية نفسك، لكن لا يمكنك حماية نفس الشخص ليلتين متتاليتين."}
              {me.role === "sniper" &&
                "أنت حامي المدينة السري! تمتلك رصاصة ذهبية واحدة فقط طوال المباراة تستخدمها ليلاً للتخلص من المافيا المشتبه بهم. طلقاتك قاتلة لجميع الأدوار ولا يمكن للدكتور حماية من تصيبه."}
              {me.role === "sheikh" &&
                "أنت عميد المدينة! يمكنك الكشف عن هويتك الحقيقية في أي وقت خلال النهار. من تلك اللحظة، سيصبح صوتك يعادل 3 أصوات كاملة في التصويت، لكن انتبه فقد تصبح هدفاً للمافيا."}
              {me.role === "joker" &&
                "أنت اللاعب المجهول والفرصة المزدوجة! اختر قدرة النسخ المفضلة لديك أدناه قبل بدء الليل الأول، وانتظر لتحصل على هذا الدور بكل مميزاته وصلاحياته بالكامل فور حدوث الشرط."}
              {me.role === "citizen" &&
                "أنت السلاح الأقوى لأهالي المدينة! لا تملك قدرة خارقة، لكن سلاحك هو النقاش الصباحي، تحليل تصرفات الآخرين، والتصويت الصحيح للقضاء على المافيا."}
            </p>

            {/* SPECIAL INPUT: JOKER CHOICE */}
            {me.role === "joker" && (
              <div className="bg-stone-950/70 p-4 rounded-2xl border border-purple-900/20 text-right mb-4 shadow-inner">
                <span className="text-[10px] font-bold text-purple-400 block mb-3">اختر قدرة النسخ المفضلة لديك (لا يمكن تعديلها لاحقاً):</span>
                <div className="flex flex-col gap-2.5">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => selectJokerChoice("first_night_death")}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold text-right border transition-all cursor-pointer ${
                      room.jokerChoice === "first_night_death"
                        ? "bg-purple-950/40 border-purple-500/50 text-purple-200 font-black shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                        : "bg-stone-900/40 border-stone-850 text-stone-400 hover:text-white"
                    }`}
                  >
                    🎭 نسخ دور أول لاعب يقتل في الليل
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => selectJokerChoice("first_vote_elimination")}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold text-right border transition-all cursor-pointer ${
                      room.jokerChoice === "first_vote_elimination"
                        ? "bg-purple-950/40 border-purple-500/50 text-purple-200 font-black shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                        : "bg-stone-900/40 border-stone-850 text-stone-400 hover:text-white"
                    }`}
                  >
                    ⚖️ نسخ دور أول لاعب يقصى بالتصويت الصباحي
                  </motion.button>
                </div>
              </div>
            )}

            {/* SPECIAL INFO: MAFIA ACCOMPLICE REVEAL */}
            {me.role.startsWith("mafia_") && room.players.filter((p) => p.role.startsWith("mafia_")).length > 1 && (
              <div className="bg-red-950/20 border border-red-900/20 p-4 rounded-2xl text-right mb-4 shadow-inner">
                <span className="text-[10px] font-black text-rose-400 block mb-2.5">شركاؤك في المافيا:</span>
                <div className="flex flex-wrap items-center gap-2">
                  {room.players
                    .filter((p) => p.role.startsWith("mafia_") && p.id !== playerId)
                    .map((p) => (
                      <div key={p.id} className="flex items-center gap-2 bg-stone-950/60 px-3 py-1.5 rounded-xl border border-red-900/20">
                        {getPlayerAvatar(p, "w-6 h-6 text-xs")}
                        <span className="text-xs font-bold text-rose-200">{p.nickname}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Countdown counter */}
            <div className="mt-4 inline-flex items-center gap-2 bg-stone-950 px-4 py-2 rounded-full border border-stone-800">
              <span className="w-2.5 h-2.5 rounded-full bg-[#95122C] animate-ping" />
              <span className="text-xs text-stone-400 font-bold">ستبدأ المباراة تلقائياً خلال: {room.timer} ثانية</span>
            </div>
          </motion.div>
        </div>
      )}

      {/* ==========================================
          SCENE 4: GAME OVER SCREEN
         ========================================== */}
      {room && room.status === "game_over" && (
        <div className="flex-1 flex flex-col max-w-xl mx-auto w-full z-10 px-4 py-6">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-stone-900 border border-stone-800 p-8 rounded-xl text-center mb-6 shadow"
          >
            <div className="text-6xl mb-4">🏆</div>
            <h2 className="text-4xl font-black text-white mb-2 font-sans">انتهت اللعبة!</h2>
            <div
              className={`inline-block px-6 py-2 rounded-full font-bold text-lg mb-6 border ${
                room.winner === "citizens"
                  ? "bg-emerald-950 text-emerald-400 border-emerald-800/80"
                  : "bg-red-950 text-rose-500 border-red-800/80"
              }`}
            >
              {room.winner === "citizens" ? "🎉 فاز فريق المواطنين!" : "👿 فاز فريق المافيا!"}
            </div>

            {/* Detailed players recap table */}
            <div className="bg-stone-950 border border-stone-800 rounded-xl p-4 text-right mb-6">
              <h3 className="text-xs font-extrabold text-stone-400 mb-4 pr-1 border-b border-stone-800 pb-2">هويات وأدوار جميع اللاعبين الحقيقية</h3>
              <div className="space-y-3 overflow-y-auto max-h-[300px] pr-1">
                {room.players.map((p) => {
                  return (
                    <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-stone-900 border border-stone-850/60">
                      <div className="flex items-center gap-2.5">
                        {getPlayerAvatar(p, "w-8 h-8 text-sm")}
                        <div>
                          <span className="font-bold text-xs block">{p.nickname}</span>
                          <span className="text-[9px] text-stone-500 font-medium">الحالة: {p.isAlive ? "✅ حي" : "💀 ميت"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            p.role.startsWith("mafia_")
                              ? "bg-rose-950/50 text-rose-400 border border-rose-900/30"
                              : p.role === "doctor"
                              ? "bg-emerald-950/50 text-emerald-400 border border-emerald-900/30"
                              : p.role === "sniper"
                              ? "bg-teal-950/50 text-teal-400 border border-teal-900/30"
                              : p.role === "sheikh"
                              ? "bg-amber-950/50 text-amber-400 border border-amber-900/30"
                              : p.role === "joker"
                              ? "bg-purple-950/50 text-purple-400 border border-purple-900/30"
                              : "bg-stone-900 text-stone-300 border border-stone-800"
                          }`}
                        >
                          {getRoleNameInArabic(p.role)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions button */}
            {isHost ? (
              <button
                onClick={restartGame}
                className="w-full bg-[#95122C] hover:bg-red-700 text-white font-bold py-4 px-6 rounded-xl transition-all cursor-pointer text-sm"
              >
                🔄 إعادة تعيين وبدء مباراة جديدة باللوبي
              </button>
            ) : (
              <div className="text-xs text-stone-500 text-center bg-stone-950 py-3 rounded-xl border border-stone-900">
                ⏳ بانتظار صاحب الغرفة للعودة بالجميع للوبي...
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* ==========================================
          SCENE 5: ACTIVE MATCH COMPONENT
         ========================================== */}
      {room && room.status !== "lobby" && room.status !== "showing_roles" && room.status !== "game_over" && me && (
        <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full z-10 p-4 gap-4 relative overflow-hidden h-full">
          
          {/* Top Header Bar */}
          <header className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-3 glass-surface border border-white/5 rounded-xl shadow relative shrink-0">
            
            <div className="flex items-center gap-6">
              <div className="flex flex-col text-right">
                <span className="text-stone-400 text-[10px] font-bold">الجولة</span>
                <span className="text-xl font-black leading-none text-white font-mono">{String(room.round).padStart(2, "0")}</span>
              </div>
              <div className="h-8 w-[1px] bg-white/5"></div>
              <div className="flex flex-col text-right">
                <span className="text-stone-400 text-[10px] font-bold">حالة اللعبة</span>
                <span className={`text-sm font-black leading-none ${room.status === "night" ? "text-indigo-400" : room.status === "voting" ? "text-rose-500" : "text-amber-400"}`}>
                  {room.status === "night" ? "🌙 ليل" : room.status === "voting" ? "⚖️ تصويت" : "☀️ نهار"}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <div className="text-3xl font-mono font-black tracking-widest text-[#95122C] flex items-center gap-1.5">
                <span className="text-xl">●</span>
                {String(Math.floor(room.timer / 60)).padStart(2, "0")}:{String(room.timer % 60).padStart(2, "0")}
              </div>
              <div className="w-48 h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden border border-white/5">
                <div 
                  className="h-full bg-[#95122C] transition-all duration-1000" 
                  style={{ width: `${(room.timer / (room.status === "night" ? 30 : room.status === "voting" ? 20 : room.dayDuration)) * 100}%` }} 
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="bg-stone-950 border border-white/5 px-4 py-2 rounded-xl flex items-center gap-2.5 shadow-inner">
                <span className="text-[10px] text-stone-400 font-bold">كود الغرفة:</span>
                <span className="text-base font-mono font-black tracking-widest text-white">{room.code}</span>
                <button 
                  type="button"
                  onClick={copyRoomCode} 
                  className="p-1 hover:bg-white/5 rounded-lg transition-all cursor-pointer text-stone-400 hover:text-white border border-transparent hover:border-white/5"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </header>

          {/* Main Content Area: Players Grid */}
          <main className="flex-1 p-5 glass-surface border border-white/5 rounded-xl flex flex-col overflow-hidden min-h-[180px] shadow relative">
            <div className="flex justify-between items-center mb-3 shrink-0">
              <h4 className="text-[10px] font-black tracking-wide text-stone-400 pr-1 uppercase">حالة لاعبي المدينة</h4>
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[9px] text-stone-400 font-bold">أونلاين</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {room.players.map((p) => {
                const avatar = AVATARS.find((a) => a.id === p.avatarId) || AVATARS[5];
                
                // Calculate dynamic vote display weight (Sheikh count as 3 if revealed)
                let voteCountDisplay = 0;
                Object.entries(room.votes).forEach(([voterId, votedId]) => {
                  if (votedId === p.id) {
                    const voter = room.players.find(v => v.id === voterId);
                    const weight = (voter?.role === "sheikh" && voter?.revealedSheikh) ? 3 : 1;
                    voteCountDisplay += weight;
                  }
                });

                return (
                  <motion.div
                    key={p.id}
                    initial={false}
                    animate={{ rotateY: p.isAlive ? 0 : 180 }}
                    transition={{ duration: 0.6, ease: "easeInOut" }}
                    style={{ transformStyle: "preserve-3d" }}
                    className={`relative rounded-xl p-3.5 flex flex-col items-center justify-center transition-all border ${
                      !p.isAlive
                        ? "bg-stone-950/80 border-stone-850"
                        : p.id === playerId
                        ? "bg-[#95122C]/10 border-[#95122C]/40 shadow-sm"
                        : "bg-white/5 border-white/5 hover:bg-white/8 hover:border-white/10"
                    }`}
                  >
                    <div style={{ transform: p.isAlive ? "none" : "rotateY(180deg)" }} className="w-full flex flex-col items-center">
                      {/* Avatar block */}
                      <div className="relative mb-1">
                        <div className={`w-14 h-14 rounded-full border ${
                          p.isMuted && p.isAlive ? "border-red-500/50" :
                          p.revealedSheikh && p.isAlive ? "border-amber-400" :
                          !p.isAlive ? "border-stone-700" :
                          p.id === playerId ? "border-[#95122C]" : "border-white/10"
                        } p-1`}>
                          <div className={`w-full h-full rounded-full bg-gradient-to-br ${avatar.gradient} flex items-center justify-center text-xl`}>
                            {p.isAlive ? (p.revealedSheikh ? "👳" : avatar.emoji) : "💀"}
                          </div>
                        </div>
                        
                        {/* Role indicators */}
                        {p.isAlive && p.id !== playerId && p.role === "mafia_team" && (
                          <div className="absolute -top-1 -left-1 bg-rose-600 text-white text-[9px] w-5 h-5 rounded-full flex items-center justify-center shadow-lg border border-rose-500" title="عضو مافيا من فريقك">
                            👿
                          </div>
                        )}
                        {p.isMuted && p.isAlive && (
                          <div className="absolute -bottom-1 -right-1 bg-red-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg">🤐 صامت</div>
                        )}
                        {p.id === playerId && (
                          <div className="absolute -top-1 -right-1 bg-[#95122C] border border-red-500/30 text-white text-[8px] px-1.5 py-0.5 rounded font-black select-none">أنت</div>
                        )}
                      </div>

                      {/* Nickname */}
                      <span className={`font-bold text-xs truncate w-full text-center px-1 flex items-center justify-center gap-1.5 ${!p.isAlive ? "text-stone-500" : "text-white"}`}>
                        {p.isBot && <span className="text-[10px]" title="بوت ذكاء اصطناعي">🤖</span>}
                        {p.nickname}
                        {p.revealedSheikh && p.isAlive && <span className="text-xs">👳</span>}
                      </span>

                      {/* Display revealed role underneath for clarity if dead or if currently yourself */}
                      {(!p.isAlive && p.role) ? (
                        <span className="text-[8px] uppercase tracking-widest text-rose-500 font-bold mt-1 select-none">
                          {getRoleNameInArabic(p.role)}
                        </span>
                      ) : (p.id === playerId && p.role) ? (
                        <span className="text-[8px] text-[#95122C] font-black mt-1 select-none">
                          {getRoleNameInArabic(p.role)}
                        </span>
                      ) : null}

                      {/* Voting dynamic bubbles */}
                      {room.status === "voting" && voteCountDisplay > 0 && (
                        <div className="absolute top-2 left-2 bg-red-950 text-rose-400 border border-red-900 text-[9px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow">
                          {voteCountDisplay}
                        </div>
                      )}
                      
                      {/* Voted indicator checkmark */}
                      {room.status === "voting" && room.votes[p.id] && (
                        <span className="absolute top-2 right-2 text-[8px] bg-emerald-950/80 text-emerald-400 border border-emerald-900/40 px-1 py-0.5 rounded font-bold">
                          تم التصويت
                        </span>
                      )}

                      {/* Connectivity dot */}
                      <div className="absolute top-2 left-2 flex gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${p.isOffline ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </main>

          {/* Bottom Chat and Controls Area */}
          <div className="flex flex-col md:flex-row gap-4 w-full items-stretch shrink-0">
            {/* 1. Standalone Event Log Card */}
            <div className="flex-1 glass-surface border border-white/5 rounded-xl p-4 flex flex-col h-[280px] overflow-hidden shadow">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-3 shrink-0 select-none">
                <ScrollText className="w-4 h-4 text-[#95122C]" />
                <h3 className="text-xs font-black text-stone-200">سجل الأحداث</h3>
              </div>
              <div ref={eventsContainerRef} className="flex-1 overflow-y-auto space-y-2 px-1 flex flex-col">
                {room.eventsLog && room.eventsLog.length > 0 ? (
                  room.eventsLog.map((event) => (
                    <div 
                      key={event.id} 
                      className="flex gap-2.5 items-start bg-stone-950 border border-stone-900/60 p-2.5 rounded-xl text-stone-100 shadow-sm shrink-0 hover:bg-white/5 transition-colors"
                    >
                      <div className="text-base select-none pt-0.5">{event.icon}</div>
                      <div className="flex-1 flex flex-col gap-0.5 text-right">
                        <p className="text-[11px] font-semibold leading-relaxed text-stone-200">{event.text}</p>
                        <span className="text-[8px] text-stone-500 font-medium self-end">{event.time}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-stone-600 py-6 gap-2 select-none">
                    <ScrollText className="w-8 h-8 text-stone-800" />
                    <span className="text-xs font-bold">لا توجد أحداث مسجلة حالياً في هذه المباراة</span>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Side Action/Controls Card */}
            <div className="w-full md:w-64 glass-surface-elevated border border-white/5 rounded-xl p-4 flex flex-col justify-between gap-4 shadow shrink-0">
              <div className="space-y-4">
                {/* Live Players Indicator */}
                <div className="bg-stone-950 border border-stone-900/50 p-3 rounded-xl select-none">
                  <div className="flex justify-between text-[10px] mb-1 text-stone-400 font-bold">
                    <span>اللاعبين الأحياء</span>
                    <span className="text-white">
                      {room.players.filter((p) => p.isAlive).length} / {room.players.length}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500" 
                      style={{ 
                        width: `${(room.players.filter((p) => p.isAlive).length / room.players.length) * 100}%` 
                      }} 
                    />
                  </div>
                </div>

                {/* Live abilities console */}
                <div className="space-y-2">
                  {/* Sheikh reveal button */}
                  {isAlive && me.role === "sheikh" && !me.revealedSheikh && (room.status === "day" || room.status === "voting") && (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={sheikhReveal}
                      className="w-full bg-[#95122C] hover:bg-[#b21635] text-white py-3 rounded-xl flex items-center justify-center gap-2 transition-all font-bold text-xs cursor-pointer border border-red-500/20"
                    >
                      <span className="text-base">👳</span>
                      كشف هوية الشيخ
                    </motion.button>
                  )}

                  {/* Night active choices selection list */}
                  {isAlive && !me.isMuted && room.status === "night" && (
                    <div className="space-y-2">
                      {/* Killer selection list */}
                      {(me.role === "mafia_killer" || me.role === "mafia_single") && (
                        <div className="bg-stone-950 border border-stone-900/60 p-2 rounded-xl">
                          <span className="text-[9px] text-rose-400 font-black block mb-1.5 text-right">اختر للتصفية الليلة:</span>
                          <div className="flex flex-col gap-1 max-h-[85px] overflow-y-auto">
                            {room.players.filter(p => p.isAlive).map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => submitNightAction("kill", room.mafiaTarget === p.id ? null : p.id)}
                                className={`w-full text-right px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                                  room.mafiaTarget === p.id
                                    ? "bg-rose-950 border-rose-600/60 text-rose-200 font-black"
                                    : "bg-stone-900 border-stone-850 text-stone-400 hover:text-white"
                                }`}
                              >
                                💀 {p.nickname}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Muter selection list */}
                      {(me.role === "mafia_muter" || me.role === "mafia_single") && (
                        <div className="bg-stone-950 border border-stone-900/60 p-2 rounded-xl">
                          <span className="text-[9px] text-amber-400 font-black block mb-1.5 text-right">اختر لتسكيته بالغد:</span>
                          <div className="flex flex-col gap-1 max-h-[85px] overflow-y-auto">
                            {room.players.filter(p => p.isAlive).map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => submitNightAction("mute", room.muteTarget === p.id ? null : p.id)}
                                className={`w-full text-right px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                                  room.muteTarget === p.id
                                    ? "bg-amber-950 border-amber-600/60 text-amber-200 font-black"
                                    : "bg-stone-900 border-stone-850 text-stone-400 hover:text-white"
                                }`}
                              >
                                🤐 {p.nickname}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Doctor selection list */}
                      {me.role === "doctor" && (
                        <div className="bg-stone-950 border border-stone-900/60 p-2 rounded-xl">
                          <span className="text-[9px] text-emerald-400 font-black block mb-1.5 text-right">اختر لحمايته الليلة:</span>
                          <div className="flex flex-col gap-1 max-h-[85px] overflow-y-auto">
                            {room.players.filter(p => p.isAlive).map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => submitNightAction("protect", room.doctorTarget === p.id ? null : p.id)}
                                className={`w-full text-right px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                                  room.doctorTarget === p.id
                                    ? "bg-emerald-950 border-emerald-600/60 text-emerald-200 font-black"
                                    : "bg-stone-900 border-stone-850 text-stone-400 hover:text-white"
                                }`}
                              >
                                🛡️ {p.nickname} {p.id === playerId && "(أنت)"}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sniper selection list */}
                      {me.role === "sniper" && (
                        <div className="bg-stone-950 border border-stone-900/60 p-2 rounded-xl">
                          <span className="text-[9px] text-teal-400 font-black block mb-1.5 text-right">اختر لقنصه الليلة:</span>
                          {room.sniperHasShot ? (
                            <span className="text-[8px] text-stone-500 block text-right font-bold">لقد نفذت ذخيرتك السحرية.</span>
                          ) : (
                            <div className="flex flex-col gap-1 max-h-[85px] overflow-y-auto">
                              {room.players.filter(p => p.isAlive && p.id !== playerId).map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => submitNightAction("shoot", room.sniperTarget === p.id ? null : p.id)}
                                  className={`w-full text-right px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                                    room.sniperTarget === p.id
                                      ? "bg-teal-950 border-teal-600/60 text-teal-200 font-black"
                                      : "bg-stone-900 border-stone-850 text-stone-400 hover:text-white"
                                  }`}
                                >
                                  🔥 قنص {p.nickname}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ordinary Citizen / Joker / Sheikh waiting */}
                      {(me.role === "citizen" || me.role === "joker" || (me.role === "sheikh" && !me.revealedSheikh)) && (
                        <div className="text-center py-4 select-none">
                          <Moon className="w-5 h-5 text-indigo-400 mx-auto mb-1" />
                          <span className="text-[10px] text-indigo-200 block font-bold">نوم هادئ بانتظار الصباح...</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Day brief Outcome text banner if active */}
                  {room.status === "day" && (
                    <div className="bg-stone-950 border border-stone-900/60 p-3 rounded-xl text-right">
                      <span className="text-[9px] text-amber-400 font-black block mb-1">الموجز الصباحي:</span>
                      <p className="text-[10px] text-stone-300 leading-relaxed font-semibold">
                        {room.nightOutcomeText || "مر الليل بسلام تام دون حدوث أي إصابات خطيرة بالمدينة."}
                      </p>
                    </div>
                  )}

                  {/* Voting selection buttons panel */}
                  {isAlive && !me.isMuted && room.status === "voting" && (
                    <div className="bg-stone-950 border border-stone-900/60 p-2 rounded-xl">
                      <span className="text-[9px] text-rose-400 font-black block mb-1.5 text-right">حدد الشخص المراد نفيه:</span>
                      {room.votes[playerId] ? (
                        <span className="text-[9px] text-emerald-400 block text-center font-black">✔️ تم تسجيل صوتك بنجاح.</span>
                      ) : (
                        <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto">
                          {room.players.filter(p => p.isAlive && p.id !== playerId).map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => submitVote(p.id)}
                              className="w-full text-right px-2.5 py-1.5 rounded-lg text-[9px] font-bold bg-stone-900 hover:bg-[#95122C]/10 border border-stone-850 hover:border-[#95122C]/30 text-stone-300 hover:text-white transition-all cursor-pointer"
                            >
                              🗳️ {p.nickname}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ghost observer info */}
                  {!isAlive && (
                    <div className="bg-stone-950 border border-stone-900/60 p-3 rounded-xl text-center select-none">
                      <Skull className="w-5 h-5 text-stone-500 mx-auto mb-1" />
                      <span className="text-[10px] text-stone-400 block font-bold">أنت تتابع بصمت ومراقبة</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-center select-none mt-2 shrink-0">
                <div className="text-[9px] text-stone-500 uppercase tracking-widest mb-1.5 font-bold">
                  {me.role.startsWith("mafia") ? "فريق المافيا 👿" : "فريق المواطنين 🤝"}
                </div>
                {room.status === "voting" ? (
                  <button 
                    disabled 
                    className="w-full py-2.5 bg-red-600/10 text-red-500 border border-red-600/20 rounded-xl text-[10px] font-black uppercase tracking-wide cursor-not-allowed opacity-50"
                  >
                    بدء التصويت النهائي
                  </button>
                ) : (
                  <button 
                    disabled 
                    className="w-full py-2.5 bg-white/5 text-stone-500 border border-white/5 rounded-xl text-[10px] font-bold cursor-not-allowed opacity-30"
                  >
                    بانتظار مرحلة التصويت
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Night Entry Transition Overlay */}
      <AnimatePresence>
        {showNightOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="fixed inset-0 bg-stone-950 z-40 flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="text-center">
              <span className="text-8xl block mb-4 select-none">🌙</span>
              <h2 className="text-3xl font-extrabold text-indigo-300 font-sans tracking-wide">الليل يرخي سدوله...</h2>
              <p className="text-stone-400 text-xs mt-2 font-medium">أغمض عينيك... المافيا تستيقظ الآن</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cinematic Overlay Animations */}
      <AnimatePresence>
        {activeCinematic && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-950 z-50 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.8, y: -20, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 120 }}
              className="max-w-lg w-full flex flex-col items-center justify-center z-10"
            >
              {/* Game Start Cinematic */}
              {activeCinematic.type === "game_start" && (
                <div className="space-y-6">
                  <motion.div
                    initial={{ rotate: -10, scale: 0.5 }}
                    animate={{ rotate: 0, scale: 1 }}
                    transition={{ delay: 0.1, type: "spring" }}
                    className="w-24 h-24 rounded-full bg-[#95122C] flex items-center justify-center border border-red-500 mx-auto"
                  >
                    <Flame className="w-12 h-12 text-white" />
                  </motion.div>
                  <motion.h2 className="text-4xl sm:text-5xl font-black text-red-500 tracking-tight font-sans">
                    بدأت المباراة!
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">استعد لمعرفة دورك السري وتحقيق النصر لشعبك...</p>
                </div>
              )}

              {/* Mafia Kill Cinematic */}
              {activeCinematic.type === "mafia_kill" && (
                <div className="space-y-6 relative">
                  <div className="h-48 flex items-center justify-center relative overflow-hidden">
                    <motion.div
                      initial={{ x: -150, opacity: 0, scale: 0.8 }}
                      animate={{ x: 0, opacity: 0.8, scale: 1 }}
                      transition={{ duration: 1.2, ease: "easeOut" }}
                      className="relative"
                    >
                      <Skull className="w-28 h-28 text-stone-700" />
                      <div className="absolute top-0 right-0 text-5xl">🔪</div>
                    </motion.div>
                  </div>
                  <motion.h2 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-3xl font-black text-rose-500 font-sans tracking-wide"
                  >
                    🔪 تسلل في الظلام...
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">قامت المافيا بتنفيذ عملية اغتيال غامضة هذه الليلة.</p>
                </div>
              )}

              {/* Doctor Save Cinematic */}
              {activeCinematic.type === "doctor_save" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center relative">
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 1.2, ease: "easeOut" }}
                      className="w-28 h-28 rounded-full bg-emerald-950/40 border-4 border-emerald-500 flex items-center justify-center shadow mx-auto"
                    >
                      <Heart className="w-14 h-14 text-emerald-400" />
                    </motion.div>
                  </div>
                  <motion.h2 className="text-3xl font-black text-emerald-400 font-sans">
                    🩺 نبضة أمل!
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">تدخل حكيم المدينة الطبيب لينقذ نفساً من براثن الموت.</p>
                </div>
              )}

              {/* Sniper Shot Cinematic */}
              {activeCinematic.type === "sniper_shot" && (
                <div className="space-y-6 relative">
                  <div className="h-48 flex items-center justify-center relative">
                    <motion.div
                      initial={{ scale: 3, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 15 }}
                      className="relative"
                    >
                      <Target className="w-28 h-28 text-teal-400" />
                      <div className="absolute inset-0 flex items-center justify-center text-red-500 text-4xl">💥</div>
                    </motion.div>
                  </div>
                  <motion.h2 className="text-3xl font-black text-teal-400 font-sans">
                    🎯 طلقة دقيقة في الظلام!
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">أطلق القناص رصاصته القاتلة دفاعاً عن أهالي المدينة.</p>
                </div>
              )}

              {/* Mute Cinematic */}
              {activeCinematic.type === "mute" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center relative">
                    <motion.div
                      initial={{ scale: 0.8, rotate: -45, opacity: 0 }}
                      animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      transition={{ type: "spring", damping: 12 }}
                      className="text-7xl"
                    >
                      🤐
                    </motion.div>
                  </div>
                  <motion.h2 className="text-3xl font-black text-stone-300 font-sans">
                    🤐 صمتٌ مطبق...
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">قامت المافيا بقطع حبال الصوت عن أحد أهالي المدينة.</p>
                </div>
              )}

              {/* Voting Cinematic */}
              {activeCinematic.type === "voting" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center">
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className="w-28 h-28 rounded-full bg-amber-950/40 border-4 border-amber-500 flex items-center justify-center shadow mx-auto"
                    >
                      <span className="text-5xl">⚖️</span>
                    </motion.div>
                  </div>
                  <motion.h2 className="text-3xl font-black text-amber-500 font-sans">
                    ⚖️ حان وقت العدالة!
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">بدأت مرحلة التصويت، دقق بصوتك لتكشف المافيا أو تطرد الخائن.</p>
                </div>
              )}

              {/* Tie Cinematic */}
              {activeCinematic.type === "tie" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center">
                    <div className="text-7xl">⚖️</div>
                  </div>
                  <motion.h2 className="text-2xl font-black text-stone-300 font-sans">
                    انتهى التصويت بالتعادل!
                  </motion.h2>
                  <p className="text-stone-400 text-sm font-medium">لم تتفق أصوات الأهالي على نفي أحد، وعاد الجميع بسلام.</p>
                </div>
              )}

              {/* Victory Citizens Cinematic */}
              {activeCinematic.type === "victory_citizens" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center">
                    <motion.div
                      initial={{ scale: 0.5, y: 50 }}
                      animate={{ scale: 1, y: 0 }}
                      transition={{ type: "spring", damping: 12 }}
                      className="w-28 h-28 rounded-full bg-stone-900 flex items-center justify-center border-2 border-amber-500 mx-auto"
                    >
                      <Crown className="w-14 h-14 text-white" />
                    </motion.div>
                  </div>
                  <h2 className="text-4xl font-extrabold text-amber-400 font-sans leading-tight">
                    انتصار أهالي المدينة! 🎉
                  </h2>
                  <p className="text-stone-400 text-sm font-medium">تخلص أهالي المدينة الشرفاء من خطر عصابة المافيا بالكامل وعمّ الأمان والعدالة.</p>
                </div>
              )}

              {/* Victory Mafia Cinematic */}
              {activeCinematic.type === "victory_mafia" && (
                <div className="space-y-6">
                  <div className="h-48 flex items-center justify-center">
                    <motion.div
                      initial={{ scale: 0.5, rotateY: 180 }}
                      animate={{ scale: 1, rotateY: 0 }}
                      transition={{ type: "spring", damping: 10 }}
                      className="w-28 h-28 rounded-full bg-stone-900 flex items-center justify-center border-2 border-rose-600 mx-auto"
                    >
                      <Skull className="w-14 h-14 text-rose-500" />
                    </motion.div>
                  </div>
                  <h2 className="text-4xl font-extrabold text-rose-600 font-sans leading-tight">
                    سيطرة المافيا بالكامل! 💀
                  </h2>
                  <p className="text-stone-400 text-sm font-medium">أحكمت عصابة المافيا قبضتها الغامضة والمخيفة على المدينة، وحققت انتصاراً ساحقاً.</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Trigger Button & Modal */}
      {room && room.status !== "lobby" && room.status !== "showing_roles" && room.status !== "game_over" && me && (
        <>
          {/* Floating Trigger Button */}
          <div className="fixed bottom-6 right-6 z-30 flex items-center gap-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                setIsChatOpen(true);
                if (soundEnabled) audioSynth.playButtonClick();
              }}
              className="relative w-14 h-14 rounded-full bg-[#95122C] hover:bg-[#b21635] text-white flex items-center justify-center shadow-[0_8px_30px_rgba(149,18,44,0.5)] border border-red-500/20 cursor-pointer transition-all duration-300"
            >
              <MessageSquare className="w-5 h-5" />
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center border border-stone-950 shadow-lg"
                >
                  {unreadCount}
                </motion.span>
              )}
            </motion.button>
          </div>

          {/* Discussion Chat Overlay Modal */}
          <AnimatePresence>
            {isChatOpen && (
              <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                {/* Backdrop dismiss */}
                <div className="absolute inset-0" onClick={() => setIsChatOpen(false)} />
                
                <motion.div
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="relative w-[92%] md:w-[45%] lg:w-[40%] h-[75vh] max-h-[600px] glass-surface-elevated border border-white/10 rounded-3xl p-5 flex flex-col shadow-[0_30px_70px_rgba(0,0,0,0.9)] z-10 text-right overflow-hidden"
                >
                  <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#95122C]/40 to-transparent" />
                  
                  {/* Modal Header */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4 shrink-0 select-none">
                    {/* Tab selection triggers */}
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("general");
                          if (soundEnabled) audioSynth.playButtonClick();
                        }}
                        className={`pb-1.5 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border-b-2 ${
                          activeTab === "general"
                            ? "border-[#95122C] text-white"
                            : "border-transparent text-stone-400 hover:text-white"
                        }`}
                      >
                        <MessageSquare className="w-4 h-4 text-[#95122C]" /> الشات العام
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (me.isAlive) {
                            addToast("شات الأموات مخصص للراحلين فقط سراً!", "info");
                            return;
                          }
                          setActiveTab("dead");
                          if (soundEnabled) audioSynth.playButtonClick();
                        }}
                        className={`pb-1.5 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border-b-2 ${
                          me.isAlive ? "opacity-35 cursor-not-allowed" : ""
                        } ${
                          activeTab === "dead"
                            ? "border-purple-500 text-white"
                            : "border-transparent text-stone-400 hover:text-white"
                        }`}
                      >
                        <Skull className="w-4 h-4 text-purple-400" /> شات الأموات
                      </button>
                    </div>

                    {/* Close Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsChatOpen(false);
                        if (soundEnabled) audioSynth.playButtonClick();
                      }}
                      className="p-1.5 bg-white/5 hover:bg-rose-950/60 hover:text-rose-400 border border-white/5 rounded-lg transition-all text-stone-400 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Chat messages */}
                  <div 
                    ref={chatContainerRef}
                    className="flex-1 space-y-3 overflow-y-auto mb-3 px-1 flex flex-col"
                  >
                    {room.messages
                      .filter((msg) => (activeTab === "dead" ? msg.isDeadChat : !msg.isDeadChat))
                      .map((msg) => {
                        const isSystem = msg.isSystem;
                        const isMyMsg = msg.senderId === playerId;

                        if (isSystem) {
                          return (
                            <div key={msg.id} className="flex items-center justify-center my-1 w-full shrink-0 select-none">
                              <p className="text-[10px] text-emerald-400 font-bold leading-relaxed bg-emerald-950/30 border border-emerald-900/30 px-4 py-1.5 rounded-full text-center shadow-sm">
                                📢 {msg.text}
                              </p>
                            </div>
                          );
                        }

                        // Look up sender details
                        const senderPlayer = room.players.find((p) => p.id === msg.senderId);
                        const avatarId = senderPlayer ? senderPlayer.avatarId : 5;
                        const avatar = AVATARS.find((a) => a.id === avatarId) || AVATARS[5];
                        const isBot = senderPlayer ? senderPlayer.isBot : false;

                        return (
                          <div 
                            key={msg.id} 
                            className={`flex items-start gap-2.5 max-w-[85%] shrink-0 ${
                              isMyMsg ? "mr-auto flex-row-reverse" : "ml-auto"
                            }`}
                          >
                            {/* Avatar */}
                            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatar.gradient} flex items-center justify-center text-sm shadow-md shrink-0 border border-white/10 select-none`}>
                              {avatar.emoji}
                            </div>

                            {/* Message Balloon */}
                            <div className="flex flex-col gap-0.5 animate-fade-in text-right">
                              {/* Sender Name & Time */}
                              <div className={`flex items-center gap-1.5 text-[9px] select-none ${isMyMsg ? "justify-end" : "justify-start"}`}>
                                <span className="font-extrabold text-stone-300">
                                  {msg.senderName}
                                  {isBot && <span className="text-[8px] text-blue-400 mr-1 bg-blue-950/50 border border-blue-900/20 px-1 py-0.2 rounded">AI</span>}
                                </span>
                                <span className="text-stone-500 font-medium">{msg.time}</span>
                              </div>

                              {/* Text Card */}
                              <div 
                                className={`px-3.5 py-2 rounded-2xl text-[11px] font-semibold leading-relaxed break-words text-right border ${
                                  isMyMsg 
                                    ? "bg-gradient-to-r from-[#95122C] to-red-950 text-white border-red-500/10 rounded-tr-none shadow-md shadow-[#95122C]/10" 
                                    : "bg-stone-900/60 border-white/5 text-stone-100 rounded-tl-none shadow-sm shadow-black/20"
                                }`}
                              >
                                <p>{msg.text}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Input area */}
                  {activeTab === "general" && !me.isAlive ? (
                    <div className="bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3 text-center text-[10px] text-red-300 font-bold shrink-0 shadow-inner select-none">
                      💀 أنت ميت، يمكنك مشاهدة الشات العام فقط، أما الكتابة فهي متاحة في شات الأموات.
                      <div className="text-[9px] text-stone-400 mt-1">You cannot send messages while dead.</div>
                    </div>
                  ) : (
                    <form onSubmit={sendChatMessage} className="flex gap-2.5 shrink-0 select-none">
                      <input
                        disabled={room.status === "night" || (me.isMuted && me.isAlive)}
                        type="text"
                        maxLength={100}
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        placeholder={
                          room.status === "night"
                            ? "الليل هادئ، لا يمكن الإرسال..."
                            : me.isMuted && me.isAlive
                            ? "أنت مسكت حالياً..."
                            : "اكتب رسالتك هنا..."
                        }
                        className="flex-1 bg-stone-950/60 border border-white/5 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-[#95122C]/60 focus:bg-stone-950 transition-all placeholder-stone-500 text-white text-right shadow-inner disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <motion.button 
                        type="submit"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={room.status === "night" || (me.isMuted && me.isAlive)}
                        className="bg-[#95122C] text-white px-5 py-3 rounded-xl font-bold hover:bg-[#b21635] transition-all shadow-md flex items-center justify-center cursor-pointer disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-[11px]"
                      >
                        إرسال
                      </motion.button>
                    </form>
                  )}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
