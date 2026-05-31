'use strict';

/**
 * LiteRT Chat Panel UI Controller
 * チャット画面のダウンロード・ボタン制御
 */

(function() {

  // ── Chat Panel State Update ────────────────────────────────────────────────

  async function updateChatUIState() {
    try {
      const modelMgr = window.litertModelMgr;
      if (!modelMgr) return;
      
      const isCached = await modelMgr.isCached();

      if (isCached) {
        updateChatUIForDownloaded();
      } else {
        updateChatUIForNotDownloaded();
      }
    } catch (error) {
      console.error('[ChatUI] State update error:', error);
    }
  }

  /**
   * チャット画面UI: ダウンロード済み状態に更新
   */
  function updateChatUIForDownloaded() {
    const chatDownloadBtn = document.getElementById('chat-download-btn');
    const chatActionButtons = document.getElementById('chat-action-buttons');
    const chatInitTitle = document.getElementById('chat-init-title');
    const chatInitDesc = document.getElementById('chat-init-desc');
    const chatInitSize = document.getElementById('chat-init-size');
    
    if (chatDownloadBtn) chatDownloadBtn.classList.add('hidden');
    if (chatActionButtons) chatActionButtons.classList.remove('hidden');
    if (chatInitTitle) chatInitTitle.textContent = 'チャット準備完了';
    if (chatInitDesc) chatInitDesc.textContent = 'チャット機能を使用可能です';
    if (chatInitSize) chatInitSize.textContent = 'モデルはキャッシュに保存されています';
  }

  /**
   * チャット画面UI: 未ダウンロード状態に更新
   */
  function updateChatUIForNotDownloaded() {
    const chatDownloadBtn = document.getElementById('chat-download-btn');
    const chatActionButtons = document.getElementById('chat-action-buttons');
    const chatInitTitle = document.getElementById('chat-init-title');
    const chatInitDesc = document.getElementById('chat-init-desc');
    const chatInitSize = document.getElementById('chat-init-size');
    
    if (chatDownloadBtn) chatDownloadBtn.classList.remove('hidden');
    if (chatActionButtons) chatActionButtons.classList.add('hidden');
    if (chatInitTitle) chatInitTitle.textContent = 'モデルをダウンロード';
    if (chatInitDesc) chatInitDesc.textContent = 'LiteRT Gemma 4 モデルをダウンロードしてチャット機能を使用できます';
    if (chatInitSize) chatInitSize.textContent = 'ファイルサイズ: 約 4GB';
  }

  // ── Initialize on page load ────────────────────────────────────────────────

  async function init() {
    try {
      const modelMgr = window.litertModelMgr;
      const chatMgr = window.litertChat;

      if (!modelMgr || !chatMgr) {
        console.error('[ChatUI] Manager not initialized');
        return;
      }

      // UI Elements
      const chatDownloadBtn = document.getElementById('chat-download-btn');
      const chatActionButtons = document.getElementById('chat-action-buttons');
      const chatOpenBtn = document.getElementById('chat-open-btn');
      const chatDeleteBtn = document.getElementById('chat-delete-btn');
      const chatInitScreen = document.getElementById('chat-init-screen');
      const chatMessages = document.getElementById('chat-messages');
      const chatInputWrapper = document.querySelector('.chat-input-wrapper');
      const chatStatusBadge = document.getElementById('chat-status');
      const chatPanel = document.getElementById('litert-chat-panel');

      // Download Handler
      if (modelMgr.onStateChange) {
        const prevHandler = modelMgr.onStateChange;
        modelMgr.onStateChange = ({ status, message }) => {
          if (prevHandler) prevHandler({ status, message });
          
          // チャットUI更新
          if (status === 'cached') {
            updateChatUIForDownloaded();
            if (chatStatusBadge) {
              chatStatusBadge.textContent = '準備完了';
              chatStatusBadge.className = 'chat-status-badge ready';
            }
          } else if (status === 'pending' || status === 'cancelled') {
            updateChatUIForNotDownloaded();
            if (chatStatusBadge) {
              chatStatusBadge.textContent = '未初期化';
              chatStatusBadge.className = 'chat-status-badge';
            }
          }
        };
      } else {
        modelMgr.onStateChange = ({ status, message }) => {
          if (status === 'cached') {
            updateChatUIForDownloaded();
            if (chatStatusBadge) {
              chatStatusBadge.textContent = '準備完了';
              chatStatusBadge.className = 'chat-status-badge ready';
            }
          } else if (status === 'pending' || status === 'cancelled') {
            updateChatUIForNotDownloaded();
            if (chatStatusBadge) {
              chatStatusBadge.textContent = '未初期化';
              chatStatusBadge.className = 'chat-status-badge';
            }
          }
        };
      }

      // Chat Panel Button Handlers
      chatDownloadBtn?.addEventListener('click', async () => {
        chatDownloadBtn.disabled = true;
        chatDownloadBtn.textContent = '📥 ダウンロード中...';
        
        const success = await modelMgr.downloadModel();

        chatDownloadBtn.disabled = false;
        if (!success) {
          chatDownloadBtn.textContent = '📥 ダウンロード開始';
        }
      });

      chatOpenBtn?.addEventListener('click', () => {
        if (chatInitScreen) {
          chatInitScreen.classList.add('hidden');
        }
        if (chatMessages) {
          chatMessages.style.display = 'flex';
        }
        if (chatInputWrapper) {
          chatInputWrapper.style.display = 'flex';
        }
        
        if (chatPanel && !chatPanel.classList.contains('open')) {
          chatPanel.classList.add('open');
        }

        if (!chatMgr.isReady && !chatMgr.isInitializing) {
          // プログレスバーをリセット
          const chatProgressFill = document.getElementById('chat-progress-fill');
          if (chatProgressFill) {
            chatProgressFill.style.width = '0%';
          }
          chatMgr.initialize();
        }
      });

      chatDeleteBtn?.addEventListener('click', async () => {
        if (!confirm('ダウンロード済みモデルを削除しますか？')) {
          return;
        }

        chatDeleteBtn.disabled = true;
        const success = await modelMgr.deleteCache();

        chatDeleteBtn.disabled = false;
        if (success) {
          await updateChatUIState();
        }
      });

      // Initialize model status
      await modelMgr.initDB();
      await updateChatUIState();
    } catch (error) {
      console.error('[ChatUI] Init error:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
