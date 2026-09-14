(function () {
  'use strict';

  const { CONFIG_KEY, MESSAGE_RECORDS_KEY, MAX_IMAGE_SIZE_BYTES, MESSAGE_INTERVAL_MS } = window.BossAutoConstants;
  const imageSelectionTokens = new WeakMap();

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      const legacyTemplate = saved.messageTemplate || '';
      return {
        schemaVersion: saved.schemaVersion || 1,
        keywords: saved.keywords || '',
        locations: saved.locations || '',
        blockedWords: saved.blockedWords || '',
        messageTemplate: legacyTemplate,
        onlineStatusMode: saved.onlineStatusMode || '不限',
        selectedOnlineStatuses: Array.isArray(saved.selectedOnlineStatuses) ? saved.selectedOnlineStatuses : [],
        unknownOnlineStatusPolicy: saved.unknownOnlineStatusPolicy || 'skip',
        messageInterval: { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS },
        messageSequence: Array.isArray(saved.messageSequence)
          ? saved.messageSequence
          : (legacyTemplate.trim() ? [{ id: `msg-${Date.now()}`, type: 'text', content: legacyTemplate }] : []),
      };
    } catch {
      return {
        schemaVersion: 1,
        keywords: '', locations: '', blockedWords: '', messageTemplate: '',
        onlineStatusMode: '不限', selectedOnlineStatuses: [],
        unknownOnlineStatusPolicy: 'skip', messageSequence: [],
        messageInterval: { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS },
      };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function readImageDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        if (file.size <= MAX_IMAGE_SIZE_BYTES) {
          resolve(reader.result);
          return;
        }
        const image = new Image();
        image.onerror = () => reject(new Error('图片解码失败'));
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('当前浏览器不支持图片压缩'));
            return;
          }
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob || blob.size > MAX_IMAGE_SIZE_BYTES) {
              reject(new Error('图片压缩后仍超过 1MB，请选择更小的图片'));
              return;
            }
            const compressedReader = new FileReader();
            compressedReader.onerror = () => reject(new Error('压缩图片读取失败'));
            compressedReader.onload = () => resolve(compressedReader.result);
            compressedReader.readAsDataURL(blob);
          }, 'image/jpeg', 0.8);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleImageFileSelection(file, message, rerender) {
    if (!file) return;
    const isImage = file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name || '');
    if (!isImage) {
      window.BossAutoSetStatus('只能选择图片文件', 'error');
      return;
    }
    const token = Symbol('image-selection');
    imageSelectionTokens.set(message, token);
    message.name = file.name;
    message.content = '';
    rerender();
    readImageDataUrl(file)
      .then((dataUrl) => {
        if (imageSelectionTokens.get(message) !== token) return;
        message.content = dataUrl;
        rerender();
      })
      .catch((error) => {
        if (imageSelectionTokens.get(message) !== token) return;
        message.content = '';
        rerender();
        window.BossAutoSetStatus(`${file.name}：${error.message}`, 'error');
      });
  }

  function getMessageRecordKey(snapshot) {
    return snapshot.key || snapshot.id || 'unknown';
  }

  function hasMessageRecord(snapshot) {
    try {
      const records = JSON.parse(localStorage.getItem(MESSAGE_RECORDS_KEY) || '[]');
      if (!Array.isArray(records)) return false;
      const key = getMessageRecordKey(snapshot);
      return records.some((record) => (
        record === key
        || (typeof record === 'string' && record.startsWith(`${key}|`))
        || (record && typeof record === 'object' && record.key === key)
      ));
    } catch {
      return false;
    }
  }

  function saveMessageRecord(snapshot) {
    try {
      const records = JSON.parse(localStorage.getItem(MESSAGE_RECORDS_KEY) || '[]');
      const next = Array.isArray(records) ? records : [];
      const key = getMessageRecordKey(snapshot);
      if (!next.some((record) => record === key || (record && typeof record === 'object' && record.key === key))) {
        next.push({ key, message: snapshot.message, savedAt: Date.now() });
      }
      localStorage.setItem(MESSAGE_RECORDS_KEY, JSON.stringify(next.slice(-500)));
    } catch (error) {
      console.warn('[Boss Auto] message record unavailable:', error.message);
    }
  }

  function splitTerms(value) {
    return value.split('-').map((item) => item.trim()).filter(Boolean);
  }

  window.BossAutoStorage = Object.freeze({
    loadConfig,
    saveConfig,
    handleImageFileSelection,
    getMessageRecordKey,
    hasMessageRecord,
    saveMessageRecord,
    splitTerms,
  });
})();
