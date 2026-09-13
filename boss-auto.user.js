// ==UserScript==
// @name         Boss 直聘 - 自动触发脚手架
// @namespace    https://github.com/your-name/boss-auto
// @version      0.2.2
// @description  进入 Boss 直聘职位列表页后显示自动化配置面板
// @author       you
// @match        https://www.zhipin.com/web/geek/jobs*
// @match        https://www.zhipin.com/web/geek/chat*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_PATH = '/web/geek/jobs';
  const CONFIG_KEY = 'boss-auto-config';
  const CHAT_PANEL_ID = 'boss-auto-chat-panel';
  const PANEL_ID = 'boss-auto-panel';
  const STATUS_ID = 'boss-auto-status';
  const STYLE_ID = 'boss-auto-style';
  let lastUrl = location.href;
  let hasRunForUrl = false;
  let paginationRunning = false;
  let deliveryRunning = false;
  const jobRecords = [];
  let deliveryIndex = 0;
  let chatMonitorTimer = null;
  let chatMonitorObserver = null;
  let chatMonitorBodyObserver = null;
  let chatMonitorDebounceTimer = null;
  let chatMonitorBusy = false;
  let firstChatSignature = '';

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
      return {
        keywords: JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').keywords || '',
        locations: JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').locations || '',
        blockedWords: JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').blockedWords || '',
        messageTemplate: JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').messageTemplate || '',
      };
    } catch {
      return { keywords: '', locations: '', blockedWords: '', messageTemplate: '' };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function splitTerms(value) {
    return value.split('-').map((item) => item.trim()).filter(Boolean);
  }

  function getConfig() {
    const form = document.getElementById(PANEL_ID);
    if (!form) return loadConfig();

    return {
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

  function createSettingsPanel() {
    if (document.getElementById(PANEL_ID)) return;

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
        <button type="button" class="boss-auto-save">保存配置</button>
        <button type="button" class="boss-auto-paginate">开始投递</button>
        <div class="boss-auto-footer">保存在当前浏览器 · 自动化尚未启用</div>
      </div>
    `;
    document.body.appendChild(panel);

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

    panel.querySelector('.boss-auto-save').addEventListener('click', () => {
      const current = getConfig();
      saveConfig(current);
      setStatus('筛选配置已保存', 'success');
      console.info('[Boss Auto] config saved:', {
        keywords: splitTerms(current.keywords),
        locations: splitTerms(current.locations),
        blockedWords: splitTerms(current.blockedWords),
      });
    });

    panel.querySelector('.boss-auto-paginate').addEventListener('click', () => {
      if (!paginationRunning && !deliveryRunning) startDelivery();
    });

    panel.querySelector('.boss-auto-collapse').addEventListener('click', (event) => {
      const collapsed = panel.classList.toggle('collapsed');
      event.currentTarget.textContent = collapsed ? '+' : '−';
      event.currentTarget.setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  function saveMessageTemplate(template) {
    const config = loadConfig();
    config.messageTemplate = template.trim();
    saveConfig(config);
  }

  function createChatPanel() {
    if (document.getElementById(CHAT_PANEL_ID)) return;

    const config = loadConfig();
    const style = document.createElement('style');
    style.id = `${CHAT_PANEL_ID}-style`;
    style.textContent = `
      #${CHAT_PANEL_ID} {
        position: fixed; right: 20px; bottom: 84px; z-index: 2147483646;
        width: 320px; padding: 16px; color: #203e3b; background: #fff;
        border: 1px solid #dcece7; border-radius: 16px;
        box-shadow: 0 12px 40px rgba(19, 68, 57, .18);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${CHAT_PANEL_ID} h3 { margin: 0 0 5px; font-size: 15px; }
      #${CHAT_PANEL_ID} p { margin: 0 0 12px; color: #71857c; font-size: 11px; }
      #${CHAT_PANEL_ID} textarea {
        display: block; width: 100%; min-height: 100px; resize: vertical;
        padding: 10px; color: #243e34; background: #f8faf9;
        border: 1px solid #e1eae5; border-radius: 10px; outline: none;
        font: inherit;
      }
      #${CHAT_PANEL_ID} textarea:focus { border-color: #21846a; background: #fff; }
      #${CHAT_PANEL_ID} button {
        width: 100%; height: 36px; margin-top: 9px; border: 0;
        border-radius: 9px; cursor: pointer; font: inherit; font-weight: 600;
      }
      #${CHAT_PANEL_ID} .save-template { color: #187a64; background: #edf8f0; }
      #${CHAT_PANEL_ID} .send-template { color: #fff; background: #187a64; }
      #${CHAT_PANEL_ID} .monitor-chat { color: #4e6c5c; background: #f6f9f7; border: 1px solid #e1e8e3; }
      #${CHAT_PANEL_ID} button:hover { filter: brightness(.97); }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = CHAT_PANEL_ID;
    panel.innerHTML = `
      <h3>消息模板</h3>
      <p>先选择左侧联系人，再发送当前模板。</p>
      <textarea name="messageTemplate" placeholder="输入要发送给招聘者的消息">${escapeHtml(config.messageTemplate)}</textarea>
      <button type="button" class="save-template">保存模板</button>
      <button type="button" class="send-template">自动发送模板消息</button>
      <button type="button" class="monitor-chat">停止监听最新消息</button>
    `;
    document.body.appendChild(panel);

    const textarea = panel.querySelector('[name="messageTemplate"]');
    panel.querySelector('.save-template').addEventListener('click', () => {
      saveMessageTemplate(textarea.value);
      setStatus('消息模板已保存', 'success');
    });
    panel.querySelector('.send-template').addEventListener('click', () => {
      saveMessageTemplate(textarea.value);
      sendTemplateMessage(textarea.value);
    });
    panel.querySelector('.monitor-chat').addEventListener('click', (event) => {
      if (chatMonitorTimer) {
        stopChatMonitor();
        event.currentTarget.textContent = '开始监听最新消息';
      } else {
        startChatMonitor();
        event.currentTarget.textContent = '停止监听最新消息';
      }
    });
  }

  function findChatInput() {
    return document.querySelector('.chat-input textarea, textarea[placeholder*="输入"], [contenteditable="true"]:not(.boss-search-input)');
  }

  function findSendButton() {
    return [...document.querySelectorAll('button, a, [role="button"]')].find((element) => {
      const text = element.textContent.trim();
      return /^发送$/.test(text) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
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

  function sendTemplateMessage(message) {
    const text = message.trim();
    if (!text) {
      setStatus('请先填写消息模板', 'error');
      return false;
    }

    const input = findChatInput();
    const sendButton = findSendButton();
    if (!input || !sendButton) {
      setStatus('请先选择一个联系人，或当前会话暂不可发送', 'error');
      return false;
    }

    fillChatInput(input, text);
    sendButton.click();
    setStatus('模板消息已发送', 'success');
    return true;
  }

  function getFirstChatSnapshot() {
    const card = document.querySelector(
      '.user-list ul[role="group"] > li[role="listitem"]:first-child',
    );
    if (!card) return null;

    const id = card.querySelector('.friend-content[d-c]')?.getAttribute('d-c') || '';
    const message = card.querySelector('.last-msg-text')?.textContent.trim() || '';
    const status = card.querySelector('.message-status')?.textContent.trim() || '';
    return {
      card,
      id,
      message,
      status,
      signature: `${id}|${status}|${message}`,
    };
  }

  async function waitForChatControls(timeout = 6000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const input = findChatInput();
      const sendButton = findSendButton();
      if (input && sendButton) return { input, sendButton };
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return null;
  }

  function isOwnInitialMessage(snapshot, config) {
    const message = snapshot.message.replace(/\s+/g, '').trim();
    const savedTemplate = (config.messageTemplate || '').replace(/\s+/g, '').trim();
    const initialMessage = '您好，希望您能看看我的资料，我有信心能够胜任这个职位。';
    return message === initialMessage || (savedTemplate && message === savedTemplate);
  }

  async function processNewFirstChat(snapshot) {
    if (chatMonitorBusy) return;

    const config = loadConfig();
    if (isOwnInitialMessage(snapshot, config)) return;
    if (!config.messageTemplate.trim()) {
      setStatus('检测到新消息，但消息模板为空', 'error');
      return;
    }

    chatMonitorBusy = true;
    try {
      await randomDelay(100, 400);
      snapshot.card.click();
      const controls = await waitForChatControls();
      if (!controls) throw new Error('聊天输入框或发送按钮未出现');
      await randomDelay(700, 1600);
      fillChatInput(controls.input, config.messageTemplate);
      controls.sendButton.click();
      setStatus(`已自动回复：${snapshot.message.slice(0, 24)}`, 'success');
      console.info('[Boss Auto] new first chat message replied:', snapshot);
    } catch (error) {
      setStatus(`自动回复失败：${error.message}`, 'error');
      console.error('[Boss Auto] auto reply failed:', { snapshot, error });
    } finally {
      chatMonitorBusy = false;
    }
  }

  function monitorFirstChat() {
    const snapshot = getFirstChatSnapshot();
    if (!snapshot) return;
    if (!firstChatSignature) {
      firstChatSignature = snapshot.signature;
      return;
    }
    if (snapshot.signature === firstChatSignature) return;

    firstChatSignature = snapshot.signature;
    processNewFirstChat(snapshot);
  }

  function scheduleFirstChatMonitor() {
    if (chatMonitorDebounceTimer) return;
    chatMonitorDebounceTimer = window.setTimeout(() => {
      chatMonitorDebounceTimer = null;
      monitorFirstChat();
    }, 80);
  }

  function observeFirstChatList() {
    if (chatMonitorObserver) return true;
    const list = document.querySelector('.user-list');
    if (!list) return false;

    chatMonitorObserver = new MutationObserver((mutations) => {
      const relevantChange = mutations.some((mutation) => (
        mutation.type === 'childList'
        || mutation.type === 'characterData'
        || (mutation.type === 'attributes'
          && ['class', 'd-c', 'style'].includes(mutation.attributeName))
      ));
      if (relevantChange) scheduleFirstChatMonitor();
    });
    chatMonitorObserver.observe(list, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'd-c', 'style'],
    });
    return true;
  }

  function startChatMonitor() {
    if (chatMonitorTimer || !isChatPage()) return;
    firstChatSignature = getFirstChatSnapshot()?.signature || '';
    observeFirstChatList();
    if (!chatMonitorObserver) {
      chatMonitorBodyObserver = new MutationObserver(() => {
        if (observeFirstChatList() && chatMonitorBodyObserver) {
          chatMonitorBodyObserver.disconnect();
          chatMonitorBodyObserver = null;
        }
      });
      if (document.body) {
        chatMonitorBodyObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
    // MutationObserver 是主触发；低频轮询仅作为站点特殊更新方式的兜底。
    chatMonitorTimer = window.setInterval(monitorFirstChat, 5000);
    setStatus('已开始监听聊天列表第一条消息');
    console.info('[Boss Auto] first chat monitor started (MutationObserver + fallback)');
  }

  function stopChatMonitor() {
    if (chatMonitorTimer) window.clearInterval(chatMonitorTimer);
    if (chatMonitorObserver) chatMonitorObserver.disconnect();
    if (chatMonitorBodyObserver) chatMonitorBodyObserver.disconnect();
    if (chatMonitorDebounceTimer) window.clearTimeout(chatMonitorDebounceTimer);
    chatMonitorTimer = null;
    chatMonitorObserver = null;
    chatMonitorBodyObserver = null;
    chatMonitorDebounceTimer = null;
    chatMonitorBusy = false;
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
      #${PANEL_ID} .boss-auto-save {
        width: 100%;
        height: 34px;
        color: #fff;
        background: #1677ff;
        border: 0;
        border-radius: 5px;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} .boss-auto-save:hover { background: #409eff; }
      #${PANEL_ID} .boss-auto-paginate {
        width: 100%; height: 34px; margin-top: 8px;
        color: #187a64; background: #edf8f0; border: 1px solid #cce8d7;
        border-radius: 5px; cursor: pointer; font: inherit;
      }
      #${PANEL_ID} .boss-auto-paginate:hover { background: #e1f3e7; }
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
      #${PANEL_ID} .boss-auto-save {
        height: 43px; border-radius: 11px; background: #187a64;
        box-shadow: 0 4px 10px #187a641c; font-size: 13px; font-weight: 600;
        transition: background .15s, transform .15s;
      }
      #${PANEL_ID} .boss-auto-save:hover { background: #126650; }
      #${PANEL_ID} .boss-auto-save:active { transform: translateY(1px); }
      #${PANEL_ID} .boss-auto-paginate {
        height: 43px; margin-top: 8px; border: 0; border-radius: 11px;
        color: #187a64; background: #edf8f0;
        font-size: 13px; font-weight: 600;
        transition: background .15s, transform .15s;
      }
      #${PANEL_ID} .boss-auto-paginate:hover { background: #e1f3e7; }
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

  /** Boss 职位列表通过滚动触发下一页接口请求。 */
  async function autoPaginate() {
    if (paginationRunning || !isJobsPage()) return;

    paginationRunning = true;
    const button = document.querySelector('.boss-auto-paginate');
    if (button) button.textContent = '自动翻页中…';

    try {
      let page = 1;
      let unchangedRounds = 0;
      const initial = collectJobRecords();
      console.info('[Boss Auto] jobs collected:', initial);

      while (paginationRunning && isJobsPage()) {
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
      if (button) button.textContent = jobRecords.length ? '投递下一条' : '开始投递';
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
      return;
    }

    deliveryRunning = true;
    const button = document.querySelector('.boss-auto-paginate');
    if (button) button.textContent = '正在点击投递…';

    try {
      await randomDelay(1200, 2800);
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.click();
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
      setStatus(`岗位投递失败：${error.message}`, 'error');
      console.error('[Boss Auto] delivery failed:', { record, error });
    } finally {
      deliveryRunning = false;
      if (button) button.textContent = deliveryIndex < jobRecords.length ? '投递下一条' : '岗位队列已完成';
    }
  }

  async function startDelivery() {
    if (paginationRunning) return;

    if (!jobRecords.length) {
      setStatus('正在翻页记录岗位…');
      await autoPaginate();
    }
    await clickNextDelivery();
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

  function handleUrlChange() {
    if (location.href === lastUrl) return;

    lastUrl = location.href;
    hasRunForUrl = false;
    paginationRunning = false;

    if (isJobsPage()) {
      createStatusPanel();
      createSettingsPanel();
      setStatus('检测到职位列表页变化，准备触发…');
      runAutomation();
    } else if (isChatPage()) {
      createStatusPanel();
      createChatPanel();
      setStatus('聊天页面已就绪');
      startChatMonitor();
    }
  }

  // Boss 直聘使用单页应用路由，直接监听常见的 History API 变化。
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('boss-auto:url-change'));
      return result;
    };
  }

  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('boss-auto:url-change', handleUrlChange);

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
      setStatus('聊天页面已就绪');
      startChatMonitor();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  window.setTimeout(boot, 1000);
})();
