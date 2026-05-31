'use strict';

/**
 * LiteRT Model Manager
 * IndexedDB を使用したモデルのダウンロード・キャッシュ管理
 */

const MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';
const DB_NAME = 'litert-model-cache';
const DB_VERSION = 1;
const STORE_NAME = 'models';

class LiteRTModelManager {
  constructor() {
    this.db = null;
    this.isDownloading = false;
    this.downloadAbortController = null;
    this.onStateChange = null;
    this.onProgress = null;
  }

  /**
   * IndexedDB 初期化
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * 状態変化を通知
   */
  _notifyStateChange(status, message) {
    console.log(`[ModelMgr:${status}] ${message}`);
    if (this.onStateChange) {
      this.onStateChange({ status, message });
    }
  }

  /**
   * モデルがキャッシュに存在するか確認
   */
  async isCached() {
    if (!this.db) await this.initDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('gemma4-e2b');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(!!request.result);
    });
  }

  /**
   * キャッシュサイズを取得（MB単位）
   */
  async getCachedSize() {
    if (!this.db) await this.initDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('gemma4-e2b');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result && request.result.data) {
          const sizeBytes = request.result.data.byteLength;
          const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
          resolve(parseFloat(sizeMB));
        } else {
          resolve(0);
        }
      };
    });
  }

  /**
   * モデルをダウンロードしてキャッシュに保存
   */
  async downloadModel() {
    if (this.isDownloading) {
      this._notifyStateChange('warning', 'ダウンロード中...');
      return false;
    }

    this.isDownloading = true;
    this.downloadAbortController = new AbortController();
    this._notifyStateChange('downloading', 'モデルをダウンロード中...');

    try {
      if (!this.db) await this.initDB();

      const response = await fetch(MODEL_URL, {
        signal: this.downloadAbortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        // 進捗通知
        const progress = contentLength > 0 ? (receivedLength / contentLength) * 100 : 0;
        if (this.onProgress) {
          this.onProgress({ progress, received: receivedLength, total: contentLength });
        }
      }

      const blob = new Blob(chunks);
      const arrayBuffer = await blob.arrayBuffer();

      // IndexedDB に保存
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put({
          id: 'gemma4-e2b',
          data: arrayBuffer,
          timestamp: Date.now(),
          url: MODEL_URL,
        });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      this.isDownloading = false;
      this.downloadAbortController = null;
      this._notifyStateChange('cached', '✅ ダウンロード完了');
      return true;

    } catch (error) {
      this.isDownloading = false;

      if (error.name === 'AbortError') {
        this._notifyStateChange('cancelled', '❌ ダウンロード中止');
      } else {
        const errMsg = error?.message || String(error);
        this._notifyStateChange('error', `ダウンロード失敗: ${errMsg}`);
        console.error('[ModelMgr] Download error:', error);
      }

      return false;
    }
  }

  /**
   * ダウンロードをキャンセル
   */
  cancelDownload() {
    if (this.downloadAbortController) {
      this.downloadAbortController.abort();
      this.isDownloading = false;
      this._notifyStateChange('cancelled', 'ダウンロードをキャンセルしました');
    }
  }

  /**
   * キャッシュを削除
   */
  async deleteCache() {
    if (!this.db) await this.initDB();

    this._notifyStateChange('deleting', 'キャッシュを削除中...');

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete('gemma4-e2b');

      request.onerror = () => {
        this._notifyStateChange('error', '削除に失敗しました');
        reject(request.error);
      };

      request.onsuccess = () => {
        this._notifyStateChange('deleted', '✅ キャッシュを削除しました');
        resolve(true);
      };
    });
  }

  /**
   * キャッシュからモデルを取得
   */
  async getModelFromCache() {
    if (!this.db) await this.initDB();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('gemma4-e2b');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.data) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
    });
  }
}

// グローバル インスタンス
window.litertModelMgr = new LiteRTModelManager();
