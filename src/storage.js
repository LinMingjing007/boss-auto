(function () {
  'use strict';

  const { CONFIG_KEY, MESSAGE_RECORDS_KEY, MAX_IMAGE_SIZE_BYTES, MESSAGE_INTERVAL_MS } = window.BossAutoConstants;
  const imageSelectionTokens = new WeakMap();

  function createDefaultVersion(overrides = {}) {
    return {
      id: overrides.id || `version-${Date.now()}`,
      name: overrides.name || '默认配置',
      schemaVersion: 3,
      keywords: overrides.keywords || '',
      locations: overrides.locations || '',
      blockedWords: overrides.blockedWords || '',
      messageTemplate: overrides.messageTemplate || '',
      onlineStatusMode: overrides.onlineStatusMode || '不限',
      selectedOnlineStatuses: Array.isArray(overrides.selectedOnlineStatuses) ? overrides.selectedOnlineStatuses : [],
      unknownOnlineStatusPolicy: overrides.unknownOnlineStatusPolicy || 'skip',
      messageInterval: { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS },
      messageSequence: Array.isArray(overrides.messageSequence)
        ? overrides.messageSequence
        : (overrides.messageTemplate?.trim()
          ? [{ id: `msg-${Date.now()}`, type: 'text', content: overrides.messageTemplate }]
          : []),
    };
  }

  function normalizeVersion(version, index = 0) {
    return createDefaultVersion({
      ...version,
      id: version?.id || `version-${index + 1}`,
      name: version?.name || (index ? `配置 ${index + 1}` : '默认配置'),
    });
  }

  function loadConfigStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      if (Array.isArray(saved.versions) && saved.versions.length) {
        const versions = saved.versions.map(normalizeVersion);
        const activeVersionId = versions.some((version) => version.id === saved.activeVersionId)
          ? saved.activeVersionId : versions[0].id;
        return { schemaVersion: 3, activeVersionId, versions };
      }

      // 将旧版扁平配置迁移为单个“默认配置”版本。
      const legacy = normalizeVersion(saved, 0);
      return { schemaVersion: 3, activeVersionId: legacy.id, versions: [legacy] };
    } catch {
      const fallback = createDefaultVersion({ id: 'version-default', name: '默认配置' });
      return { schemaVersion: 3, activeVersionId: fallback.id, versions: [fallback] };
    }
  }

  function loadConfig() {
    const store = loadConfigStore();
    const active = store.versions.find((version) => version.id === store.activeVersionId) || store.versions[0];
    return { ...active, versionId: active.id, versionName: active.name };
  }

  function saveConfig(config) {
    const store = loadConfigStore();
    const activeVersionId = config.versionId || store.activeVersionId;
    const nextVersion = normalizeVersion({
      ...store.versions.find((version) => version.id === activeVersionId),
      ...config,
      id: activeVersionId,
      name: config.versionName || store.versions.find((version) => version.id === activeVersionId)?.name,
    });
    const versions = store.versions.map((version) => version.id === activeVersionId ? nextVersion : version);
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ schemaVersion: 3, activeVersionId, versions }));
  }

  function saveConfigStore(store) {
    const versions = (store.versions || []).map(normalizeVersion);
    if (!versions.length) throw new Error('至少需要保留一个配置版本');
    const activeVersionId = versions.some((version) => version.id === store.activeVersionId)
      ? store.activeVersionId : versions[0].id;
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ schemaVersion: 3, activeVersionId, versions }));
  }

  function setActiveVersion(versionId) {
    const store = loadConfigStore();
    if (!store.versions.some((version) => version.id === versionId)) {
      throw new Error('配置版本不存在');
    }
    saveConfigStore({ ...store, activeVersionId: versionId });
    return loadConfig();
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

  function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  window.BossAutoStorage = Object.freeze({
    loadConfig,
    loadConfigStore,
    saveConfig,
    saveConfigStore,
    setActiveVersion,
    handleImageFileSelection,
    getMessageRecordKey,
    hasMessageRecord,
    saveMessageRecord,
    splitTerms,
    randomDelay,
  });
})();
