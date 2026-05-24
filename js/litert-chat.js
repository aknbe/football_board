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

// ── Service Worker 登録 ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(err => 
    console.warn('[SW] 登録失敗:', err)
  );
}

/**
 * LiteRT-LM チャット管理クラス
 * Gemma 4 モデルを使用したローカルAI推論
 * 状態管理・タイムアウト・リセット機能付き
 */
class LiteRTChatManager {
  constructor() {
    this.engine = null;
    this.conversation = null;
    this.isReady = false;
    this.isGenerating = false;
    this.isInitializing = false;
    this.onStreamChunk = null;           // リアルタイム更新用コールバック
    this.onStateChange = null;           // 状態変化通知用コールバック
    
    // タイムアウト・キャンセル関連
    this._generationAbortController = null;
    this._timeoutHandle = null;
    this._GENERATION_TIMEOUT = 60000;    // 生成タイムアウト: 60秒
    this._INIT_TIMEOUT = 300000;         // 初期化タイムアウト: 120秒
    
    // 状態ログ
    this._stateLog = [];
    this._MAX_LOG_SIZE = 50;
  }

  /**
   * 状態を通知（UI更新用）
   */
  _notifyStateChange(state, message) {
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    const logEntry = { timestamp, state, message };
    
    this._stateLog.push(logEntry);
    if (this._stateLog.length > this._MAX_LOG_SIZE) {
      this._stateLog.shift();
    }
    
    console.log(`[LiteRT:${state}] ${message} (${timestamp})`);
    
    if (this.onStateChange) {
      this.onStateChange({ state, message, timestamp });
    }
  }

  /**
   * エンジン初期化
   */
  async initialize() {
    if (this.isInitializing) {
      this._notifyStateChange('warning', '初期化処理中... 重複実行は無視されます');
      return false;
    }

    if (this.isReady) {
      this._notifyStateChange('info', 'エンジンは既に初期化済み');
      return true;
    }

    this.isInitializing = true;
    this._notifyStateChange('initializing', 'システム起動中...');

    let initTimeout;
    try {
      // タイムアウト設定
      initTimeout = setTimeout(() => {
        this._notifyStateChange('error', '初期化がタイムアウト（120秒以内に完了せず）');
        this.isInitializing = false;
        this._cleanup();
      }, this._INIT_TIMEOUT);

      // systemPrompt 読み込み
      this._notifyStateChange('loading', 'プロンプト読み込み中...');
      if (!systemPrompt) {
        await loadSystemPrompt();
      }

      // CDNから LiteRT-LM をインポート
      this._notifyStateChange('loading', 'LiteRT-LM ライブラリ読み込み中...');
      const { Engine } = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');

      // エンジン初期化
      this._notifyStateChange('loading', 'Gemma 4 E2B モデル読み込み中... (重い処理)');
      this.engine = await Engine.create({
        model: MODEL_URL,
        mainExecutorSettings: {
          maxNumTokens: 2048,
        },
        streaming: true,
      });

      // 会話セッション作成
      this._notifyStateChange('loading', '会話セッション初期化中...');
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

      clearTimeout(initTimeout);
      this.isReady = true;
      this.isInitializing = false;
      this._notifyStateChange('ready', '✅ 初期化完了 - AI が応答可能です');
      return true;

    } catch (error) {
      clearTimeout(initTimeout);
      this.isInitializing = false;
      const errMsg = error?.message || String(error);
      this._notifyStateChange('error', `初期化失敗: ${errMsg}`);
      console.error('[LiteRT] 初期化エラー詳細:', error);
      await this._cleanup();
      return false;
    }
  }

