'use strict';

let systemPrompt = '';
async function loadSystemPrompt() {
  const res = await fetch('../system_prompt.txt');
  systemPrompt = await res.text();
}

// Gemma 4 E2B モデルでエンジンを作成
// E2B: 効率重視 (推奨)
// E4B: 精度重視 (より大きい)
const MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';
 
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js');
}

/**
 * LiteRT-LM チャット管理クラス
 * Gemma 4 モデルを使用したローカルAI推論
 */
class LiteRTChatManager {
  constructor() {
    this.engine = null;
    this.conversation = null;
    this.isReady = false;
    this.isGenerating = false;
    this.onStreamChunk = null; // リアルタイム更新用コールバック
  }

  /**
   * エンジン初期化
   */
  async initialize() {
    try {
      // CDNから LiteRT-LM をインポート
      const { Engine } = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');

      // ステータス更新
      this.updateStatus('モデル読み込み中...', 'loading');

      this.engine = await Engine.create({
        model: MODEL_URL,
        mainExecutorSettings: {
          maxNumTokens: 2048, // 軽量化のため制限
        },
        streaming: true, 
      });

      // 会話セッションを作成
      this.conversation = await this.engine.createConversation({
        preface: {
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
          ],
        },
      });

      this.isReady = true;
      this.updateStatus('準備完了', 'ready');
      console.log('[LiteRT] エンジン初期化完了');

      return true;
    } catch (error) {
      console.error('[LiteRT] 初期化失敗:', error);
      this.updateStatus('エラー', 'error');
      return false;
    }
  }

  /**
   * 戦術プロンプトを構築
   */
  buildTacticalPrompt(state, fieldDims) {
    const { fw, fl } = fieldDims;

    const formatTeam = (team) =>
      state.players
        .filter(p => p.team === team)
        .map(p => `${p.role}${p.number}: (${Math.round(p.x)},${Math.round(p.y)})`)
        .join(' | ');

    return `フィールド ${fw}m×${fl}m
【チームA(赤)】 ${state.formationA}: ${formatTeam('A')}
【チームB(青)】 ${state.formationB}: ${formatTeam('B')}
ボール: (${Math.round(state.ball.x)},${Math.round(state.ball.y)})

現在の配置について:
1. Aチーム、Bチームそれぞれの強み・弱点を指摘
2. 各チームの改善案を「A3→20,30 B2→15,45」形式で提案`;
  }

  /**
   * メッセージ送信（ストリーミング）
   */
  async sendMessage(userMessage) {
    if (!this.isReady || this.isGenerating) {
      console.warn('[LiteRT] エンジンが準備できていないか、生成中です');
      return null;
    }

    this.isGenerating = true;
    let fullResponse = '';

    try {
      // ストリーミングで応答を取得
      const stream = this.conversation.sendMessageStreaming(userMessage);

      for await (const chunk of stream) {
        let textChunk = '';
        if (typeof chunk === 'string') {
          textChunk = chunk;
        } else if (chunk && typeof chunk === 'object') {
          if (typeof chunk.text === 'string') {
            textChunk = chunk.text;
          } else if (typeof chunk.content === 'string') {
            textChunk = chunk.content;
          } else if (Array.isArray(chunk.content)) {
            for (const item of chunk.content) {
              if (item && item.type === 'text' && typeof item.text === 'string') {
                textChunk += item.text;
              } else if (typeof item === 'string') {
                textChunk += item;
              }
            }
          } else if (chunk.content && typeof chunk.content === 'object' && typeof chunk.content.text === 'string') {
            textChunk = chunk.content.text;
          }
        }

        if (textChunk) {
          fullResponse += textChunk;
          // リアルタイム更新用コールバック
          if (this.onStreamChunk) {
            this.onStreamChunk(textChunk);
          }
        }
      }

      this.isGenerating = false;
      return fullResponse;
    } catch (error) {
      console.error('[LiteRT] メッセージ送信エラー:', error);
      this.isGenerating = false;
      return null;
    }
  }

  /**
   * レスポンスから移動コマンドを抽出
   * 対応形式: "A1→20,30" "B2→15,45" など
   */
  extractMoveCommands(text) {
    const pattern = /([AB])(\d+)→(\d+),(\d+)/g;
    const moves = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      moves.push({
        team: match[1],
        number: parseInt(match[2]),
        x: parseInt(match[3]),
        y: parseInt(match[4]),
      });
    }

    return moves;
  }

  /**
   * レスポンスから戦術アドバイスを抽出
   */
  extractAdvice(text) {
    // 最初の2行までを取得
    const lines = text.split(/[\n。]/g).filter(l => l.trim());
    return lines.slice(0, 2).join('。\n');
  }

  /**
   * ステータス更新UI
   */
  updateStatus(message, status = 'info') {
    const badge = document.getElementById('chat-status');
    if (badge) {
      badge.textContent = message;
      badge.className = `chat-status-badge ${status}`;
    }
  }

  /**
   * エンジン削除（リソース解放）
   */
  async cleanup() {
    if (this.engine) {
      await this.engine.delete();
      this.engine = null;
      this.conversation = null;
      this.isReady = false;
      console.log('[LiteRT] エンジン削除完了');
    }
  }
}

// グローバル インスタンス
window.litertChat = new LiteRTChatManager();
