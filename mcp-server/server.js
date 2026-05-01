import express from 'express';
import { WebSocketServer } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

const MCP_PORT = 3000;
const WS_PORT  = 3001;

// ── WebSocket bridge (browser ↔ MCP server) ───────────────────────────────
let browserSocket = null;
const pending = new Map(); // requestId → { resolve, reject, timer }

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', ws => {
  console.log('[WS] ブラウザが接続しました');
  browserSocket = ws;

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.requestId);
        if (msg.error) p.reject(new Error(msg.error));
        else           p.resolve(msg.data);
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    if (browserSocket === ws) browserSocket = null;
    console.log('[WS] ブラウザが切断しました');
  });

  ws.on('error', err => console.error('[WS] エラー:', err.message));
});

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== 1) {
      return reject(new Error(
        'ブラウザが接続されていません。作戦ボードをブラウザで開いてください。'
      ));
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('タイムアウト: ブラウザからの応答がありません'));
    }, 8000);
    pending.set(requestId, { resolve, reject, timer });
    browserSocket.send(JSON.stringify({ type, ...payload, requestId }));
  });
}

// ── MCP Server & Tools ────────────────────────────────────────────────────
const mcpServer = new McpServer({
  name:    'football-board',
  version: '1.0.0',
});

mcpServer.tool(
  'get_board_state',
  '現在の作戦ボードの状態（プレイヤー位置・ボール・フォーメーション・フィールド設定）を取得します',
  {},
  async () => {
    const data = await send('get_state');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

mcpServer.tool(
  'move_player',
  'プレイヤーをフィールド上の指定座標に移動します',
  {
    team:   z.enum(['A', 'B']).describe('チーム（A=赤・下半分, B=青・上半分）'),
    number: z.number().int().min(1).max(8).describe('プレイヤー番号（1〜8）'),
    x:      z.number().describe('X座標（メートル、フィールド幅内）'),
    y:      z.number().describe('Y座標（メートル、フィールド縦内）'),
  },
  async ({ team, number, x, y }) => {
    await send('move_player', { team, number, x, y });
    return { content: [{ type: 'text', text: `${team}${number}番を (${x}m, ${y}m) に移動しました` }] };
  }
);

mcpServer.tool(
  'move_ball',
  'ボールをフィールド上の指定座標に移動します',
  {
    x: z.number().describe('X座標（メートル）'),
    y: z.number().describe('Y座標（メートル）'),
  },
  async ({ x, y }) => {
    await send('move_ball', { x, y });
    return { content: [{ type: 'text', text: `ボールを (${x}m, ${y}m) に移動しました` }] };
  }
);

mcpServer.tool(
  'set_formation',
  'チームのフォーメーションを変更して選手を再配置します',
  {
    team:      z.enum(['A', 'B']).describe('チーム（A=赤・下半分, B=青・上半分）'),
    formation: z.enum(['3-3-1', '2-4-1', '2-3-2', '3-2-2']).describe('フォーメーション'),
  },
  async ({ team, formation }) => {
    await send('set_formation', { team, formation });
    return { content: [{ type: 'text', text: `チーム${team}のフォーメーションを ${formation} に設定・再配置しました` }] };
  }
);

mcpServer.tool(
  'save_frame',
  '現在の配置をアニメーションフレームとして保存します',
  {},
  async () => {
    const result = await send('save_frame');
    return { content: [{ type: 'text', text: `フレームを保存しました（合計 ${result.frameCount} フレーム）` }] };
  }
);

mcpServer.tool(
  'reset_ball',
  'ボールをフィールド中央（センターサークル）に戻します',
  {},
  async () => {
    await send('reset_ball');
    return { content: [{ type: 'text', text: 'ボールをフィールド中央に移動しました' }] };
  }
);

mcpServer.tool(
  'clear_drawings',
  'フィールド上に描いた作戦線をすべて消去します',
  {},
  async () => {
    await send('clear_drawings');
    return { content: [{ type: 'text', text: '描画線をすべて消去しました' }] };
  }
);

// ── Express HTTP server (MCP endpoint) ────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const sessions = new Map();

async function getOrCreateTransport(req) {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  transport.onclose = () => {
    sessions.delete(transport.sessionId);
    console.log(`[MCP] セッション終了: ${transport.sessionId}`);
  };
  await mcpServer.connect(transport);
  if (transport.sessionId) {
    sessions.set(transport.sessionId, transport);
    console.log(`[MCP] 新しいセッション: ${transport.sessionId}`);
  }
  return transport;
}

app.post('/mcp', async (req, res) => {
  try {
    const transport = await getOrCreateTransport(req);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP] POST エラー:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/mcp', async (req, res) => {
  const transport = sessions.get(req.headers['mcp-session-id']);
  if (!transport) return res.status(404).json({ error: 'Session not found' });
  try { await transport.handleRequest(req, res); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

app.delete('/mcp', async (req, res) => {
  const transport = sessions.get(req.headers['mcp-session-id']);
  if (!transport) return res.status(404).json({ error: 'Session not found' });
  try { await transport.handleRequest(req, res); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

app.get('/health', (_req, res) => {
  res.json({
    status:   'ok',
    browser:  browserSocket?.readyState === 1 ? 'connected' : 'disconnected',
    sessions: sessions.size,
  });
});

const httpServer = createServer(app);
httpServer.listen(MCP_PORT, () => {
  console.log('\n⚽ 作戦ボード MCP サーバー起動');
  console.log(`   MCP エンドポイント : http://localhost:${MCP_PORT}/mcp`);
  console.log(`   WebSocket (ブラウザ): ws://localhost:${WS_PORT}`);
  console.log(`   ヘルスチェック      : http://localhost:${MCP_PORT}/health`);
  console.log('\nClaude Desktop 設定例 (claude_desktop_config.json):');
  console.log(JSON.stringify({
    mcpServers: {
      'football-board': {
        type: 'http',
        url:  `http://localhost:${MCP_PORT}/mcp`,
      },
    },
  }, null, 2));
  console.log();
});
