import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GameState, Player, GuessRecord, ChatMessage, SocketMessage } from './src/types.js';

// Setup basic configurations
const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Game State Storage
let gameState: GameState = {
  players: [],
  creatorId: null,
  isSecretSet: false,
  status: 'WAITING_FOR_PLAYERS',
  currentRound: 1,
  history: [],
  chats: []
};

// Hidden server-validated secret for the current round
let activeSecret: string = '';

// Map to associate WebSocket clients with their Player ID
const clientMap = new Map<WebSocket, string>();

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 10);

// Helper to compute 1A2B count
function calculateAB(secret: string, guess: string) {
  let aCount = 0;
  let bCount = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) {
      aCount++;
    } else if (secret.includes(guess[i])) {
      bCount++;
    }
  }
  return { aCount, bCount };
}

// Add a system chat message and crop chat logs to pre-emptively manage memory (max 100 entries)
function addSystemChat(text: string) {
  const systemMsg: ChatMessage = {
    id: `sys-${generateId()}`,
    playerName: '系統',
    text,
    timestamp: Date.now(),
    isSystem: true
  };
  gameState.chats.push(systemMsg);
  if (gameState.chats.length > 100) {
    gameState.chats.shift();
  }
}

// Broadcast updated game state to all connected clients
function broadcastState() {
  const clientsArray = Array.from(clientMap.keys());
  clientsArray.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const playerId = clientMap.get(client) || '';
      const message: SocketMessage = {
        type: 'STATE_UPDATE',
        state: gameState,
        yourId: playerId
      };
      client.send(JSON.stringify(message));
    }
  });
}

// Automatically manages round states, setting creator and determining game status
function evaluateGameStatus() {
  const activePlayers = gameState.players.filter(p => p.isOnline);
  
  if (activePlayers.length < 2) {
    gameState.status = 'WAITING_FOR_PLAYERS';
    gameState.creatorId = null;
    gameState.isSecretSet = false;
    activeSecret = '';
  } else {
    // If we were waiting for players and now have >= 2, transition
    if (gameState.status === 'WAITING_FOR_PLAYERS') {
      gameState.status = 'WAITING_FOR_SECRET';
      gameState.creatorId = activePlayers[0].id;
      gameState.isSecretSet = false;
      activeSecret = '';
      addSystemChat(`🎮 玩家人數已足夠，遊戲開始！第一輪由 [${activePlayers[0].name}] 出題。`);
    } else if (gameState.creatorId) {
      // Creator is set. Check if they are still connected.
      const currentCreator = activePlayers.find(p => p.id === gameState.creatorId);
      if (!currentCreator) {
        // Current creator left! Assign next available player.
        const nextCreator = activePlayers[0];
        gameState.creatorId = nextCreator.id;
        gameState.isSecretSet = false;
        activeSecret = '';
        gameState.history = [];
        gameState.status = 'WAITING_FOR_SECRET';
        addSystemChat(`⚠️ 出題者已斷線，原設定密碼失效。改由新出題者 [${nextCreator.name}] 重新出題！`);
      }
    }
  }
}

