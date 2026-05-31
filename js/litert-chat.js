'use strict';

let systemPrompt = '';
async function loadSystemPrompt() {
  try {
    const res = await fetch('./system_prompt.txt');
  systemPrompt = await res.text();
  } catch (error) {
    console.warn('[LiteRT] System prompt load failed:', error);
    systemPrompt = 'You are a helpful football tactics assistant.';
  }
}

// Gemma 4 E2B モデルでエンジンを作成
// E2B: 効率重視 (推奨)
// E4B: 精度重視 (より大きい)
// MODEL_URL は litert-model-manager.js で定義済み
 
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./js/service-worker.js').catch(err => 
    console.warn('[SW] 登録失敗:', err)
  );
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
    this.isInitializing = false; // 初期化中フラグ
    this.isGenerating = false;
    this.onStreamChunk = null; // リアルタイム更新用コールバック
  }

  /**
   * 進捗を更新（プログレスバー + メッセージ）
   */
  updateProgress(percent, message) {
    const progressBar = document.getElementById('chat-progress');
    const progressFill = document.getElementById('chat-progress-fill');
    
    // プログレスバーを表示
    if (progressBar && percent > 0 && percent < 100) {
      progressBar.classList.add('active');
    }
    
    // プログレスバーを更新
    if (progressFill) {
      progressFill.style.width = percent + '%';
    }
    
    // 完了したらプログレスバーを隠す（500ms遅延）
    if (percent === 100) {
      setTimeout(() => {
        if (progressBar) {
          progressBar.classList.remove('active');
        }
        if (progressFill) {
          progressFill.style.width = '0%';
        }
      }, 500);
    }
    
    this.updateStatus(message, 'loading');
    console.log(`[LiteRT] ${percent}% - ${message}`);
  }

  /**
   * エンジン初期化
   */
  async initialize() {
    try {
      // ステップ 1: ライブラリ読み込み (0 → 15%)
      this.updateProgress(0, 'LiteRT ライブラリを読み込み中...');
      const { Engine } = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');
      this.updateProgress(15, 'LiteRT ライブラリ読み込み完了');

      // ステップ 2: モデルダウンロード/キャッシュ確認 (15 → 40%)
      this.updateProgress(25, 'モデルをダウンロード中...');
      
      // ステップ 3: エンジン初期化 (40 → 75%)
      this.updateProgress(40, 'エンジンを初期化中...');
      
      this.engine = await Engine.create({
        model: MODEL_URL,
        mainExecutorSettings: {
          maxNumTokens: 2048, // トークン削減で高速化
        },
        streaming: true, 
      });

      this.updateProgress(75, 'エンジン初期化完了。会話セッション準備中...');

      // ステップ 4: 会話セッション作成 (75 → 95%)
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

      this.updateProgress(95, 'ファイナライズ中...');

      // ステップ 5: 完了 (95 → 100%)
      this.isReady = true;
      this.updateProgress(100, '準備完了');
      this.updateStatus('準備完了', 'ready');
      console.log('[LiteRT] エンジン初期化完了');

      return true;
    } catch (error) {
      console.error('[LiteRT] 初期化失敗:', error);
      this.updateProgress(0, 'エラー: ' + error.message);
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
        .map(p => `${p.team}${p.number}: (${Math.round(p.x)},${Math.round(p.y)})`)
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
    // 未初期化なら初期化（遅延初期化）
    if (!this.isReady && !this.isInitializing) {
      this.isInitializing = true;
      await this.initialize();
      this.isInitializing = false;
    }

    if (!this.isReady || this.isGenerating || this.isInitializing) {
      console.warn('[LiteRT] エンジンが準備できていないか、生成中です');
      return null;
    }

    this.isGenerating = true;
    let fullResponse = '';

    try {
      // ストリーミングで応答を取得
      const stream = this.conversation.sendMessageStreaming({
        role: 'user',
        content: userMessage,
      });

      for await (const chunk of stream) {
        for (const item of chunk.content) {
          if (item.type === 'text') {
            fullResponse += item.text;
            // リアルタイム更新用コールバック
            if (this.onStreamChunk) {
              this.onStreamChunk(item.text);
            }
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
