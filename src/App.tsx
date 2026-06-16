import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  Send,
  Trophy,
  History,
  Lock,
  Unlock,
  RefreshCw,
  MessageSquare,
  HelpCircle,
  Eye,
  EyeOff,
  User,
  LogOut,
  AlertCircle,
  Sparkles,
  Share2
} from 'lucide-react';
import { GameState, SocketMessage } from './types.js';

export default function App() {
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('1a2b_username') || '';
  });
  const [joined, setJoined] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    creatorId: null,
    isSecretSet: false,
    status: 'WAITING_FOR_PLAYERS',
    currentRound: 1,
    history: [],
    chats: []
  });
  const [myPlayerId, setMyPlayerId] = useState<string>('');

  // Local inputs
  const [guessInput, setGuessInput] = useState<string>('');
  const [secretInput, setSecretInput] = useState<string>('');
  const [chatInput, setChatInput] = useState<string>('');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  
  // Rules popup open
  const [showRules, setShowRules] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to Websocket
  const connectWebSocket = () => {
    // Clean up previous connection to prevent ghost callbacks
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setSocketStatus('CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      if (socketRef.current !== ws) return;
      setSocketStatus('CONNECTED');
      setLocalError(null);
      const savedName = localStorage.getItem('1a2b_username');
      if (savedName && joined) {
        ws.send(JSON.stringify({ type: 'JOIN', name: savedName }));
      }
    };

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) return;
      try {
        const msg: SocketMessage = JSON.parse(event.data);
        if (msg.type === 'STATE_UPDATE') {
          setGameState(msg.state);
          if (msg.yourId) {
            setMyPlayerId(msg.yourId);
          }
        } else if (msg.type === 'ERROR') {
          setLocalError(msg.message);
          setTimeout(() => setLocalError(null), 4000);
        }
      } catch (err) {
        console.error('Error parsing socket event:', err);
      }
    };

    ws.onclose = () => {
      if (socketRef.current !== ws) return;
      setSocketStatus('DISCONNECTED');
      // Auto reconnect only if this is still the active socket ref
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 4000);
    };

    ws.onerror = (err) => {
      if (socketRef.current !== ws) return;
      console.error('Socket connection error:', err);
      setSocketStatus('DISCONNECTED');
    };
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Scrolling effects
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.chats]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.history]);

  // Keyboard input helper for 1A2B inputs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!joined) return;
      // If user is currently typing in chat input, bypass keyboard numbers
      if (document.activeElement?.tagName === 'INPUT' && document.activeElement !== document.getElementById('username-input')) {
        return;
      }

      const key = e.key;
      const isCreator = gameState.creatorId === myPlayerId;
      const isGuessing = gameState.status === 'GUESSING';
      const isSettingSecret = gameState.status === 'WAITING_FOR_SECRET';

      if (/^\d$/.test(key)) {
        if (isSettingSecret && isCreator) {
          appendDigit(key, 'secret');
        } else if (isGuessing && !isCreator) {
          appendDigit(key, 'guess');
        }
      } else if (key === 'Backspace') {
        if (isSettingSecret && isCreator) {
          popDigit('secret');
        } else if (isGuessing && !isCreator) {
          popDigit('guess');
        }
      } else if (key === 'Enter') {
        if (isSettingSecret && isCreator && secretInput.length === 4) {
          handleSetSecret();
        } else if (isGuessing && !isCreator && guessInput.length === 4) {
          handleSubmitGuess();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [joined, gameState.status, gameState.creatorId, myPlayerId, guessInput, secretInput]);

  // Join handler
  const handleJoinGame = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = username.trim();
    if (!cleanName) {
      setLocalError('請先輸入您的玩家暱稱！');
      return;
    }
    localStorage.setItem('1a2b_username', cleanName);
    setJoined(true);
    setLocalError(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'JOIN', name: cleanName }));
    } else {
      connectWebSocket();
    }
  };

  const sendMessage = (msg: SocketMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    } else {
      setLocalError('連線已中斷，正在重新連接中...');
    }
  };

  // Submit secret
  const handleSetSecret = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!/^\d{4}$/.test(secretInput)) {
      setLocalError('必須輸入恰好 4 位數字。');
      return;
    }
    if (new Set(secretInput).size !== 4) {
      setLocalError('輸入的 4 個數字不能重複。');
      return;
    }
    sendMessage({ type: 'SET_SECRET', secret: secretInput });
    setSecretInput('');
    setLocalError(null);
  };

  // Submit guess
  const handleSubmitGuess = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!/^\d{4}$/.test(guessInput)) {
      setLocalError('必須輸入恰好 4 位數字。');
      return;
    }
    if (new Set(guessInput).size !== 4) {
      setLocalError('輸入的 4 個數字不能重複。');
      return;
    }
    sendMessage({ type: 'GUESS', guess: guessInput });
    setGuessInput('');
    setLocalError(null);
  };

  // Keypad controls
  const appendDigit = (digit: string, inputType: 'guess' | 'secret') => {
    const val = inputType === 'guess' ? guessInput : secretInput;
    const setter = inputType === 'guess' ? setGuessInput : setSecretInput;
    
    if (val.length >= 4) return;
    if (val.includes(digit)) {
      setLocalError(`數字 [${digit}] 已經輸入過了，請選擇其他數字。`);
      return;
    }
    
    setter(val + digit);
    setLocalError(null);
  };

  const popDigit = (inputType: 'guess' | 'secret') => {
    const val = inputType === 'guess' ? guessInput : secretInput;
    const setter = inputType === 'guess' ? setGuessInput : setSecretInput;
    setter(val.slice(0, -1));
  };

  const clearDigits = (inputType: 'guess' | 'secret') => {
    const setter = inputType === 'guess' ? setGuessInput : setSecretInput;
    setter('');
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    sendMessage({ type: 'CHAT', text });
    setChatInput('');
  };

  const handleRestartRound = () => {
    if (window.confirm('確定要自選重置當前回合，引導重新出題嗎？')) {
      sendMessage({ type: 'RESTART_ROUND' });
      setGuessInput('');
      setSecretInput('');
    }
  };

  const handleLogout = () => {
    if (window.confirm('確定要離開本次遊戲大廳嗎？')) {
      localStorage.removeItem('1a2b_username');
      setJoined(false);
      window.location.reload();
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  // Selectors
  const me = useMemo(() => {
    return gameState.players.find(p => p.id === myPlayerId);
  }, [gameState.players, myPlayerId]);

  const activeCreator = useMemo(() => {
    if (!gameState.creatorId) return null;
    return gameState.players.find(p => p.id === gameState.creatorId);
  }, [gameState.players, gameState.creatorId]);

  const isMyTurnToCreate = gameState.creatorId === myPlayerId;

  // Render Login Panel
  if (!joined) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        {/* Subtle geometric background decor */}
        <div className="absolute inset-0 bg-[#0c0c0c] bg-[radial-gradient(#1f1f1f_1px,transparent_1px)] [background-size:16px_16px] opacity-60 pointer-events-none" />

        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl relative z-10">
          <div className="text-center mb-8">
            <span className="text-xs tracking-widest font-mono text-zinc-500 uppercase px-2.5 py-1 bg-zinc-800/40 rounded-full border border-zinc-700/30">
              SOCKET-SYNCHRONIZED GAME
            </span>
            <h1 className="text-3xl font-light tracking-tight mt-4 text-white">1A2B 多人連線對局</h1>
            <p className="text-sm text-neutral-400 mt-2">
              簡約、質感、黑白設計配色的線上互動密碼猜測遊戲
            </p>
          </div>

          <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800/50 mb-6 text-sm space-y-2 font-mono text-neutral-300">
            <span className="text-xs font-semibold text-white block">📖 玩法與連線指南：</span>
            <p className="text-xs leading-relaxed text-neutral-400">
              1. 本遊戲支援多個瀏覽器分頁同時連線，至少有兩人加入即可啟動。<br />
              2. 系統將指派一名玩家作為「出題者」，其餘玩家為「猜題者」。<br />
              3. 出題者要祕密設定 4 位不重複的數字，猜題者發送數字進行猜測。<br />
              4. 回應中的 <strong className="text-white font-bold">A</strong> 代表數字及位置正確，<strong className="text-white font-bold">B</strong> 代表數字正確但位置不對。
            </p>
          </div>

          {localError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-red-950/20 border border-red-900/30 text-red-400 p-3 rounded-lg text-xs font-mono mb-4 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{localError}</span>
            </motion.div>
          )}

          <form onSubmit={handleJoinGame} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-neutral-400 block tracking-wider uppercase">請設定玩家暱稱</label>
              <input
                id="username-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={15}
                placeholder="輸入您的暱稱 (例如: Player01)"
                className="w-full bg-[#121212] border border-neutral-800 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-white focus:ring-1 focus:ring-white placeholder:text-neutral-600 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={!username.trim()}
              className="w-full bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl py-3 transition duration-150 flex items-center justify-center gap-2 text-sm tracking-wide disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed cursor-pointer"
            >
              登入伺服器並加入連線
            </button>
          </form>

          <div className="text-center mt-6 text-xs text-neutral-600 font-mono">
            連線通訊埠: 3000 // WebSocket: 自動連結
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans flex flex-col">
      {/* Decorative background grid */}
      <div className="absolute inset-0 bg-[#0c0c0c] bg-[radial-gradient(#1c1c1c_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      {/* Minimalism Top Header */}
      <header className="bg-[#121212]/80 border-b border-neutral-900 backdrop-blur-md sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neutral-900 border border-neutral-800 rounded-lg">
              <Unlock className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">1A2B 多人連線對局</h1>
              <p className="text-xs text-neutral-500 font-mono">
                同步多人對抗・簡約質感黑白配
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
            {/* Round Counter */}
            <div className="bg-neutral-900/60 px-3.5 py-1.5 rounded-lg border border-neutral-850 text-neutral-300 flex items-center gap-2">
              <span className="text-neutral-500">回合：</span>
              <span className="text-white font-bold text-sm">{gameState.currentRound}</span>
            </div>

            {/* Connection Telemetry */}
            <div className="bg-neutral-900/60 px-3.5 py-1.5 rounded-lg border border-neutral-850 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${socketStatus === 'CONNECTED' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-neutral-300 text-[11px]">
                {socketStatus === 'CONNECTED' ? '連線同步中' : '連線已斷開'}
              </span>
            </div>

            <button
              onClick={() => setShowRules(true)}
              className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition text-neutral-300 cursor-pointer"
            >
              遊戲規則
            </button>

            <button
              onClick={handleRestartRound}
              className="p-1 px-2 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition text-neutral-300 cursor-pointer"
              title="重啟本輪"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={handleLogout}
              className="p-1 px-2 py-1.5 rounded-lg bg-neutral-900 hover:bg-red-950/40 hover:border-red-900/40 border border-neutral-800 transition text-red-400 cursor-pointer"
              title="離開大廳"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
        
        {/* LEFT COLUMN: THE SCOREBOARD (計分板) */}
        <section className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Active Profile Info */}
          <div className="bg-[#121212] border border-neutral-900 rounded-xl p-4 flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">YOUR ID / 您</span>
              <div className="text-sm font-semibold text-white mt-0.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-neutral-400" />
                {username}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">SCORE 得分</span>
              <div className="text-lg font-bold text-white leading-tight mt-0.5">{me ? me.score : 0}</div>
            </div>
          </div>

          {/* Connected players list */}
          <div className="bg-[#121212] border border-neutral-900 rounded-xl flex-1 flex flex-col shadow-lg min-h-[220px]">
            <div className="border-b border-neutral-900 px-4 py-3 flex items-center justify-between bg-neutral-950/40">
              <span className="text-xs font-mono font-semibold tracking-wider text-neutral-400 flex items-center gap-2">
                <Users className="w-4 h-4" />
                連線玩家名冊 ({gameState.players.length})
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <AnimatePresence initial={false}>
                {gameState.players.map((player) => {
                  const isCreator = player.id === gameState.creatorId;
                  const isSelf = player.id === myPlayerId;
                  return (
                    <motion.div
                      key={player.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-3 rounded-lg border flex flex-col gap-1 transition ${
                        isSelf 
                          ? 'bg-neutral-900 border-neutral-700' 
                          : 'bg-neutral-950/70 border-neutral-900'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className={`text-xs font-medium truncate ${isSelf ? 'text-white' : 'text-neutral-300'}`}>
                            {player.name}
                          </span>
                          {isSelf && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-neutral-800 text-neutral-300 rounded border border-neutral-700 text-center uppercase tracking-widest shrink-0 font-mono">
                              你
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded text-white ml-2 shrink-0">
                          {player.score} 分
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[10px] font-mono text-neutral-500 mt-1">
                        <span className="flex items-center gap-1">
                          {isCreator ? (
                            <span className="text-amber-500 flex items-center gap-1 text-[10px] uppercase font-bold">
                              <Lock className="w-3 h-3" /> 出題主機
                            </span>
                          ) : (
                            <span className="text-neutral-500 flex items-center gap-1 text-[10px] uppercase">
                              <Unlock className="w-3 h-3" /> 解密猜測中
                            </span>
                          )}
                        </span>
                        <span>{player.isOnline ? 'Active' : 'Offline'}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {gameState.players.length === 0 && (
                <div className="text-center py-8 text-neutral-600 text-xs font-mono">
                  無玩家上線資訊
                </div>
              )}
            </div>

            {/* Link Sharing Widget (我怎麼和朋友玩?) */}
            <div className="p-3 bg-neutral-950/60 border-t border-neutral-900 text-center font-mono space-y-2">
              <span className="text-[10px] text-neutral-400 block leading-normal">
                🔗 點選複製下方連結發給好友共同對局：
              </span>
              <button
                onClick={copyInviteLink}
                className="w-full text-[11px] bg-neutral-900 text-white hover:bg-neutral-800 transition border border-neutral-800 py-1.5 rounded flex items-center justify-center gap-1.5 cursor-pointer font-sans"
              >
                <Share2 className="w-3.5 h-3.5" />
                {copiedLink ? '✓ 已複製連線網址！' : '複製好友對決連結'}
              </button>
            </div>
          </div>

        </section>

        {/* CENTER COLUMN: DYNAMIC WORKSPACE (出題與猜題區) */}
        <section className="lg:col-span-5 flex flex-col gap-4">
          
          {localError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-950/30 border border-red-900/30 text-red-300 p-3.5 rounded-lg text-xs font-mono flex items-center gap-2 shadow-lg"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{localError}</span>
            </motion.div>
          )}

          {/* Core interactive panel */}
          <div className="bg-[#121212] border border-neutral-900 rounded-xl p-5 flex-1 flex flex-col shadow-lg">
            
            {/* Status Prompt Information and Banners */}
            <div className="border-b border-neutral-950 pb-4 mb-5">
              <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest block">
                遊戲進度提示 DYNAMIC_PROMPT
              </span>

              {gameState.status === 'WAITING_FOR_PLAYERS' ? (
                <div className="mt-3 bg-neutral-950 p-4 rounded-xl border border-neutral-900 text-center space-y-2.5">
                  <div className="inline-block p-2 bg-neutral-900 rounded-full border border-neutral-800">
                    <Users className="w-6 h-6 text-neutral-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">等待足夠人數加入...</h3>
                  <p className="text-xs text-neutral-400 leading-relaxed max-w-xs mx-auto">
                    本遊戲為多人對抗局，目前大廳人數小於 2 人，請複製好友對決連結，傳送給其他人點開即可在此加入。
                  </p>
                </div>
              ) : gameState.status === 'WAITING_FOR_SECRET' ? (
                <div className="mt-2.5 flex items-start gap-3">
                  <div className="p-2 bg-neutral-950 rounded-lg border border-neutral-900 mt-0.5 shrink-0">
                    <Lock className="w-4 h-4 text-neutral-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-mono text-neutral-400">目前階段：設定密碼</h3>
                    <p className="text-sm font-semibold text-white mt-1">
                      {isMyTurnToCreate ? (
                        <span className="text-white block">🔒 您目前是「出題主機」，請在下方框內輸入 4 位不重複的數字密碼：</span>
                      ) : (
                        <span className="text-neutral-400 block">⏳ 正在等待出題者【{activeCreator?.name || '神祕玩家'}】設定 4 位不重複數字...</span>
                      )}
                    </p>
                  </div>
                </div>
              ) : gameState.status === 'GUESSING' ? (
                <div className="mt-2.5 flex items-start gap-3">
                  <div className="p-2 bg-neutral-950 rounded-lg border border-neutral-900 mt-0.5 shrink-0">
                    <Unlock className="w-4 h-4 text-neutral-300 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-xs font-mono text-neutral-400">目前階段：解猜密碼中</h3>
                    <p className="text-sm font-semibold text-white mt-1">
                      {isMyTurnToCreate ? (
                        <span className="text-neutral-400 block">🕵️ 您已成功設定密碼！目前其餘解密小組玩家正在嘗試破解。</span>
                      ) : (
                        <span className="text-white block">🔥 密碼已上鎖！大家可以開始在此輸入「不重複4位數」發送猜測：</span>
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 bg-neutral-950/50 p-4 rounded-xl border border-neutral-900 text-center space-y-1.5">
                  <h3 className="text-sm font-bold text-white flex items-center justify-center gap-1.5 font-mono">
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    本輪解密完全成功！
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    4 秒後系統將自動輪到下一個玩家出題，轉移連線主控權...
                  </p>
                </div>
              )}
            </div>

            {/* Interaction Form Blocks */}
            <div className="flex-1 flex flex-col justify-center py-4">
              
              {/* STAGE: WAITING_FOR_SECRET */}
              {gameState.status === 'WAITING_FOR_SECRET' && (
                <div>
                  {isMyTurnToCreate ? (
                    <form onSubmit={handleSetSecret} className="space-y-6 max-w-sm mx-auto">
                      <div className="text-center">
                        <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest block mb-1">PROMPT</span>
                        <h4 className="text-sm font-bold text-white">請點選或鍵盤輸入四個不重複的數字</h4>
                      </div>

                      {/* Input Digits Block Panels */}
                      <div className="flex justify-center gap-2 mb-2">
                        {[0, 1, 2, 3].map((idx) => (
                          <div
                            key={idx}
                            className={`w-12 h-14 border rounded-xl flex items-center justify-center font-mono text-xl font-bold transition-all ${
                              secretInput[idx]
                                ? 'bg-white text-black border-white'
                                : 'bg-[#121212] border-neutral-800 text-transparent'
                            }`}
                          >
                            {secretInput[idx] ? (showSecret ? secretInput[idx] : '●') : ''}
                          </div>
                        ))}
                      </div>

                      {/* Password Visibility Control */}
                      <div className="flex justify-end p-1">
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5 cursor-pointer font-mono"
                        >
                          {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {showSecret ? '掩蓋數字' : '顯示秘密數字'}
                        </button>
                      </div>

                      {/* On Screen Digital Keypad */}
                      <div className="grid grid-cols-4 gap-2 max-w-xs mx-auto">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                          <button
                            key={digit}
                            type="button"
                            onClick={() => appendDigit(digit, 'secret')}
                            disabled={secretInput.includes(digit) || secretInput.length >= 4}
                            className="bg-neutral-900 hover:bg-white hover:text-black hover:border-white transition-all text-sm font-bold font-mono border border-neutral-800 p-2.5 rounded-lg disabled:opacity-30 disabled:hover:bg-neutral-900 disabled:hover:text-white disabled:hover:border-neutral-800 cursor-pointer"
                          >
                            {digit}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => popDigit('secret')}
                          className="bg-neutral-900 hover:bg-neutral-800 text-xs font-mono border border-neutral-800 p-2.5 rounded-lg cursor-pointer text-neutral-400"
                        >
                          退格
                        </button>
                        <button
                          type="button"
                          onClick={() => clearDigits('secret')}
                          className="bg-neutral-900 hover:bg-neutral-800 text-xs font-mono border border-neutral-800 p-2.5 rounded-lg cursor-pointer text-neutral-500"
                        >
                          重設
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={secretInput.length !== 4}
                        className="w-full bg-white text-black hover:bg-neutral-200 transition font-semibold rounded-xl py-2.5 tracking-wide text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-white"
                      >
                        🔒 設定完成，上鎖發送秘密
                      </button>
                    </form>
                  ) : (
                    <div className="text-center py-6 text-neutral-500 font-mono text-sm">
                      🔒 正在等待出題者處理，請稍候。
                    </div>
                  )}
                </div>
              )}

              {/* STAGE: GUESSING */}
              {gameState.status === 'GUESSING' && (
                <div>
                  {isMyTurnToCreate ? (
                    <div className="text-center py-8 space-y-4 max-w-xs mx-auto">
                      <div className="p-3 bg-neutral-950 rounded-full border border-neutral-900 inline-block animate-pulse">
                        <Lock className="w-8 h-8 text-neutral-500" />
                      </div>
                      <p className="text-xs text-neutral-400 leading-relaxed font-mono">
                        🕵️ 您的密碼已密封上鎖！不准向其他人透露喔。<br />
                        目前正在精算其餘解密小組的猜測。
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitGuess} className="space-y-6 max-w-sm mx-auto">
                      <div className="text-center">
                        <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest block mb-1">PROMPT</span>
                        <h4 className="text-sm font-bold text-white">請點選或按鍵盤輸入預測的 4 位數</h4>
                      </div>

                      {/* Display Slots */}
                      <div className="flex justify-center gap-2 mb-2">
                        {[0, 1, 2, 3].map((idx) => (
                          <div
                            key={idx}
                            className={`w-12 h-14 border rounded-xl flex items-center justify-center font-mono text-xl font-bold transition-all ${
                              guessInput[idx]
                                ? 'bg-white text-black border-white shadow-md'
                                : 'bg-[#121212] border-neutral-800 text-transparent'
                            }`}
                          >
                            {guessInput[idx] || ''}
                          </div>
                        ))}
                      </div>

                      {/* Virtual keypad */}
                      <div className="grid grid-cols-4 gap-2 max-w-xs mx-auto">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                          <button
                            key={digit}
                            type="button"
                            onClick={() => appendDigit(digit, 'guess')}
                            disabled={guessInput.includes(digit) || guessInput.length >= 4}
                            className="bg-neutral-900 hover:bg-white hover:text-black hover:border-white transition-all text-sm font-bold font-mono border border-neutral-800 p-2.5 rounded-lg disabled:opacity-30 disabled:hover:bg-neutral-900 disabled:hover:text-white disabled:hover:border-neutral-800 cursor-pointer"
                          >
                            {digit}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => popDigit('guess')}
                          className="bg-neutral-900 hover:bg-neutral-800 text-xs font-mono border border-neutral-800 p-2.5 rounded-lg cursor-pointer text-neutral-400"
                        >
                          退格
                        </button>
                        <button
                          type="button"
                          onClick={() => clearDigits('guess')}
                          className="bg-neutral-900 hover:bg-neutral-800 text-xs font-mono border border-neutral-800 p-2.5 rounded-lg cursor-pointer text-neutral-500"
                        >
                          重設
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={guessInput.length !== 4}
                        className="w-full bg-white text-black hover:bg-neutral-200 transition font-semibold rounded-xl py-2.5 tracking-wide text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-white"
                      >
                        🚀 送出我的解密猜測猜一猜
                      </button>
                    </form>
                  )}
                </div>
              )}

              {gameState.status === 'ROUND_OVER' && (
                <div className="text-center py-6 text-neutral-400 font-mono text-sm">
                  🎉 本回合已結束了，請等待系統重新分派轉入下一回合。
                </div>
              )}

              {gameState.status === 'WAITING_FOR_PLAYERS' && (
                <div className="text-center py-6 text-neutral-500 font-mono text-sm">
                  👥 正在等待其他連線夥伴加入...
                </div>
              )}

            </div>

            {/* Footer metadata element */}
            <div className="pt-3 border-t border-neutral-950 text-[10px] text-neutral-500 font-mono flex justify-between items-center shrink-0">
              <span>連線標準協定：JSON WebSocket</span>
              <span>LOBBY_PORT_3000</span>
            </div>

          </div>

        </section>

        {/* RIGHT COLUMN: GUESS HISTORY (歷史紀錄) & CHATROOM (交流聊天室) */}
        <section className="lg:col-span-4 flex flex-col gap-4">
          
          {/* A: GUESS HISTORY RECORD PANEL */}
          <div className="bg-[#121212] border border-neutral-900 rounded-xl flex-[3] flex flex-col shadow-lg min-h-[220px]">
            <div className="border-b border-neutral-950 px-4 py-2.5 flex items-center justify-between bg-neutral-950/40">
              <span className="text-xs font-mono font-semibold text-neutral-400 flex items-center gap-2">
                <History className="w-4 h-4" />
                解密歷史紀錄 ({gameState.history.length})
              </span>
              <span className="text-[10px] font-mono text-neutral-500">當前回合</span>
            </div>

            {/* Guess stream list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-[240px]">
              <AnimatePresence initial={false}>
                {gameState.history.map((record) => {
                  const isGoldWin = record.aCount === 4;
                  return (
                    <motion.div
                      key={record.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-2.5 rounded-lg border flex items-center justify-between font-mono text-xs transition ${
                        isGoldWin 
                          ? 'border-white bg-[#1e1e1e]' 
                          : 'border-neutral-900 bg-neutral-950/40'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden mr-1">
                        <span className="text-[9px] text-neutral-600 shrink-0">
                          {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="text-neutral-400 font-medium truncate max-w-[80px]">
                          {record.playerName}
                        </span>
                        <span className="bg-[#1e1e1e] border border-neutral-800 text-white font-bold px-2 py-0.5 rounded text-xs">
                          {record.guessStr}
                        </span>
                      </div>

                      {/* Display results */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${record.aCount > 0 ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-neutral-900 text-neutral-600'}`}>
                          {record.aCount}A
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${record.bCount > 0 ? 'bg-zinc-850 text-neutral-300' : 'bg-neutral-900 text-neutral-600'}`}>
                          {record.bCount}B
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {gameState.history.length === 0 && (
                <div className="text-center py-12 text-neutral-600 text-xs font-mono">
                  本回合尚無解密猜測紀錄。
                </div>
              )}
              <div ref={historyEndRef} />
            </div>
          </div>

          {/* B: LOBBY CHATROOM (聊天室) */}
          <div className="bg-[#121212] border border-neutral-900 rounded-xl flex-[4] flex flex-col shadow-lg min-h-[250px]">
            <div className="border-b border-neutral-950 px-4 py-2.5 flex items-center justify-between bg-neutral-950/40">
              <span className="text-xs font-mono font-semibold text-neutral-400 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                連線聊天室 COMMS
              </span>
              <span className="text-[10px] font-mono text-neutral-500 font-bold uppercase">Chat</span>
            </div>

            {/* Chats stream */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-[260px]">
              <AnimatePresence initial={false}>
                {gameState.chats.map((chat) => {
                  if (chat.isSystem) {
                    return (
                      <motion.div
                        key={chat.id}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="p-1.5 px-2.5 bg-neutral-950 text-neutral-400 border border-neutral-900 text-[11px] font-mono border-l-2 border-l-white flex flex-col"
                      >
                        <div className="text-[9px] text-neutral-600 self-end">
                          {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <span>{chat.text}</span>
                      </motion.div>
                    );
                  }

                  const isChatFromMe = chat.playerName === username;

                  return (
                    <motion.div
                      key={chat.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-xs font-mono"
                    >
                      <div className="flex justify-between items-baseline mb-0.5">
                        <span className={`font-bold text-[11px] ${isChatFromMe ? 'text-white' : 'text-neutral-400'}`}>
                          {chat.playerName}
                        </span>
                        <span className="text-[9px] text-neutral-600">
                          {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="bg-neutral-950 border border-neutral-900/60 rounded-lg px-2.5 py-1.5 text-neutral-300 break-words">
                        {chat.text}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>

            {/* Chat Sticky Form Input Block */}
            <form onSubmit={handleSendChat} className="p-2 border-t border-neutral-950 bg-neutral-950/60 flex gap-1.5 rounded-b-xl">
              <input
                id="chat-input-text"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                maxLength={80}
                placeholder="輸入語音通訊內容以供交流..."
                className="flex-1 bg-[#121212] border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white placeholder:text-neutral-700"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="bg-white hover:bg-neutral-200 cursor-pointer disabled:bg-neutral-800 disabled:text-neutral-600 text-black px-3.5 rounded-lg flex items-center justify-center transition"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

          </div>

        </section>

      </main>

      {/* FOOTER GENERAL LEGAL AND DEV BAR */}
      <footer className="bg-[#121212] border-t border-neutral-900 px-6 py-3 mt-6 text-[11px] font-mono text-neutral-600">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <div>© 1A2B 多人對局連線大廳 // 運行機制: WS Server</div>
          <div>本系統已採用極簡質感、極高對比之黑白深色架構設定</div>
        </div>
      </footer>

      {/* GAME RULES POPUP SHEET */}
      <AnimatePresence>
        {showRules && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 max-w-lg w-full p-6 p-4 rounded-xl shadow-2xl relative"
            >
              <h3 className="text-base font-bold text-white mb-3 tracking-wide">1A2B 猜數字 遊戲規則與計算說明</h3>
              
              <div className="text-sm text-neutral-300 space-y-3 font-sans leading-relaxed">
                <p>
                  1A2B（又稱 Bulls and Cows）是一個需要嚴密邏輯和推算機制的密碼破譯對決。
                </p>
                <p>
                  出題者會被隨機選出或由系統定序，為謎題核心輸入 <span className="text-white font-bold">4 個不重複的數字</span> (0-9)。例如：<strong className="text-white font-bold">5 1 3 4</strong>。
                </p>
                <p>
                  其餘所有玩家必須發送同樣由不重複 4 位數字組成的猜測。每次提交後系統會自動運算給出對應的 A 和 B 的提示資訊：
                </p>
                <ul className="list-disc list-inside bg-neutral-950 p-3 rounded-lg border border-neutral-800 space-y-1.5 text-xs font-mono text-neutral-400">
                  <li>💡 <strong>A 代表數量</strong>：猜測中數字正確，且<b>「位置恰好相符」</b>。</li>
                  <li>💡 <strong>B 代表數量</strong>：猜測中數字正確，但<b>「位置不同不相符」</b>。</li>
                </ul>
                <p className="border-l-2 border-white pl-2.5 text-xs text-neutral-400 italic">
                  舉例：如果正確密碼為 5134。當玩家發送「1538」，數字 3 的位置對了(1A)；而 1 和 5 這兩個數字密碼有但位置不對(2B)，故提示為「1A2B」。
                </p>
                <p>
                  最快精算並第一個猜得 4A0B 的解密特工即可獲得 1 分，大廳回合隨即重載進行下一場對局。
                </p>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowRules(false)}
                  className="bg-white hover:bg-neutral-200 text-black px-4 py-2 rounded-lg text-xs font-bold font-mono tracking-wider cursor-pointer transition border border-white"
                >
                  關閉說明 CLOSE_SHEETS
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