  /**
   * メッセージ送信（ストリーミング + タイムアウト）
   */
  async sendMessage(userMessage) {
    if (!this.isReady) {
      this._notifyStateChange('warning', 'エンジンが準備できていません。initialize() を先に呼んでください。');
      return null;
    }

    if (this.isGenerating) {
      this._notifyStateChange('warning', '既に生成中です。完了するか cancel() を呼んでください。');
      return null;
    }

    if (!userMessage || !userMessage.trim()) {
      this._notifyStateChange('warning', 'メッセージが空です');
      return null;
    }

    this.isGenerating = true;
    this._generationAbortController = new AbortController();
    let fullResponse = '';

    this._notifyStateChange('generating', `AI が考え中... (タイムアウト: ${this._GENERATION_TIMEOUT / 1000}秒)`);

    // タイムアウト設定
    this._timeoutHandle = setTimeout(() => {
      this._notifyStateChange('timeout', 'タイムアウト: 応答がありません');
      this.cancel();
    }, this._GENERATION_TIMEOUT);

    try {
      // ストリーミングで応答を取得
      const stream = this.conversation.sendMessageStreaming({
        role: 'user',
        content: userMessage,
      });

      for await (const chunk of stream) {
        // キャンセルが呼ばれた場合は中断
        if (this._generationAbortController.signal.aborted) {
          this._notifyStateChange('cancelled', 'ユーザーが生成をキャンセルしました');
          break;
        }

        for (const item of chunk.content) {
          if (item.type === 'text') {
            fullResponse += item.text;
            
            // リアルタイム更新
            if (this.onStreamChunk) {
              this.onStreamChunk(item.text);
            }
          }
        }
      }

      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
      this.isGenerating = false;
      this._notifyStateChange('ready', '✅ 応答完了');
      return fullResponse;

    } catch (error) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
      this.isGenerating = false;

      const errMsg = error?.message || String(error);
      this._notifyStateChange('error', `生成エラー: ${errMsg}`);
      console.error('[LiteRT] 生成エラー詳細:', error);
      return null;
    }
  }

  /**
   * 生成をキャンセル / 停止
   */
  cancel() {
    if (!this.isGenerating) {
      this._notifyStateChange('info', '生成中ではありません');
      return;
    }

    this._notifyStateChange('cancelling', '生成を停止中...');
    
    if (this._generationAbortController) {
      this._generationAbortController.abort();
      this._generationAbortController = null;
    }

    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }

    this.isGenerating = false;
    this._notifyStateChange('ready', '✅ 停止完了 - 再度送信可能');
  }

  /**
   * 完全リセット（エンジン削除 & 再初期化準備）
   */
  async reset() {
    this._notifyStateChange('resetting', 'システムをリセット中...');
    
    // 進行中の生成があれば中止
    if (this.isGenerating) {
      this.cancel();
    }

    await this._cleanup();
    
    // 再初期化可能な状態に
    this.isReady = false;
    this.isInitializing = false;
    this._notifyStateChange('ready', '✅ リセット完了 - initialize() で再起動可能');
  }

  /**
   * 内部クリーンアップ（プライベート）
   */
  async _cleanup() {
    try {
      if (this.engine) {
        await this.engine.delete();
        this.engine = null;
        this.conversation = null;
        console.log('[LiteRT] エンジン削除完了');
      }
    } catch (err) {
      console.warn('[LiteRT] クリーンアップ中にエラー:', err);
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
    const lines = text.split(/[\n。]/g).filter(l => l.trim());
    return lines.slice(0, 2).join('。\n');
  }

  /**
   * 状態ログを取得（デバッグ用）
   */
  getStateLog() {
    return [...this._stateLog];
  }

  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      isGenerating: this.isGenerating,
      generationTimeout: this._GENERATION_TIMEOUT,
      initTimeout: this._INIT_TIMEOUT,
      stateLog: this.getStateLog(),
    };
  }

  /**
   * タイムアウト時間を設定
   */
  setGenerationTimeout(ms) {
    if (typeof ms === 'number' && ms > 0) {
      this._GENERATION_TIMEOUT = ms;
      this._notifyStateChange('info', `生成タイムアウトを ${ms / 1000}秒 に設定`);
    }
  }

  /**
   * エンジン削除（外部呼び出し用）
   */
  async cleanup() {
    this._notifyStateChange('cleanup', 'エンジンをクリーンアップ中...');
    await this._cleanup();
    this.isReady = false;
    this._notifyStateChange('info', 'エンジン削除完了');
  }
}

// グローバル インスタンス
window.litertChat = new LiteRTChatManager();