// Start WebSocket Server on the same HTTP server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws: WebSocket) => {
  const connectionId = `player-${generateId()}`;
  clientMap.set(ws, connectionId);

  // Send an initial handshake setup with connectionId so client knows their temporary id before joining
  ws.send(JSON.stringify({
    type: 'STATE_UPDATE',
    state: gameState,
    yourId: connectionId
  }));

  ws.on('message', (messageBuffer) => {
    try {
      const messageStr = messageBuffer.toString();
      const data: SocketMessage = JSON.parse(messageStr);

      switch (data.type) {
        case 'JOIN': {
          const playerName = (data.name || '神秘玩家').trim().substring(0, 15);
          
          // Check if this connection already joined, or create new player
          let p = gameState.players.find(player => player.id === connectionId);
          if (p) {
            p.name = playerName;
            p.isOnline = true;
          } else {
            p = {
              id: connectionId,
              name: playerName,
              score: 0,
              isOnline: true,
              joinedAt: Date.now()
            };
            gameState.players.push(p);
          }

          addSystemChat(`👤 玩家 [${playerName}] 進入了伺服器。`);
          evaluateGameStatus();
          broadcastState();
          break;
        }

        case 'SET_SECRET': {
          const secret = data.secret;
          // Security checks
          if (connectionId !== gameState.creatorId) {
            ws.send(JSON.stringify({ type: 'ERROR', message: '只有目前的出題者可以設定密碼！' }));
            return;
          }
          if (gameState.status !== 'WAITING_FOR_SECRET') {
            ws.send(JSON.stringify({ type: 'ERROR', message: '目前狀態不需要設定密碼。' }));
            return;
          }
          if (!/^\d{4}$/.test(secret) || new Set(secret).size !== 4) {
            ws.send(JSON.stringify({ type: 'ERROR', message: '密碼必須為 4 位不重複數字。' }));
            return;
          }

          activeSecret = secret;
          gameState.isSecretSet = true;
          gameState.status = 'GUESSING';
          gameState.history = []; // Clear guesswork for the new round

          const creatorName = gameState.players.find(p => p.id === connectionId)?.name || '出題者';
          addSystemChat(`🔒 [${creatorName}] 已設定好神祕密碼！大家可以開始猜測囉！`);
          broadcastState();
          break;
        }

        case 'GUESS': {
          const guessVal = data.guess;
          const player = gameState.players.find(p => p.id === connectionId);
          
          if (!player || !player.isOnline) {
            ws.send(JSON.stringify({ type: 'ERROR', message: '您尚未加入遊戲！' }));
            return;
          }
          if (connectionId === gameState.creatorId) {
            ws.send(JSON.stringify({ type: 'ERROR', message: '出題者不能猜測自己出的題目！' }));
            return;
          }
          if (gameState.status !== 'GUESSING') {
            ws.send(JSON.stringify({ type: 'ERROR', message: '目前不是可以猜測的階段。' }));
            return;
          }
          if (!/^\d{4}$/.test(guessVal) || new Set(guessVal).size !== 4) {
            ws.send(JSON.stringify({ type: 'ERROR', message: '猜測格式錯誤，必須為 4 位且不重複。' }));
            return;
          }

          // Calculate A and B
          const { aCount, bCount } = calculateAB(activeSecret, guessVal);

          const record: GuessRecord = {
            id: `guess-${generateId()}`,
            playerId: connectionId,
            playerName: player.name,
            guessStr: guessVal,
            aCount,
            bCount,
            timestamp: Date.now()
          };

          gameState.history.push(record);

          addSystemChat(`🔍 [${player.name}] 猜測 [${guessVal}] ➡️ ${aCount}A${bCount}B`);

          // Winners criteria
          if (aCount === 4) {
            // Player won!
            player.score += 1;
            gameState.status = 'ROUND_OVER';
            addSystemChat(`🏅 答對了！[${player.name}] 成功破解謎底 [${activeSecret}]！獲得 1 分！`);

            // Queue transition to the next round with a delay or do it instantly
            // To prevent client lagging, let's setup new round parameters immediately and notify:
            const activePlayers = gameState.players.filter(p => p.isOnline);
            const curIndex = activePlayers.findIndex(p => p.id === gameState.creatorId);
            const nextIndex = (curIndex + 1) % activePlayers.length;
            const newCreator = activePlayers[nextIndex];

            // Wait 4 seconds so players can admire the win, then auto start next round
            setTimeout(() => {
              // Ensure we still have >= 2 players before starting
              const freshActive = gameState.players.filter(p => p.isOnline);
              if (freshActive.length >= 2) {
                gameState.currentRound += 1;
                gameState.creatorId = newCreator.id;
                gameState.isSecretSet = false;
                activeSecret = '';
                gameState.history = [];
                gameState.status = 'WAITING_FOR_SECRET';
                addSystemChat(`📢 圓滿進入第 ${gameState.currentRound} 回合！請新出題者 [${newCreator.name}] 設定謎題數值。`);
              } else {
                gameState.status = 'WAITING_FOR_PLAYERS';
                gameState.creatorId = null;
                gameState.isSecretSet = false;
                activeSecret = '';
              }
              broadcastState();
            }, 4000);
          }

          broadcastState();
          break;
        }

        case 'CHAT': {
          const text = (data.text || '').trim().substring(0, 100);
          if (!text) return;

          const player = gameState.players.find(p => p.id === connectionId);
          const nameStr = player ? player.name : '遊客';

          const msg: ChatMessage = {
            id: `chat-${generateId()}`,
            playerName: nameStr,
            text,
            timestamp: Date.now()
          };

          gameState.chats.push(msg);
          if (gameState.chats.length > 100) {
            gameState.chats.shift();
          }

          broadcastState();
          break;
        }

        case 'RESTART_ROUND': {
          // Allows forced round resets if everyone is stuck (admin or general capability)
          const player = gameState.players.find(p => p.id === connectionId);
          const nameStr = player ? player.name : '有人';
          
          const activePlayers = gameState.players.filter(p => p.isOnline);
          if (activePlayers.length >= 2) {
            gameState.status = 'WAITING_FOR_SECRET';
            gameState.creatorId = activePlayers[0].id;
            gameState.isSecretSet = false;
            activeSecret = '';
            gameState.history = [];
            addSystemChat(`🔄 [${nameStr}] 重啟了目前回合。等待 [${activePlayers[0].name}] 重新出題。`);
          } else {
            gameState.status = 'WAITING_FOR_PLAYERS';
            gameState.creatorId = null;
            gameState.isSecretSet = false;
            activeSecret = '';
            gameState.history = [];
            addSystemChat(`🔄 [${nameStr}] 重置了狀態。目前仍在等待玩家加入。`);
          }
          broadcastState();
          break;
        }
      }
    } catch (e) {
      console.error('Error handling socket msg: ', e);
    }
  });

  ws.on('close', () => {
    const pId = clientMap.get(ws);
    clientMap.delete(ws);

    if (pId) {
      const pIndex = gameState.players.findIndex(p => p.id === pId);
      if (pIndex !== -1) {
        const leavingPlayer = gameState.players[pIndex];
        
        // Remove completely or flag offline
        // Let's remove them to avoid listing disconnected users indefinitely on live leaderboard
        gameState.players.splice(pIndex, 1);
        addSystemChat(`🚪 玩家 [${leavingPlayer.name}] 離開了遊戲。`);

        evaluateGameStatus();
        broadcastState();
      }
    }
  });
});

// Configure Vite dynamic middleware integration or static directory outputs
async function startApp() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AI Studio 1A2B server running on http://0.0.0.0:${PORT}`);
  });
}

startApp().catch((err) => {
  console.error('Failed to bootstrap server: ', err);
});
