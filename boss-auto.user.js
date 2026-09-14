// ==UserScript==
// @name         boss-auto
// @namespace    https://github.com/LinMingjing007/boss-auto
// @homepageURL  https://github.com/LinMingjing007/boss-auto
// @source       https://atomgit.com/gcw_r7Og3ygT/boss-auto
// @downloadURL  https://raw.githubusercontent.com/LinMingjing007/boss-auto/main/boss-auto.user.js
// @updateURL    https://raw.githubusercontent.com/LinMingjing007/boss-auto/main/boss-auto.user.js
// @version      0.6.6
// @description  Boss 直聘职位筛选、在线状态判断及多轮聊天辅助
// @author       you
// @match        https://www.zhipin.com/web/geek/jobs*
// @match        https://www.zhipin.com/web/geek/chat*
// @include      https://www.zhipin.com/web/geek/jobs?_security_check=*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_PATH = '/web/geek/jobs';
  const SCRIPT_VERSION = '0.6.6';
  const CONFIG_KEY = 'boss-auto-config';
  const MESSAGE_RECORDS_KEY = 'boss-auto-message-records';
  const CHAT_PANEL_ID = 'boss-auto-chat-panel';
  const PANEL_ID = 'boss-auto-panel';
  const STATUS_ID = 'boss-auto-status';
  const STYLE_ID = 'boss-auto-style';
  const SETTINGS_VIEW_ID = 'boss-auto-settings-view';
  // 站点聊天组件会压缩大图；设置页也将压缩结果控制在 1MB 内，避免 Data URL 撑爆 localStorage。
  const MAX_IMAGE_SIZE_BYTES = 1024 * 1024;
  const MESSAGE_INTERVAL_MS = 30;
  const STATUS_OPTIONS = [
    { value: '不限', text: '不限' },
    { value: '在线', text: '在线' },
    { value: '刚刚活跃', text: '刚刚活跃' },
    { value: '今日活跃', text: '今日活跃' },
    { value: '3日内活跃', text: '3日内活跃' },
    { value: '本周活跃', text: '本周活跃' },
    { value: '本月活跃', text: '本月活跃' },
    { value: '半年前活跃', text: '半年前活跃' },
  ];
  let lastUrl = location.href;
  let hasRunForUrl = false;
  let paginationRunning = false;
  let deliveryRunning = false;
  let deliveryPaused = false;
  const jobRecords = [];
  let deliveryIndex = 0;
  let chatMonitorTimer = null;
  let chatMonitorObserver = null;
  let chatMonitorBodyObserver = null;
  let observedChatList = null;
  let chatMonitorDebounceTimer = null;
  let chatMonitorBusy = false;
  let chatMonitorRunId = 0;
  const chatCardSignatures = new Map();
  // 同一会话的列表节点可能连续触发多次 DOM 变化；用会话 key 做缓存，避免重复进入发送流程。
  const chatProcessingKeys = new Set();
  let settingsViewDirty = false;
  let onlineStatusFieldAvailable = null;
  const imageSelectionTokens = new WeakMap();

  /**
   * 判断当前页面是否为职位列表页。
   * @returns {boolean}
   */
  function isJobsPage() {
    return location.hostname === 'www.zhipin.com'
      && location.pathname === TARGET_PATH;
  }

  function isChatPage() {
    return location.hostname === 'www.zhipin.com'
      && location.pathname === '/web/geek/chat';
  }

  function setStatus(message, type = 'info') {
    const status = document.getElementById(STATUS_ID);
    if (!status) return;

    status.textContent = message;
    status.dataset.type = type;
  }

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
        selectedOnlineStatuses: Array.isArray(saved.selectedOnlineStatuses)
          ? saved.selectedOnlineStatuses : [],
        unknownOnlineStatusPolicy: saved.unknownOnlineStatusPolicy || 'skip',
        messageInterval: { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS },
        messageSequence: Array.isArray(saved.messageSequence)
          ? saved.messageSequence
          : (legacyTemplate.trim()
            ? [{ id: `msg-${Date.now()}`, type: 'text', content: legacyTemplate }]
            : []),
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
    const isImage = file.type.startsWith('image/')
      || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name || '');
    if (!isImage) {
      setStatus('只能选择图片文件', 'error');
      return;
    }

    const token = Symbol('image-selection');
    imageSelectionTokens.set(message, token);
    // 先显示文件名，让用户能确认选择事件已经生效；图片数据随后异步读取。
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
        setStatus(`${file.name}：${error.message}`, 'error');
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
        // 兼容 0.6.6 之前按“会话+消息”保存的缓存记录。
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
      if (!next.some((record) => (
        record === key || (record && typeof record === 'object' && record.key === key)
      ))) {
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

  function getConfig() {
    const form = document.getElementById(PANEL_ID);
    if (!form) return loadConfig();
    const saved = loadConfig();

    return {
      ...saved,
      keywords: form.querySelector('[name="keywords"]').value.trim(),
      locations: form.querySelector('[name="locations"]').value.trim(),
      blockedWords: form.querySelector('[name="blockedWords"]').value.trim(),
      messageTemplate: form.querySelector('[name="messageTemplate"]')?.value.trim() || '',
    };
  }

  function matchesAnyTerm(value, terms) {
    const text = String(value || '').toLowerCase();
    return terms.some((term) => text.includes(term.toLowerCase()));
  }

  function isJobAllowed(job, config) {
    const keywordTerms = splitTerms(config.keywords);
    const locationTerms = splitTerms(config.locations);
    const blockedTerms = splitTerms(config.blockedWords);
    const searchableText = [job.jobName, ...job.tags, job.company].join(' ');

    if (keywordTerms.length && !matchesAnyTerm(searchableText, keywordTerms)) return false;
    if (locationTerms.length && !matchesAnyTerm(job.location, locationTerms)) return false;
    if (blockedTerms.length && matchesAnyTerm(searchableText, blockedTerms)) return false;
    return true;
  }

  function addSettingsButton(container) {
    if (!container || container.querySelector('.boss-auto-open-settings')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'boss-auto-open-settings';
    button.textContent = '设置';
    button.addEventListener('click', openSettingsView);
    container.appendChild(button);
  }

  function openSettingsView() {
    if (!document.body) return;
    const existing = document.getElementById(SETTINGS_VIEW_ID);
    if (existing && existing.hidden && !settingsViewDirty) {
      existing.remove();
      document.getElementById(`${SETTINGS_VIEW_ID}-style`)?.remove();
    }
    if (!document.getElementById(SETTINGS_VIEW_ID)) createSettingsView();
    document.getElementById(SETTINGS_VIEW_ID).hidden = false;
  }

  function updateOnlineStatusCapability(available) {
    onlineStatusFieldAvailable = available;
    const view = document.getElementById(SETTINGS_VIEW_ID);
    if (!view) return;
    const note = view.querySelector('.boss-auto-status-capability');
    if (note) note.textContent = available ? '已检测到在线状态字段' : '当前页面不支持在线状态筛选';
    view.querySelectorAll('[name="selectedOnlineStatuses"]').forEach((input) => {
      input.disabled = !available;
      if (!available) input.checked = false;
    });
    if (!available) view.querySelector('[name="onlineStatusMode"]').checked = true;
  }

  function createSettingsView() {
    if (document.getElementById(SETTINGS_VIEW_ID)) return;

    const config = loadConfig();
    const style = document.createElement('style');
    style.id = `${SETTINGS_VIEW_ID}-style`;
    style.textContent = `
      #${SETTINGS_VIEW_ID} { position: fixed; inset: 0; z-index: 2147483645; overflow: auto; padding: 32px 20px; background: #f4faf7; color: #203e3b; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #${SETTINGS_VIEW_ID} .boss-auto-settings-card { max-width: 760px; margin: 0 auto; padding: 24px; background: #fff; border: 1px solid #dcece7; border-radius: 18px; box-shadow: 0 18px 60px rgba(19, 68, 57, .16); }
      #${SETTINGS_VIEW_ID} h2 { margin: 0; font-size: 20px; } #${SETTINGS_VIEW_ID} h3 { margin: 24px 0 10px; font-size: 15px; }
      #${SETTINGS_VIEW_ID} .boss-auto-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      #${SETTINGS_VIEW_ID} label { display: block; margin: 12px 0; } #${SETTINGS_VIEW_ID} label > span { display:block; margin-bottom: 5px; font-weight: 600; }
      #${SETTINGS_VIEW_ID} input[type="text"], #${SETTINGS_VIEW_ID} textarea { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #dce8e2; border-radius: 9px; background: #fafcfb; font: inherit; }
      #${SETTINGS_VIEW_ID} textarea { min-height: 72px; resize: vertical; }
      #${SETTINGS_VIEW_ID} .boss-auto-status-options { display: flex; flex-wrap: wrap; gap: 8px 14px; }
      #${SETTINGS_VIEW_ID} .boss-auto-status-options label { margin: 0; font-weight: 400; }
      #${SETTINGS_VIEW_ID} .boss-auto-message-row { display: grid; grid-template-columns: 92px 1fr auto auto; gap: 8px; align-items: start; margin: 10px 0; padding: 10px; background: #f7faf8; border-radius: 10px; }
      #${SETTINGS_VIEW_ID} .boss-auto-message-row select, #${SETTINGS_VIEW_ID} button { min-height: 36px; padding: 7px 11px; border: 1px solid #d5e5dd; border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
      #${SETTINGS_VIEW_ID} .boss-auto-image-picker { display: inline-flex; align-items: center; min-height: 36px; margin: 0; padding: 0 11px; color: #187a64; border: 1px solid #d5e5dd; border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
      #${SETTINGS_VIEW_ID} .boss-auto-image-picker input[type="file"] { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
      #${SETTINGS_VIEW_ID} .boss-auto-image-name { display: block; margin-top: 5px; color: #71857c; font-size: 12px; }
      #${SETTINGS_VIEW_ID} .boss-auto-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
      #${SETTINGS_VIEW_ID} .boss-auto-save-settings { color: #fff; background: #187a64; border-color: #187a64; }
      @media (max-width: 600px) { #${SETTINGS_VIEW_ID} { padding: 12px; } #${SETTINGS_VIEW_ID} .boss-auto-settings-card { padding: 16px; } #${SETTINGS_VIEW_ID} .boss-auto-message-row { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);

    const view = document.createElement('section');
    view.id = SETTINGS_VIEW_ID;
    view.hidden = true;
    view.setAttribute('aria-label', 'Boss Auto 设置');
    view.innerHTML = `
      <div class="boss-auto-settings-card">
        <div class="boss-auto-settings-head"><h2>Boss Auto 设置</h2><button type="button" class="boss-auto-close-settings">返回</button></div>
        <h3>职位筛选</h3>
        <label><span>职位关键词</span><input type="text" name="keywords" value="${escapeHtml(config.keywords)}"></label>
        <label><span>工作地点</span><input type="text" name="locations" value="${escapeHtml(config.locations)}"></label>
        <label><span>屏蔽词</span><input type="text" name="blockedWords" value="${escapeHtml(config.blockedWords)}"></label>
        <h3>招聘者在线状态</h3>
        <div class="boss-auto-status-options"><label><input type="radio" name="onlineStatusMode" value="不限" ${config.onlineStatusMode === '不限' ? 'checked' : ''}> 不限</label><span class="boss-auto-status-checkboxes"></span></div>
        <small class="boss-auto-status-capability">${onlineStatusFieldAvailable === false ? '当前页面不支持在线状态筛选' : '在线状态将在职位详情加载后确认'}</small>
        <label><span>未知状态</span><select name="unknownOnlineStatusPolicy"><option value="skip">跳过职位</option><option value="keep">允许继续</option></select></label>
        <h3>多轮聊天消息</h3>
        <small>按保存顺序发送；单张图片不超过 1MB。</small>
        <div class="boss-auto-message-list"></div>
        <button type="button" class="boss-auto-add-text">+ 添加文字</button>
        <button type="button" class="boss-auto-add-image">+ 添加图片</button>
        <div class="boss-auto-actions"><button type="button" class="boss-auto-close-settings">取消</button><button type="button" class="boss-auto-save-settings">保存设置</button></div>
      </div>
    `;
    document.body.appendChild(view);
    const markSettingsDirty = () => { settingsViewDirty = true; };
    view.querySelector('[name="unknownOnlineStatusPolicy"]').value = config.unknownOnlineStatusPolicy;

    const statusBox = view.querySelector('.boss-auto-status-checkboxes');
    STATUS_OPTIONS.filter((option) => option.value !== '不限').forEach((option) => {
      const label = document.createElement('label');
      const checked = config.onlineStatusMode !== '不限' && config.selectedOnlineStatuses.includes(option.value);
      label.innerHTML = `<input type="checkbox" name="selectedOnlineStatuses" value="${escapeHtml(option.value)}" ${checked ? 'checked' : ''}> ${escapeHtml(option.text)}`;
      statusBox.appendChild(label);
    });

    const messageList = view.querySelector('.boss-auto-message-list');
    const messages = Array.isArray(config.messageSequence) ? config.messageSequence : [];
    const renderMessages = () => {
      messageList.innerHTML = '';
      [...messages].forEach((message, index) => {
        const row = document.createElement('div');
        row.className = 'boss-auto-message-row';
        row.dataset.index = String(index);
        row.innerHTML = `<select class="message-type"><option value="text">文字</option><option value="image">图片</option></select><div class="message-content"></div><div><button type="button" class="move-message-up" aria-label="上移">↑</button><button type="button" class="move-message-down" aria-label="下移">↓</button></div><button type="button" class="remove-message">删除</button>`;
        row.querySelector('.message-type').value = message.type === 'image' ? 'image' : 'text';
        const content = row.querySelector('.message-content');
        if (message.type === 'image') {
          content.innerHTML = `<label class="boss-auto-image-picker">选择图片<input type="file" accept="image/*" class="message-image"></label><small class="boss-auto-image-name">${escapeHtml(message.name || '尚未选择图片')}</small>`;
          row.querySelector('.message-image').addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            markSettingsDirty();
            handleImageFileSelection(file, message, renderMessages);
          });
        } else {
          content.innerHTML = `<textarea class="message-text" placeholder="输入消息">${escapeHtml(message.content || '')}</textarea>`;
          content.querySelector('.message-text').addEventListener('input', (event) => { message.content = event.target.value; markSettingsDirty(); });
        }
        row.querySelector('.message-type').addEventListener('change', (event) => {
          markSettingsDirty();
          message.type = event.target.value;
          message.content = '';
          delete message.name;
          renderMessages();
        });
        row.querySelector('.remove-message').addEventListener('click', () => { markSettingsDirty(); messages.splice(index, 1); renderMessages(); });
        row.querySelector('.move-message-up').addEventListener('click', () => {
          if (index < 1) return;
          markSettingsDirty();
          [messages[index - 1], messages[index]] = [messages[index], messages[index - 1]];
          renderMessages();
        });
        row.querySelector('.move-message-down').addEventListener('click', () => {
          if (index >= messages.length - 1) return;
          markSettingsDirty();
          [messages[index], messages[index + 1]] = [messages[index + 1], messages[index]];
          renderMessages();
        });
        messageList.appendChild(row);
      });
    };
    renderMessages();
    view.querySelector('.boss-auto-add-text').addEventListener('click', () => { markSettingsDirty(); messages.push({ id: `msg-${Date.now()}`, type: 'text', content: '' }); renderMessages(); });
    view.querySelector('.boss-auto-add-image').addEventListener('click', () => { markSettingsDirty(); messages.push({ id: `msg-${Date.now()}`, type: 'image', content: '', name: '' }); renderMessages(); });
    view.querySelectorAll('.boss-auto-close-settings').forEach((button) => button.addEventListener('click', () => {
      if (settingsViewDirty && !window.confirm('设置尚未保存，确定放弃修改吗？')) return;
      settingsViewDirty = false;
      view.hidden = true;
    }));
    view.querySelector('[name="onlineStatusMode"]').addEventListener('change', (event) => {
      if (event.target.checked) view.querySelectorAll('[name="selectedOnlineStatuses"]').forEach((item) => { item.checked = false; });
      markSettingsDirty();
    });
    view.querySelectorAll('[name="selectedOnlineStatuses"]').forEach((item) => item.addEventListener('change', () => {
      if (item.checked) view.querySelector('[name="onlineStatusMode"]').checked = false;
      markSettingsDirty();
    }));
    view.querySelectorAll('input[type="text"], select, textarea').forEach((input) => input.addEventListener('change', markSettingsDirty));
    view.querySelector('.boss-auto-save-settings').addEventListener('click', () => {
      const unlimited = view.querySelector('[name="onlineStatusMode"]').checked;
      const selected = [...view.querySelectorAll('[name="selectedOnlineStatuses"]:checked')].map((item) => item.value);
      if (!unlimited && !selected.length) { setStatus('请至少选择一个在线状态，或选择“不限”', 'error'); return; }
      if (!unlimited && onlineStatusFieldAvailable === false) { setStatus('当前页面没有在线状态字段，只能选择“不限”', 'error'); return; }
      const invalidMessage = messages.find((message) => !message.content || (message.type === 'text' && !message.content.trim()));
      if (invalidMessage) { setStatus('请补全所有文字消息或图片消息', 'error'); return; }
      const next = {
        ...loadConfig(),
        schemaVersion: 2,
        keywords: view.querySelector('[name="keywords"]').value.trim(),
        locations: view.querySelector('[name="locations"]').value.trim(),
        blockedWords: view.querySelector('[name="blockedWords"]').value.trim(),
        onlineStatusMode: unlimited ? '不限' : '状态筛选',
        selectedOnlineStatuses: unlimited ? [] : selected,
        unknownOnlineStatusPolicy: view.querySelector('[name="unknownOnlineStatusPolicy"]').value,
        messageSequence: messages,
        messageInterval: { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS },
      };
      try {
        saveConfig(next);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
      } catch (error) {
        setStatus(`设置保存失败：${error.message}`, 'error');
        return;
      }
      settingsViewDirty = false;
      view.hidden = true;
      setStatus('设置已保存', 'success');
    });
  }

  function createSettingsPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      addSettingsButton(existing.querySelector('.boss-auto-panel-body'));
      return;
    }

    const config = loadConfig();
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Boss Auto 职位偏好设置');
    panel.innerHTML = `
      <div class="boss-auto-panel-header">
        <div class="boss-auto-brand">
          <div class="boss-auto-logo" aria-hidden="true">B<span>·</span></div>
          <div>
          <div class="boss-auto-title">Boss Auto</div>
          <div class="boss-auto-subtitle">你的求职小助手</div>
          </div>
        </div>
        <button type="button" class="boss-auto-collapse" aria-label="收起面板" aria-expanded="true" aria-controls="boss-auto-fields">−</button>
      </div>
      <div class="boss-auto-panel-body" id="boss-auto-fields">
        <div class="boss-auto-intro"><span>职位偏好</span><small>仅配置</small></div>
        <p class="boss-auto-description">记下你的期待，让下一份工作更合心意。</p>
        <label>
          <span>职位关键词</span>
          <input name="keywords" value="${escapeHtml(config.keywords)}" placeholder="例如：前端-React-Node.js">
        </label>
        <label>
          <span>工作地包含</span>
          <input name="locations" value="${escapeHtml(config.locations)}" placeholder="例如：上海-杭州-远程">
        </label>
        <label>
          <span>屏蔽词</span>
          <input name="blockedWords" value="${escapeHtml(config.blockedWords)}" placeholder="例如：销售-客服-外包">
        </label>
        <div class="boss-auto-hint">多个条件用 <b>-</b> 分隔 · 留空表示不限</div>
        <button type="button" class="boss-auto-start">开始投递</button>
        <div class="boss-auto-footer">保存在当前浏览器 · 自动化尚未启用</div>
      </div>
    `;
    document.body.appendChild(panel);
    addSettingsButton(panel.querySelector('.boss-auto-panel-body'));

    const header = panel.querySelector('.boss-auto-panel-header');
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;

      const rect = panel.getBoundingClientRect();
      dragging = true;
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      header.setPointerCapture(event.pointerId);
      header.classList.add('dragging');
    });

    header.addEventListener('pointermove', (event) => {
      if (!dragging) return;

      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${Math.min(Math.max(0, event.clientX - dragOffsetX), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(0, event.clientY - dragOffsetY), maxTop)}px`;
    });

    const stopDragging = () => {
      dragging = false;
      header.classList.remove('dragging');
    };
    header.addEventListener('pointerup', stopDragging);
    header.addEventListener('pointercancel', stopDragging);

    panel.querySelector('.boss-auto-start').addEventListener('click', () => {
      const button = panel.querySelector('.boss-auto-start');
      if (paginationRunning || deliveryRunning || deliveryPaused) {
        deliveryPaused = !deliveryPaused;
        button.textContent = deliveryPaused ? '继续投递' : '暂停投递';
        setStatus(deliveryPaused ? '投递已暂停，当前步骤完成后等待继续' : '投递已继续');
        return;
      }
      startDelivery();
    });

    panel.querySelector('.boss-auto-collapse').addEventListener('click', (event) => {
      const collapsed = panel.classList.toggle('collapsed');
      event.currentTarget.textContent = collapsed ? '+' : '−';
      event.currentTarget.setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  function createChatPanel() {
    const existing = document.getElementById(CHAT_PANEL_ID);
    if (existing) {
      addSettingsButton(existing);
      return;
    }

    const style = document.createElement('style');
    style.id = `${CHAT_PANEL_ID}-style`;
    style.textContent = `
      #${CHAT_PANEL_ID} {
        position: fixed; right: 20px; bottom: 84px; z-index: 2147483646;
        width: 360px; min-width: 280px; min-height: 220px; max-width: calc(100vw - 24px);
        max-height: calc(100vh - 108px); overflow: auto; resize: both;
        padding: 16px; color: #203e3b; background: #fff;
        border: 1px solid #dcece7; border-radius: 16px;
        box-shadow: 0 12px 40px rgba(19, 68, 57, .18);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${CHAT_PANEL_ID} .chat-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -4px -4px 8px; padding: 4px; cursor: grab; user-select: none; }
      #${CHAT_PANEL_ID} .chat-panel-header.dragging { cursor: grabbing; }
      #${CHAT_PANEL_ID} .chat-panel-header > div { display: flex; align-items: center; gap: 6px; }
      #${CHAT_PANEL_ID} .chat-panel-header .chat-collapse { width: 28px; height: 28px; min-width: 28px; margin: 0; padding: 0; color: #426e62; background: #f6f9f7; border: 1px solid #e1e8e3; border-radius: 8px; line-height: 24px; }
      #${CHAT_PANEL_ID}.collapsed { width: 190px; min-width: 190px; min-height: 0; resize: none; overflow: hidden; }
      #${CHAT_PANEL_ID}.collapsed > :not(.chat-panel-header) { display: none; }
      #${CHAT_PANEL_ID} h3 { margin: 0; font-size: 15px; }
      #${CHAT_PANEL_ID} p { margin: 0 0 12px; color: #71857c; font-size: 11px; }
      #${CHAT_PANEL_ID} .chat-message-list { display: grid; gap: 8px; max-height: 270px; overflow: auto; }
      #${CHAT_PANEL_ID} .chat-config-summary { margin: 10px 0; padding: 10px; color: #4e6c5c; background: #f8faf9; border: 1px solid #e1eae5; border-radius: 10px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6; }
      #${CHAT_PANEL_ID} .chat-message-row { display: grid; grid-template-columns: 24px 1fr auto; gap: 6px; align-items: start; }
      #${CHAT_PANEL_ID} .chat-message-number { padding-top: 10px; color: #71857c; text-align: center; font-size: 11px; }
      #${CHAT_PANEL_ID} .chat-message-editor { display: grid; gap: 6px; }
      #${CHAT_PANEL_ID} .chat-message-type { width: 76px; min-height: 28px; padding: 4px 6px; color: #4e6c5c; background: #fff; border: 1px solid #e1e8e3; border-radius: 7px; font: inherit; }
      #${CHAT_PANEL_ID} textarea {
        display: block; width: 100%; min-height: 64px; resize: vertical;
        padding: 10px; color: #243e34; background: #f8faf9;
        border: 1px solid #e1eae5; border-radius: 10px; outline: none;
        font: inherit;
      }
      #${CHAT_PANEL_ID} textarea:focus { border-color: #21846a; background: #fff; }
      #${CHAT_PANEL_ID} .chat-message-image { padding: 10px; color: #71857c; background: #f8faf9; border: 1px solid #e1eae5; border-radius: 10px; font-size: 11px; }
      #${CHAT_PANEL_ID} button {
        width: 100%; height: 36px; margin-top: 9px; border: 0;
        border-radius: 9px; cursor: pointer; font: inherit; font-weight: 600;
      }
      #${CHAT_PANEL_ID} .add-message { color: #4e6c5c; background: #f6f9f7; border: 1px solid #e1e8e3; }
      #${CHAT_PANEL_ID} .start-chat { color: #fff; background: #187a64; }
      #${CHAT_PANEL_ID} button:hover { filter: brightness(.97); }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = CHAT_PANEL_ID;
    panel.innerHTML = `
      <div class="chat-panel-header"><h3>聊天监听</h3><div><button type="button" class="chat-collapse" title="收起悬浮窗" aria-label="收起悬浮窗" aria-expanded="true">−</button></div></div>
      <p>模板、图片和在线状态统一在“设置”页面修改；消息间隔固定为 30 毫秒。</p>
      <div class="chat-config-summary"></div>
      <button type="button" class="start-chat">开始沟通</button>
    `;
    document.body.appendChild(panel);
    addSettingsButton(panel);

    const header = panel.querySelector('.chat-panel-header');
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    header.addEventListener('pointerdown', (event) => {
      const rect = panel.getBoundingClientRect();
      dragging = true;
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      header.setPointerCapture(event.pointerId);
      header.classList.add('dragging');
    });
    header.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${Math.min(Math.max(0, event.clientX - dragOffsetX), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(0, event.clientY - dragOffsetY), maxTop)}px`;
    });
    const stopDragging = () => {
      dragging = false;
      header.classList.remove('dragging');
    };
    header.addEventListener('pointerup', stopDragging);
    header.addEventListener('pointercancel', stopDragging);
    const collapseButton = header.querySelector('.chat-collapse');
    collapseButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    collapseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const collapsed = panel.classList.toggle('collapsed');
      event.currentTarget.textContent = collapsed ? '+' : '−';
      event.currentTarget.title = collapsed ? '展开悬浮窗' : '收起悬浮窗';
      event.currentTarget.setAttribute('aria-label', collapsed ? '展开悬浮窗' : '收起悬浮窗');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    });

    const summary = panel.querySelector('.chat-config-summary');
    const refreshSummary = () => {
      const current = loadConfig();
      const configuredMessages = (current.messageSequence || []).filter((message) => (
        message?.type === 'image' ? message.content : (message?.content || '').trim()
      ));
      if (!configuredMessages.length) {
        summary.textContent = '尚未配置消息模板，请先打开设置页面';
        return;
      }
      const messagePreview = configuredMessages.map((message, index) => {
        const content = message.type === 'image'
          ? `图片：${message.name || '未命名图片'}`
          : `文字：${message.content.trim()}`;
        return `第 ${index + 1} 条 ${content}`;
      }).join('\n');
      summary.textContent = `${messagePreview}\n消息间隔：${MESSAGE_INTERVAL_MS} 毫秒`;
    };
    refreshSummary();
    window.addEventListener('boss-auto-config-changed', refreshSummary);
    panel.querySelector('.start-chat').addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (chatMonitorTimer) {
        stopChatMonitor();
        button.textContent = '开始沟通';
        button.disabled = false;
        button.dataset.monitoring = 'false';
        setStatus('已取消聊天监听');
        return;
      }
      const messages = loadConfig().messageSequence?.filter((message) => (
        message?.type === 'image' ? message.content : (message?.content || '').trim()
      )) || [];
      if (!messages.length) {
        setStatus('请先在设置页面配置消息模板', 'error');
        return;
      }
      button.textContent = '取消监听';
      button.disabled = false;
      button.dataset.monitoring = 'true';
      startChatMonitor();
    });
  }

  function findChatInput() {
    return document.querySelector('.chat-input textarea, textarea[placeholder*="输入"], [contenteditable="true"]:not(.boss-search-input)');
  }

  function isSendButtonEnabled(element) {
    return Boolean(element)
      && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true'
      && !element.classList.contains('disabled')
      && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden';
  }

  function findSendButton(input = null) {
    const root = input?.closest('.chat-container') || document;
    return [...root.querySelectorAll('button, a, [role="button"]')].find((element) => {
      const text = element.textContent.trim();
      return /^发送$/.test(text) && isSendButtonEnabled(element);
    });
  }

  function fillChatInput(input, message) {
    input.focus();
    if (input.matches('[contenteditable="true"]')) {
      input.textContent = message;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, message);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async function sendTemplateMessage(message) {
    const text = message.trim();
    if (!text) {
      setStatus('请先填写消息模板', 'error');
      return false;
    }

    const input = findChatInput();
    if (!input) {
      setStatus('请先选择一个联系人，或当前会话暂不可发送', 'error');
      return false;
    }

    fillChatInput(input, text);
    const sendButton = await waitForSendButton(input);
    if (!sendButton) {
      setStatus('当前会话发送按钮不可用', 'error');
      return false;
    }
    sendButton.click();
    setStatus('模板消息已发送', 'success');
    return true;
  }

  function findImageUploadInput() {
    const chatInput = document.querySelector('.btn-sendimg input[type="file"]');
    if (chatInput) return chatInput;
    return [...document.querySelectorAll('input[type="file"]')].find((input) => {
      const marker = `${input.getAttribute('ka') || ''} ${input.className || ''}`;
      return !/resume|简历/i.test(marker) && /image/i.test(input.getAttribute('accept') || '');
    });
  }

  function getVisibleImageMessageCount() {
    return document.querySelectorAll('.chat-record .item-image .message-image-content img').length;
  }

  function waitForVisibleImageMessage(previousCount, timeout = 15000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const currentCount = getVisibleImageMessageCount();
        if (currentCount > previousCount) {
          const images = [...document.querySelectorAll('.chat-record .item-image .message-image-content img')];
          const newImages = images.slice(previousCount);
          const failed = newImages.some((image) => image.closest('li')?.querySelector('.message-status.status-error'));
          const loading = newImages.some((image) => image.closest('li')?.querySelector('.message-status.status-loading'));
          if (failed) {
            resolve(false);
            return;
          }
          if (loading) {
            window.setTimeout(check, 250);
            return;
          }
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 250);
      };
      check();
    });
  }

  function waitForTextMessageSent(message, previousOwnCount, previousErrorCount, timeout = 15000) {
    const expected = String(message || '').replace(/\s+/g, ' ').trim();
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const errorIncreased = document.querySelectorAll('.message-status.status-error').length > previousErrorCount;
        if (errorIncreased) {
          resolve(false);
          return;
        }
        const ownMessages = [...document.querySelectorAll('.chat-record .message-item.item-myself')];
        const newOwnMessages = ownMessages.slice(previousOwnCount);
        const matching = newOwnMessages.find((item) => (
          item.querySelector('.message-content .text-content')?.textContent.replace(/\s+/g, ' ').trim() === expected
        ));
        if (matching) {
          if (matching.querySelector('.message-status.status-error')) {
            resolve(false);
            return;
          }
          if (matching.querySelector('.message-status.status-loading')) {
            window.setTimeout(check, 250);
            return;
          }
          resolve(true);
          return;
        }
        // 页面有时先更新左侧会话列表，稍后才把消息节点渲染到右侧聊天记录。
        // 两处都显示目标正文时，均视为发送成功，避免 6 秒左右的渲染延迟被误判。
        const selectedCard = getChatSnapshots().find((snapshot) => (
          snapshot.card.querySelector('.friend-content.selected')
          && snapshot.message.replace(/\s+/g, ' ').trim() === expected
        ));
        if (selectedCard) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 250);
      };
      check();
    });
  }

  async function sendImageMessage(message) {
    if (!message?.content || !message.content.startsWith('data:image/')) {
      throw new Error('图片资源无效');
    }
    const input = findImageUploadInput();
    if (!input) throw new Error('当前聊天页面未找到图片上传控件');
    const previousImageCount = getVisibleImageMessageCount();
    const response = await fetch(message.content);
    const blob = await response.blob();
    const file = new File([blob], message.name || 'boss-auto-image.png', { type: blob.type || 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const sent = await waitForVisibleImageMessage(previousImageCount);
    if (!sent) throw new Error('图片已选择，但未确认图片消息发送成功');
    return true;
  }

  async function sendMessageSequence(sequence, isCancelled = () => false) {
    const messages = Array.isArray(sequence) ? sequence.filter((item) => item && item.content) : [];
    if (!messages.length) throw new Error('消息序列为空');
    const interval = { min: MESSAGE_INTERVAL_MS, max: MESSAGE_INTERVAL_MS };
    for (let index = 0; index < messages.length; index += 1) {
      if (isCancelled()) return false;
      const message = messages[index];
      try {
        if (message.type === 'image') {
          await sendImageMessage(message);
        } else {
          const input = await waitForChatInput();
          if (!input) throw new Error('聊天输入框不可用');
          const previousOwnCount = document.querySelectorAll('.chat-record .message-item.item-myself').length;
          const previousErrorCount = document.querySelectorAll('.message-status.status-error').length;
          fillChatInput(input, message.content.trim());
          const sendButton = await waitForSendButton(input);
          if (!sendButton) throw new Error('发送按钮不可用或仍处于禁用状态');
          sendButton.click();
          const sent = await waitForTextMessageSent(message.content, previousOwnCount, previousErrorCount);
          if (!sent) throw new Error('文字消息未确认发送成功');
        }
      } catch (error) {
        error.sequenceIndex = index;
        error.sequencePosition = index + 1;
        throw error;
      }
      if (index < messages.length - 1) {
        await randomDelay(interval.min, interval.max);
        if (isCancelled()) return false;
      }
    }
    return true;
  }

  function getChatSnapshots() {
    return [...document.querySelectorAll('.user-list ul[role="group"] > li[role="listitem"]')]
      .map((card, index) => {
        const name = card.querySelector('.name-text')?.textContent.trim() || '';
        const title = card.querySelector('.title-box')?.textContent.replace(/\s+/g, ' ').trim() || '';
        // d-c 是页面组件类型标记，多个会话会共用同一个值，不能作为会话 ID；
        // 头像是懒加载的，也不能放进 key，否则图片加载会被误判为新消息。
        const id = [name, title].filter(Boolean).join('|');
        const message = card.querySelector('.last-msg-text')?.textContent.trim() || '';
        const isDraft = Boolean(card.querySelector('.last-msg .draft'));
        return {
          card,
          id,
          key: id || `index:${index}`,
          message,
          isDraft,
          // 不把“送达/已读”等状态放入签名，状态变化不应触发业务处理。
          signature: `${id}|${message}`,
        };
      });
  }

  function clickChatCard(card) {
    // 会话列表的点击监听挂在内部 friend-content 节点；点击外层 li
    // 在部分页面版本中只会改变选中样式，不会加载右侧聊天内容。
    const target = card.querySelector('.friend-content[d-c]') || card;
    target.click();
  }

  async function waitForChatInput(timeout = 6000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const input = findChatInput();
      if (input) return input;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return undefined;
  }

  async function waitForSendButton(input, timeout = 6000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const sendButton = findSendButton(input);
      if (sendButton) return sendButton;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return undefined;
  }

  async function waitForSelectedChat(snapshot, timeout = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const current = getChatSnapshots().find((item) => item.key === snapshot.key);
      if (current?.card.querySelector('.friend-content.selected')) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return undefined;
  }

  async function processNewChat(snapshot, runId = chatMonitorRunId) {
    if (chatMonitorBusy) return;

    const config = loadConfig();
    const sequence = config.messageSequence?.length
      ? config.messageSequence
      : (config.messageTemplate.trim()
        ? [{ type: 'text', content: config.messageTemplate }]
        : []);
    if (!sequence.length) {
      console.info('[Boss Auto] chat event skipped: empty message sequence', { snapshot });
      setStatus('检测到新消息，但消息序列为空', 'error');
      return;
    }
    const recordKey = getMessageRecordKey(snapshot);
    if (hasMessageRecord(snapshot) || chatProcessingKeys.has(recordKey)) {
      console.info('[Boss Auto] chat event skipped: duplicate message record', { snapshot });
      return;
    }

    chatMonitorBusy = true;
    chatProcessingKeys.add(recordKey);
    try {
      await randomDelay(100, 400);
      if (runId !== chatMonitorRunId) return;
      clickChatCard(snapshot.card);
      const selected = await waitForSelectedChat(snapshot);
      if (!selected) throw new Error('联系人会话切换未完成');
      const sent = await sendMessageSequence(sequence, () => runId !== chatMonitorRunId);
      if (!sent) return;
      saveMessageRecord(snapshot);
      setStatus(`已自动回复：${snapshot.message.slice(0, 24)}（${sequence.length} 条）`, 'success');
      console.info('[Boss Auto] new first chat message replied:', snapshot);
    } catch (error) {
      const position = Number.isInteger(error.sequencePosition) ? `（第 ${error.sequencePosition} 条）` : '';
      setStatus(`自动回复失败${position}：${error.message}`, 'error');
      console.error('[Boss Auto] auto reply failed:', { snapshot, error });
    } finally {
      chatProcessingKeys.delete(recordKey);
      chatMonitorBusy = false;
    }
  }

  function monitorChatList() {
    if (chatMonitorBusy) return;
    const snapshots = getChatSnapshots();
    if (!snapshots.length) return;
    if (!chatCardSignatures.size) {
      snapshots.forEach((snapshot) => chatCardSignatures.set(snapshot.key, snapshot.signature));
      return;
    }

    const changed = snapshots.find((snapshot) => {
      const previous = chatCardSignatures.get(snapshot.key);
      if (previous === snapshot.signature) return false;
      chatCardSignatures.set(snapshot.key, snapshot.signature);
      // 状态文本（如“送达/已读”）只反映消息状态，不参与签名和业务判断；
      // 是否已经处理由会话缓存决定，不假设所有用户使用同一句初始话术。
      return !snapshot.isDraft;
    });
    if (changed) {
      console.info('[Boss Auto] chat list change detected:', {
        key: changed.key,
        message: changed.message.slice(0, 60),
        isDraft: changed.isDraft,
      });
      processNewChat(changed, chatMonitorRunId);
    }
  }

  function scheduleChatMonitor() {
    if (chatMonitorDebounceTimer) return;
    chatMonitorDebounceTimer = window.setTimeout(() => {
      chatMonitorDebounceTimer = null;
      monitorChatList();
    }, 80);
  }

  function observeChatList() {
    const list = document.querySelector('.user-list');
    if (!list) return false;
    if (chatMonitorObserver && observedChatList === list) return true;
    if (chatMonitorObserver) chatMonitorObserver.disconnect();

    chatMonitorObserver = new MutationObserver((mutations) => {
      const relevantChange = mutations.some((mutation) => (
        mutation.type === 'childList'
        || mutation.type === 'characterData'
        || (mutation.type === 'attributes'
          && ['class', 'd-c', 'style'].includes(mutation.attributeName))
      ));
      if (relevantChange) scheduleChatMonitor();
    });
    chatMonitorObserver.observe(list, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'd-c', 'style'],
    });
    observedChatList = list;
    console.info('[Boss Auto] chat list observer attached:', {
      cardCount: getChatSnapshots().length,
    });
    return true;
  }

  function startChatMonitor() {
    if (chatMonitorTimer || !isChatPage()) return;
    chatMonitorRunId += 1;
    chatCardSignatures.clear();
    getChatSnapshots().forEach((snapshot) => chatCardSignatures.set(snapshot.key, snapshot.signature));
    observeChatList();
    if (!chatMonitorBodyObserver) {
      chatMonitorBodyObserver = new MutationObserver(() => {
        // 左侧列表可能被 SPA 整体替换，持续检查并重新绑定新的节点。
        observeChatList();
      });
      if (document.body) {
        chatMonitorBodyObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
    // MutationObserver 是主触发；低频轮询仅作为站点特殊更新方式的兜底。
    chatMonitorTimer = window.setInterval(monitorChatList, 5000);
    setStatus('已开始监听聊天列表全部会话');
    console.info('[Boss Auto] chat monitor started for all conversations (MutationObserver + fallback)');
  }

  function stopChatMonitor() {
    chatMonitorRunId += 1;
    if (chatMonitorTimer) window.clearInterval(chatMonitorTimer);
    if (chatMonitorObserver) chatMonitorObserver.disconnect();
    if (chatMonitorBodyObserver) chatMonitorBodyObserver.disconnect();
    if (chatMonitorDebounceTimer) window.clearTimeout(chatMonitorDebounceTimer);
    chatMonitorTimer = null;
    chatMonitorObserver = null;
    chatMonitorBodyObserver = null;
    observedChatList = null;
    chatMonitorDebounceTimer = null;
    chatCardSignatures.clear();
    console.info('[Boss Auto] first chat monitor stopped');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[char]));
  }

  function createStatusPanel() {
    if (document.getElementById(STATUS_ID)) return;

    const css = `
      #${STATUS_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        max-width: 280px;
        padding: 10px 14px;
        color: #fff;
        background: rgba(32, 33, 36, .92);
        border-radius: 6px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, .2);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${STATUS_ID}[data-type="success"] { background: #1f883d; }
      #${STATUS_ID}[data-type="error"] { background: #cf222e; }
      #${PANEL_ID} {
        position: fixed;
        top: 84px;
        right: 20px;
        z-index: 2147483646;
        width: 300px;
        overflow: hidden;
        color: #202124;
        background: #fff;
        border: 1px solid #e6e8eb;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, .14);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .boss-auto-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        color: #fff;
        background: linear-gradient(135deg, #1677ff, #409eff);
      }
      #${PANEL_ID} .boss-auto-title { font-size: 16px; font-weight: 600; }
      #${PANEL_ID} .boss-auto-subtitle { margin-top: 2px; font-size: 12px; opacity: .85; }
      #${PANEL_ID} .boss-auto-collapse {
        width: 24px;
        height: 24px;
        padding: 0;
        color: #fff;
        background: transparent;
        border: 0;
        font-size: 22px;
        line-height: 20px;
        cursor: pointer;
      }
      #${PANEL_ID} .boss-auto-panel-body { padding: 14px 16px 16px; }
      #${PANEL_ID} label { display: block; margin-bottom: 12px; }
      #${PANEL_ID} label span { display: block; margin-bottom: 5px; color: #4e5969; font-size: 12px; }
      #${PANEL_ID} input {
        display: block;
        width: 100%;
        height: 34px;
        padding: 0 10px;
        color: #1d2129;
        background: #f7f8fa;
        border: 1px solid #dcdfe6;
        border-radius: 5px;
        outline: none;
        font: inherit;
      }
      #${PANEL_ID} input:focus { background: #fff; border-color: #1677ff; }
      #${PANEL_ID} .boss-auto-hint { margin: -2px 0 12px; color: #86909c; font-size: 12px; }
      #${PANEL_ID} .boss-auto-start {
        width: 100%;
        height: 34px;
        color: #fff;
        background: #1677ff;
        border: 0;
        border-radius: 5px;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} .boss-auto-start:hover { background: #409eff; }
      #${PANEL_ID} .boss-auto-start {
        width: 100%; height: 34px; margin-top: 8px;
        color: #187a64; background: #edf8f0; border: 1px solid #cce8d7;
        border-radius: 5px; cursor: pointer; font: inherit;
      }
      #${PANEL_ID} .boss-auto-start:hover { background: #e1f3e7; }
      #${PANEL_ID}.collapsed .boss-auto-panel-body { display: none; }
      /* 视觉样式集中限定在面板内，避免影响职位页面。 */
      #${PANEL_ID} {
        width: 336px;
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 108px);
        overflow: auto;
        overscroll-behavior: contain;
        color: #203e3b;
        background: #fff;
        border: 1px solid #dcece7;
        border-radius: 20px;
        box-shadow: 0 18px 60px -16px rgba(19, 68, 57, .25), 0 2px 8px rgba(19, 68, 57, .05);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        text-align: left;
        color-scheme: light;
        resize: both;
        min-width: 280px;
        min-height: 180px;
      }
      #${PANEL_ID} .boss-auto-panel-header {
        padding: 20px;
        color: #164d43;
        background: linear-gradient(120deg, #e5f7ef, #f4faf7);
        border-bottom: 1px solid #e4efe9;
        cursor: grab;
        user-select: none;
      }
      #${PANEL_ID} .boss-auto-panel-header.dragging { cursor: grabbing; }
      #${PANEL_ID} .boss-auto-brand { display: flex; align-items: center; gap: 11px; }
      #${PANEL_ID} .boss-auto-logo {
        display: flex; align-items: center; justify-content: center;
        width: 42px; height: 42px; border-radius: 13px;
        background: #177b65; color: #fff; font-size: 25px; font-weight: 750;
        box-shadow: 0 4px 10px #177b6520;
      }
      #${PANEL_ID} .boss-auto-logo span { color: #b9edba; }
      #${PANEL_ID} .boss-auto-title { font-size: 17px; font-weight: 750; letter-spacing: -.3px; }
      #${PANEL_ID} .boss-auto-subtitle { color: #5d7c73; font-size: 11px; margin-top: 1px; opacity: 1; }
      #${PANEL_ID} .boss-auto-collapse {
        width: 32px; height: 32px; border-radius: 10px;
        color: #426e62; background: #ffffffb3; line-height: 30px;
      }
      #${PANEL_ID} .boss-auto-collapse:hover { background: #fff; }
      #${PANEL_ID} .boss-auto-panel-body { padding: 22px 20px 18px; }
      #${PANEL_ID} .boss-auto-intro { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 650; }
      #${PANEL_ID} .boss-auto-intro small { padding: 3px 8px; border-radius: 6px; background: #eff5f2; color: #5d776c; font-size: 10px; font-weight: 500; }
      #${PANEL_ID} .boss-auto-description { margin: 7px 0 22px; color: #71857c; font-size: 11px; line-height: 1.6; }
      #${PANEL_ID} label { margin-bottom: 17px; }
      #${PANEL_ID} label span { margin-bottom: 7px; color: #3f5b50; font-size: 12px; font-weight: 600; }
      #${PANEL_ID} input {
        height: 42px; padding: 0 12px; border: 1px solid #e1eae5; border-radius: 10px;
        color: #243e34; background: #f8faf9; font-size: 12px;
        transition: border-color .15s, box-shadow .15s, background .15s;
      }
      #${PANEL_ID} input::placeholder { color: #8b9b94; opacity: 1; }
      #${PANEL_ID} input:hover { border-color: #c3d6cc; }
      #${PANEL_ID} input:focus { border-color: #21846a; background: #fff; box-shadow: 0 0 0 3px #21846a15; }
      #${PANEL_ID} .boss-auto-hint { margin: 0 0 19px; color: #73847b; font-size: 11px; }
      #${PANEL_ID} .boss-auto-hint b { display: inline-block; padding: 0 5px; border: 1px solid #e1e8e3; border-radius: 4px; color: #4e6c5c; background: #f6f9f7; }
      #${PANEL_ID} .boss-auto-start {
        height: 43px; border-radius: 11px; color: #fff; background: #187a64;
        box-shadow: 0 4px 10px #187a641c; font-size: 13px; font-weight: 600;
        transition: background .15s, transform .15s;
      }
      #${PANEL_ID} .boss-auto-start:hover { background: #126650; }
      #${PANEL_ID} .boss-auto-start:active { transform: translateY(1px); }
      #${PANEL_ID} .boss-auto-open-settings {
        width: 100%; height: 36px; margin-top: 8px;
        color: #fff; background: #187a64; border: 1px solid #187a64;
        border-radius: 10px; cursor: pointer; font: inherit; font-weight: 600;
      }
      #${PANEL_ID} .boss-auto-open-settings:hover { background: #126650; }
      #${PANEL_ID} button:focus-visible { outline: 3px solid #78bea5; outline-offset: 3px; }
      #${PANEL_ID} .boss-auto-footer { margin-top: 13px; text-align: center; color: #7c8d82; font-size: 10px; }
      #${PANEL_ID}.collapsed {
        width: 190px;
        min-width: 190px;
        min-height: 0;
        resize: none;
        border-radius: 15px;
        box-shadow: 0 10px 30px -10px rgba(19, 68, 57, .28), 0 2px 8px rgba(19, 68, 57, .08);
      }
      #${PANEL_ID}.collapsed .boss-auto-panel-header {
        padding: 10px 12px;
        border-bottom: 0;
      }
      #${PANEL_ID}.collapsed .boss-auto-logo {
        width: 30px;
        height: 30px;
        border-radius: 9px;
        font-size: 18px;
      }
      #${PANEL_ID}.collapsed .boss-auto-brand { gap: 8px; }
      #${PANEL_ID}.collapsed .boss-auto-title { font-size: 14px; }
      #${PANEL_ID}.collapsed .boss-auto-subtitle { display: none; }
      #${PANEL_ID}.collapsed .boss-auto-collapse {
        width: 27px;
        height: 27px;
        border-radius: 8px;
        line-height: 25px;
        font-size: 18px;
      }
      #${STATUS_ID} { max-width: calc(100vw - 40px); border-radius: 12px; background: #30473e; font-size: 12px; box-shadow: 0 6px 24px #193b3320; }
      #${STATUS_ID}[data-type="success"] { color: #23614c; background: #edf8f0; border: 1px solid #cce8d7; }
      #${STATUS_ID}[data-type="error"] { color: #9b3535; background: #fff1f1; border: 1px solid #f0cccc; }
      @media (max-width: 480px) {
        #${PANEL_ID} { top: 64px; right: 12px; max-height: calc(100dvh - 88px); }
        #${STATUS_ID} { right: 12px; bottom: 12px; }
      }
      @media (prefers-reduced-motion: reduce) {
        #${PANEL_ID} input, #${PANEL_ID} button { transition: none; }
      }
    `;
    // Tampermonkey 正常提供 GM_addStyle；保留原生 style 兜底，避免安全校验页中 API 不可用时中断。
    try {
      if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
      } else if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }
    } catch (error) {
      console.warn('[Boss Auto] style API unavailable, using fallback:', error);
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }
    }

    const panel = document.createElement('div');
    panel.id = STATUS_ID;
    panel.dataset.scriptVersion = SCRIPT_VERSION;
    panel.dataset.type = 'info';
    panel.textContent = 'Boss Auto 已加载';
    document.body.appendChild(panel);
  }

  function collectJobRecords() {
    const config = getConfig();
    const known = new Set(jobRecords.map((record) => record.url));
    let added = 0;
    let skipped = 0;

    document.querySelectorAll('.job-card-wrap').forEach((card) => {
      const name = card.querySelector('.job-name');
      const salary = card.querySelector('.job-salary');
      const company = card.querySelector('.boss-name');
      const location = card.querySelector('.company-location');
      const url = name?.href;
      if (!name || !url || known.has(url)) return;

      const job = {
        url,
        jobName: name.textContent.trim(),
        salary: salary?.textContent.trim() || '',
        tags: [...card.querySelectorAll('.tag-list li')].map((tag) => tag.textContent.trim()),
        company: company?.textContent.trim() || '',
        location: location?.textContent.trim() || '',
        collectedAt: new Date().toISOString(),
      };

      if (!isJobAllowed(job, config)) {
        skipped += 1;
        known.add(url);
        return;
      }

      jobRecords.push(job);
      known.add(url);
      added += 1;
    });

    return { added, skipped, total: jobRecords.length };
  }

  function getJobCount() {
    return document.querySelectorAll('.job-card-wrap, .job-card-box').length;
  }

  function waitForMoreJobs(previousCount, timeout = 3000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = () => {
        const count = getJobCount();
        if (count > previousCount || Date.now() - startedAt >= timeout) {
          resolve({ increased: count > previousCount, count });
          return;
        }
        window.setTimeout(check, 250);
      };
      check();
    });
  }

  function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  async function waitForDeliveryResume() {
    while (deliveryPaused && isJobsPage()) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }

  /** Boss 职位列表通过滚动触发下一页接口请求。 */
  async function autoPaginate() {
    if (paginationRunning || !isJobsPage()) return;

    paginationRunning = true;
    const button = document.querySelector('.boss-auto-start');
    if (button) button.textContent = '自动翻页中…';

    try {
      let page = 1;
      let unchangedRounds = 0;
      const initial = collectJobRecords();
      console.info('[Boss Auto] jobs collected:', initial);

      while (paginationRunning && !deliveryPaused && isJobsPage()) {
        const before = getJobCount();
        const scrollRoot = document.scrollingElement || document.documentElement;
        window.scrollTo({ top: scrollRoot.scrollHeight, behavior: 'smooth' });
        const result = await waitForMoreJobs(before);

        if (result.increased) {
          page += 1;
          unchangedRounds = 0;
          const collected = collectJobRecords();
          setStatus(`已加载第 ${page} 页，已记录 ${collected.total} 个职位`, 'success');
          console.info('[Boss Auto] page loaded:', { page, jobCount: result.count, collected });
          await randomDelay(500, 1200);
        } else {
          unchangedRounds += 1;
          if (unchangedRounds >= 2) break;
          await randomDelay(700, 1400);
        }
      }

      const finalCount = getJobCount();
      const finalRecords = collectJobRecords();
      setStatus(`自动翻页结束，已记录 ${finalRecords.total} 个职位`, 'success');
      console.info('[Boss Auto] pagination finished:', { pages: page, jobCount: finalCount, records: finalRecords });
    } catch (error) {
      setStatus(`自动翻页失败：${error.message}`, 'error');
      console.error('[Boss Auto] pagination failed:', error);
    } finally {
      paginationRunning = false;
      if (button) button.textContent = deliveryPaused
        ? '继续投递' : (jobRecords.length ? '投递下一条' : '开始投递');
    }
  }

  function waitForChatButton(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        const button = document.querySelector('.job-detail-container .op-btn-chat');
        if (button) {
          resolve(button);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('右侧详情面板中的“立即沟通”按钮未出现'));
          return;
        }
        window.setTimeout(check, 250);
      };
      check();
    });
  }

  function clickJobCard(card) {
    // BOSS 的点击监听实际挂在职位卡片内部的 li；从外层 wrapper 调用 click
    // 在部分页面版本中不会触发右侧详情渲染。
    const target = card.querySelector('.job-card-box') || card;
    target.click();
  }

  function readOnlineStatusFromDetail(expectedUrl = '') {
    const detail = document.querySelector('.job-detail-container');
    if (!detail) return { status: '', rawStatus: '', source: 'none', fieldAvailable: null };
    if (expectedUrl) {
      const detailLink = detail.querySelector('a[href*="job_detail"]');
      if (!detailLink || !isExpectedDetailLink(detailLink, expectedUrl)) {
        return { status: '', rawStatus: '', source: 'none', fieldAvailable: null };
      }
    }
    const values = [
      ...[...detail.querySelectorAll('.boss-online-tag, .job-boss-info .name')]
        .map((element) => element.textContent.replace(/\s+/g, ' ').trim()),
      detail.textContent.replace(/\s+/g, ' ').trim(),
    ];
    for (const text of values) {
      const status = STATUS_OPTIONS
        .filter((option) => option.value !== '不限')
        .map((option) => option.value)
        .find((value) => text === value || text.endsWith(` ${value}`) || text.includes(` ${value} `));
      if (status) {
        return { status, rawStatus: status, source: 'dom', fieldAvailable: true };
      }
    }
    return { status: '', rawStatus: '', source: 'dom', fieldAvailable: null };
  }

  async function readOnlineStatusFromResponse(expectedUrl = '') {
    const detailLink = document.querySelector('.job-detail-container a[href*="job_detail"]');
    if (!detailLink) return { status: '', rawStatus: '', source: 'none', fieldAvailable: null };
    if (expectedUrl && !isExpectedDetailLink(detailLink, expectedUrl)) {
      return { status: '', rawStatus: '', source: 'none', fieldAvailable: null };
    }
    const detailUrl = new URL(detailLink.href, location.href);
    const securityId = detailUrl.searchParams.get('securityId');
    if (!securityId) return { status: '', rawStatus: '', source: 'error', fieldAvailable: null, error: '缺少 securityId' };
    try {
      const params = new URLSearchParams({ securityId });
      const lid = detailUrl.searchParams.get('lid');
      if (lid) params.set('lid', lid);
      const response = await fetch(`/wapi/zpgeek/job/detail.json?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        return { status: '', rawStatus: '', source: 'error', fieldAvailable: null, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      if (data?.code !== 0) {
        return {
          status: '', rawStatus: '', source: 'error', fieldAvailable: null,
          error: data?.message || `接口业务码异常：${data?.code ?? 'unknown'}`,
        };
      }
      const bossInfo = data?.zpData?.bossInfo || {};
      const hasOnlineField = Object.prototype.hasOwnProperty.call(bossInfo, 'activeTimeDesc')
        || Object.prototype.hasOwnProperty.call(bossInfo, 'bossOnline');
      updateOnlineStatusCapability(hasOnlineField);
      const rawStatus = typeof bossInfo.activeTimeDesc === 'string'
        ? bossInfo.activeTimeDesc.trim() : '';
      if (rawStatus && STATUS_OPTIONS.some((option) => option.value === rawStatus)) {
        return { status: rawStatus, rawStatus, source: 'response', fieldAvailable: hasOnlineField };
      }
      if (rawStatus) {
        console.warn('[Boss Auto] unknown online status value:', rawStatus);
        return { status: '', rawStatus, source: 'response', fieldAvailable: hasOnlineField };
      }
      if (bossInfo.bossOnline === true) {
        return { status: '在线', rawStatus: '在线', source: 'response', fieldAvailable: hasOnlineField };
      }
      return { status: '', rawStatus: '', source: 'response', fieldAvailable: hasOnlineField };
    } catch (error) {
      console.warn('[Boss Auto] online status response unavailable:', error.message);
      return { status: '', rawStatus: '', source: 'error', fieldAvailable: null, error: error.message };
    }
  }

  function isExpectedDetailLink(detailLink, expectedUrl) {
    const actual = new URL(detailLink.href, location.href);
    const expected = new URL(expectedUrl, location.href);
    const actualSecurityId = actual.searchParams.get('securityId');
    const expectedSecurityId = expected.searchParams.get('securityId');
    if (actualSecurityId && expectedSecurityId) return actualSecurityId === expectedSecurityId;
    // 职位卡片链接通常没有 securityId，详情链接会在同一职位 URL 上追加它。
    if (!expectedSecurityId) return actual.pathname === expected.pathname;
    return false;
  }

  async function waitForOnlineStatus(expectedUrl = '', timeout = 3000) {
    const startedAt = Date.now();
    let responseResult = { status: '', rawStatus: '', source: 'none', fieldAvailable: null };
    let responseAttempted = false;
    while (Date.now() - startedAt < timeout) {
      if (!responseAttempted) {
        responseResult = await readOnlineStatusFromResponse(expectedUrl);
        responseAttempted = responseResult.source !== 'none';
        if (responseResult.status || responseResult.rawStatus || responseResult.fieldAvailable === false) {
          return responseResult;
        }
      }
      const domResult = readOnlineStatusFromDetail(expectedUrl);
      if (domResult.status) {
        return {
          ...domResult,
          // 筛选能力必须由后端字段确认，DOM 只负责等待渲染完成的兜底读取。
          fieldAvailable: responseResult.fieldAvailable,
        };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return {
      ...responseResult,
      source: responseResult.source === 'none' ? 'timeout' : responseResult.source,
      error: responseResult.error || '在线状态读取超时',
    };
  }

  function shouldProcessOnlineStatus(result, config) {
    if (config.onlineStatusMode === '不限') return true;
    if (result.fieldAvailable !== true) return false;
    if (!result.status) return config.unknownOnlineStatusPolicy === 'keep';
    return config.selectedOnlineStatuses.includes(result.status);
  }

  async function clickStayOnPage(timeout = 3000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const stayButton = [...document.querySelectorAll('button, a, [role="button"]')].find((element) => {
        const text = element.textContent.trim();
        return /留在此页|留在当前页面/.test(text) && !element.disabled;
      });

      if (stayButton) {
        stayButton.click();
        console.info('[Boss Auto] stayed on current page after delivery prompt');
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
  }

  async function clickNextDelivery() {
    if (deliveryIndex >= jobRecords.length) {
      setStatus('岗位队列已处理完毕', 'success');
      return;
    }

    const record = jobRecords[deliveryIndex];
    const card = [...document.querySelectorAll('.job-card-wrap')].find((item) => {
      const link = item.querySelector('.job-name');
      return link && new URL(link.href, location.href).href === record.url;
    });

    if (!card) {
      setStatus(`找不到岗位卡片：${record.jobName}`, 'error');
      record.status = 'failed';
      record.error = '找不到岗位卡片';
      deliveryIndex += 1;
      return;
    }

    deliveryRunning = true;
    const button = document.querySelector('.boss-auto-start');
    if (button) button.textContent = '正在点击投递…';

    try {
      await randomDelay(1200, 2800);
      card.scrollIntoView({ block: 'center', behavior: 'auto' });
      clickJobCard(card);
      await randomDelay(250, 500);
      const config = loadConfig();
      const onlineResult = config.onlineStatusMode === '不限'
        ? { status: '不限', rawStatus: '不限', source: 'bypass', fieldAvailable: null }
        : await waitForOnlineStatus(record.url);
      const onlineStatus = onlineResult.status;
      record.onlineText = onlineStatus || '未知';
      record.onlineValue = onlineResult.rawStatus || onlineStatus;
      record.onlineSource = onlineResult.source;
      record.onlineFieldAvailable = onlineResult.fieldAvailable;
      record.onlineReadError = onlineResult.error || '';
      record.onlineCheckedAt = new Date().toISOString();
      if (!shouldProcessOnlineStatus(onlineResult, config)) {
        record.status = 'skipped';
        record.skipReason = onlineResult.error
          ? `在线状态读取失败：${onlineResult.error}`
          : (onlineResult.rawStatus && !onlineStatus
            ? `后端返回未知在线状态：${onlineResult.rawStatus}`
            : (onlineStatus ? `在线状态不匹配：${onlineStatus}` : '在线状态未知'));
        setStatus(`已跳过${record.jobName}：${record.skipReason}`);
        deliveryIndex += 1;
        return;
      }
      const chatButton = await waitForChatButton();
      if (chatButton.classList.contains('is-disabled')
        || chatButton.getAttribute('aria-disabled') === 'true'
        || chatButton.disabled) {
        throw new Error('“立即沟通”按钮当前不可用');
      }
      await randomDelay(800, 1800);
      chatButton.click();
      await clickStayOnPage();
      await randomDelay(900, 2200);
      deliveryIndex += 1;
      setStatus(`已点击第 ${deliveryIndex} 条“立即沟通”：${record.jobName}`, 'success');
      console.info('[Boss Auto] delivery item clicked:', {
        index: deliveryIndex,
        total: jobRecords.length,
        record,
      });
    } catch (error) {
      record.status = 'failed';
      record.error = error.message;
      deliveryIndex += 1;
      setStatus(`岗位投递失败：${error.message}`, 'error');
      console.error('[Boss Auto] delivery failed:', { record, error });
    } finally {
      deliveryRunning = false;
      if (button) button.textContent = deliveryPaused
        ? '继续投递' : (deliveryIndex < jobRecords.length ? '投递下一条' : '岗位队列已完成');
    }
  }

  async function startDelivery() {
    if (paginationRunning || deliveryRunning) return;
    deliveryPaused = false;
    const button = document.querySelector('.boss-auto-start');
    if (button) button.textContent = '暂停投递';

    if (!jobRecords.length) {
      setStatus('正在翻页记录岗位…');
      await autoPaginate();
    }
    while (isJobsPage() && deliveryIndex < jobRecords.length) {
      await waitForDeliveryResume();
      if (!isJobsPage()) break;
      await clickNextDelivery();
    }
    if (deliveryIndex >= jobRecords.length) {
      deliveryPaused = false;
      setStatus(`岗位队列已处理完毕，共 ${jobRecords.length} 个职位`, 'success');
      console.info('[Boss Auto] continuous delivery finished:', {
        total: jobRecords.length,
        records: jobRecords,
      });
    }
  }

  /** 当前阶段只显示配置面板，不自动执行翻页；点击按钮后开始。 */
  async function runAutomation() {
    if (!isJobsPage() || hasRunForUrl) return;
    if (!document.body) return;

    hasRunForUrl = true;
    console.info('[Boss Auto] matched jobs page:', location.href);
    createStatusPanel();
    createSettingsPanel();
    setStatus('已识别职位列表页，自动任务已触发…');

    try {
      const config = getConfig();
      console.info('[Boss Auto] current config:', {
        keywords: splitTerms(config.keywords),
        locations: splitTerms(config.locations),
        blockedWords: splitTerms(config.blockedWords),
      });
      await Promise.resolve();
      setStatus('配置面板已就绪，自动化逻辑尚未启用', 'success');
      console.info('[Boss Auto] jobs page detected:', location.href);
    } catch (error) {
      setStatus(`自动任务执行失败：${error.message}`, 'error');
      console.error('[Boss Auto] automation failed:', error);
    }
  }

  function cleanupRoutePanels() {
    if (!isJobsPage()) {
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(SETTINGS_VIEW_ID)?.remove();
      document.getElementById(`${SETTINGS_VIEW_ID}-style`)?.remove();
      settingsViewDirty = false;
    }
    if (!isChatPage()) {
      stopChatMonitor();
      document.getElementById(CHAT_PANEL_ID)?.remove();
      document.getElementById(`${CHAT_PANEL_ID}-style`)?.remove();
    }
  }

  function handleUrlChange() {
    if (location.href === lastUrl) return;

    lastUrl = location.href;
    hasRunForUrl = false;
    paginationRunning = false;
    cleanupRoutePanels();

    if (isJobsPage()) {
      createStatusPanel();
      createSettingsPanel();
      setStatus('检测到职位列表页变化，准备触发…');
      runAutomation();
    } else if (isChatPage()) {
      createStatusPanel();
      createChatPanel();
      setStatus('聊天页面已就绪，请点击“开始沟通”');
    }
  }

  window.addEventListener('popstate', handleUrlChange);
  // 不改写 History API，避免被站点完整性检测；轮询只负责发现 SPA 路由变化。
  window.setInterval(handleUrlChange, 1000);

  // 首次打开页面时自动触发；安全校验页可能较晚才创建 body，因此延后重试。
  function boot() {
    if (!isJobsPage() && !isChatPage()) return;
    if (!document.body) {
      window.setTimeout(boot, 100);
      return;
    }
    createStatusPanel();
    if (isJobsPage()) {
      createSettingsPanel();
      runAutomation();
    } else {
      createChatPanel();
      setStatus('聊天页面已就绪，请点击“开始沟通”');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  window.setTimeout(boot, 1000);
})();
