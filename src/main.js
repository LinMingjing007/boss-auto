(function () {
  'use strict';

  const {
    TARGET_PATH, SCRIPT_VERSION, CHAT_PANEL_ID, AI_CHAT_PANEL_ID, PANEL_ID, STATUS_ID,
    STYLE_ID, SETTINGS_VIEW_ID, MESSAGE_INTERVAL_MS, MAX_CHAT_MESSAGE_LENGTH, STATUS_OPTIONS, AI_MODEL_OPTIONS,
    LOG_PANEL_ID,
    AI_REQUEST_TIMEOUT_MS,
  } = window.BossAutoConstants;
  const { splitTerms } = window.BossAutoStorage;
  let lastUrl = location.href;
  let hasRunForUrl = false;
  const runtimeState = { chatMonitoring: false };
  const jobBridge = {
    getState: () => ({
      searchRunning: false,
      paginationRunning: false,
      deliveryRunning: false,
      deliveryPaused: false,
      deliveryIndex: 0,
      queueTotal: 0,
    }),
    startDelivery: () => {},
    searchJobs: async () => null,
    togglePause: () => false,
  };


  /**
   * 判断当前页面是否为职位列表页。
   * @returns {boolean}
   */
  function isJobsPage() {
    return location.hostname === 'www.zhipin.com'
      && location.pathname.replace(/\/+$/, '') === TARGET_PATH;
  }

  function isChatPage() {
    return location.hostname === 'www.zhipin.com'
      && location.pathname.replace(/\/+$/, '') === '/web/geek/chat';
  }

  function setStatus(message, type = 'info') {
    const status = document.getElementById(STATUS_ID);
    window.BossAutoLogInstance?.add(message, type);
    if (!status) return;

    status.textContent = message;
    status.dataset.type = type;
  }
  window.BossAutoSetStatus = setStatus;
  window.BossAutoLogInstance = typeof window.BossAutoLog === 'function'
    ? window.BossAutoLog({ LOG_PANEL_ID, PANEL_ID, CHAT_PANEL_ID, AI_CHAT_PANEL_ID, escapeHtml })
    : {
      add() {}, createLogPanel() {}, removeLogPanel() {}, setPage() {}, attachTo() {},
    };


  const settings = window.BossAutoSettings({
    PANEL_ID, SETTINGS_VIEW_ID, STATUS_ID, STATUS_OPTIONS, MESSAGE_INTERVAL_MS, MAX_CHAT_MESSAGE_LENGTH, AI_MODEL_OPTIONS,
    loadConfig: window.BossAutoStorage.loadConfig,
    saveConfig: window.BossAutoStorage.saveConfig,
    loadConfigStore: window.BossAutoStorage.loadConfigStore,
    saveConfigStore: window.BossAutoStorage.saveConfigStore,
    setActiveVersion: window.BossAutoStorage.setActiveVersion,
    handleImageFileSelection: window.BossAutoStorage.handleImageFileSelection,
    setStatus,
    escapeHtml,
    jobBridge,
    isConfigSwitchLocked: () => {
      const state = jobBridge.getState();
      return Boolean(state.searchRunning || state.paginationRunning || state.deliveryRunning || state.deliveryPaused || runtimeState.chatMonitoring);
    },
  });
  const {
    getConfig, addSettingsButton, openSettingsView,
    updateOnlineStatusCapability, createSettingsPanel,
  } = settings;
  const chat = window.BossAutoChat({
    CHAT_PANEL_ID, MESSAGE_INTERVAL_MS, MAX_CHAT_MESSAGE_LENGTH,
    loadConfig: window.BossAutoStorage.loadConfig,
    loadConfigStore: window.BossAutoStorage.loadConfigStore,
    setActiveVersion: window.BossAutoStorage.setActiveVersion,
    handleImageFileSelection: window.BossAutoStorage.handleImageFileSelection,
    getMessageRecordKey: window.BossAutoStorage.getMessageRecordKey,
    hasMessageRecord: window.BossAutoStorage.hasMessageRecord,
    saveMessageRecord: window.BossAutoStorage.saveMessageRecord,
    setStatus, escapeHtml, addSettingsButton, openSettingsView, isChatPage,
    randomDelay: window.BossAutoStorage.randomDelay,
    setMonitoringState: (running) => { runtimeState.chatMonitoring = running; },
  });
  const { createChatPanel, stopChatMonitor } = chat;
  const aiChat = typeof window.BossAutoAiChat === 'function'
    ? window.BossAutoAiChat({
      AI_CHAT_PANEL_ID, AI_REQUEST_TIMEOUT_MS, MAX_CHAT_MESSAGE_LENGTH,
      loadConfig: window.BossAutoStorage.loadConfig,
      loadConfigStore: window.BossAutoStorage.loadConfigStore,
      saveConfig: window.BossAutoStorage.saveConfig,
      setStatus, escapeHtml, jobBridge, isJobsPage,
    })
    : { createAiChatPanel() {}, removeAiChatPanel() {} };
  const jobs = window.BossAutoJobs({
    setStatus, getConfig, loadConfig: window.BossAutoStorage.loadConfig,
    AI_REQUEST_TIMEOUT_MS,
    isJobAllowed, isJobsPage, STATUS_OPTIONS,
    randomDelay: window.BossAutoStorage.randomDelay,
    updateOnlineStatusCapability,
  });
  Object.assign(jobBridge, jobs);

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
      settings.reset();
    }
    if (!isChatPage()) {
      stopChatMonitor();
      document.getElementById(CHAT_PANEL_ID)?.remove();
      document.getElementById(`${CHAT_PANEL_ID}-style`)?.remove();
    }
    if (!isJobsPage() && !isChatPage()) aiChat.removeAiChatPanel();
    if (!isJobsPage() && !isChatPage()) {
      window.BossAutoLogInstance?.removeLogPanel();
    }
  }

  function handleUrlChange() {
    if (location.href === lastUrl) return;

    lastUrl = location.href;
    hasRunForUrl = false;
    cleanupRoutePanels();

    if (isJobsPage()) {
      createStatusPanel();
      createSettingsPanel();
      window.BossAutoLogInstance.createLogPanel('jobs');
      window.BossAutoLogInstance.setPage('jobs');
      window.BossAutoLogInstance.attachTo(PANEL_ID);
      aiChat.createAiChatPanel(PANEL_ID);
      setStatus('检测到职位列表页变化，准备触发…');
      runAutomation();
    } else if (isChatPage()) {
      createStatusPanel();
      createChatPanel();
      window.BossAutoLogInstance.createLogPanel('chat');
      window.BossAutoLogInstance.setPage('chat');
      window.BossAutoLogInstance.attachTo(CHAT_PANEL_ID);
      aiChat.createAiChatPanel(CHAT_PANEL_ID);
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
    window.BossAutoLogInstance?.removeLogPanel();
    if (isJobsPage()) {
      createSettingsPanel();
      window.BossAutoLogInstance.createLogPanel('jobs');
      window.BossAutoLogInstance.setPage('jobs');
      window.BossAutoLogInstance.attachTo(PANEL_ID);
      aiChat.createAiChatPanel(PANEL_ID);
      runAutomation();
    } else {
      createChatPanel();
      window.BossAutoLogInstance.createLogPanel('chat');
      window.BossAutoLogInstance.setPage('chat');
      window.BossAutoLogInstance.attachTo(CHAT_PANEL_ID);
      aiChat.createAiChatPanel(CHAT_PANEL_ID);
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
