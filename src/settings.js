(function () {
  'use strict';

  window.BossAutoSettings = function createSettingsModule(context) {
    const {
      PANEL_ID, SETTINGS_VIEW_ID, STATUS_ID, STATUS_OPTIONS, MESSAGE_INTERVAL_MS, MAX_CHAT_MESSAGE_LENGTH, AI_MODEL_OPTIONS,
      loadConfig, saveConfig, handleImageFileSelection, setStatus, escapeHtml,
      jobBridge, loadConfigStore, saveConfigStore, setActiveVersion, isConfigSwitchLocked,
    } = context;
    let settingsViewDirty = false;
    let settingsViewStale = false;
    let onlineStatusFieldAvailable = null;

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
  
  
    function addSettingsButton(container) {
      if (!container || container.querySelector('.boss-auto-open-settings')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'boss-auto-open-settings';
      button.textContent = '设置';
      button.addEventListener('click', openSettingsView);
      container.appendChild(button);
    }

    function versionOptions(store) {
      return store.versions.map((version) => (
        `<option value="${escapeHtml(version.id)}" ${version.id === store.activeVersionId ? 'selected' : ''}>${escapeHtml(version.name)}</option>`
      )).join('');
    }

    function aiModelOptions(model) {
      const known = AI_MODEL_OPTIONS.some((option) => option.value === model);
      const selectedModel = known ? model : AI_MODEL_OPTIONS[0].value;
      return AI_MODEL_OPTIONS.map((option) => (
        `<option value="${escapeHtml(option.value)}" ${selectedModel === option.value ? 'selected' : ''}>${escapeHtml(option.text)}</option>`
      )).join('');
    }

    function switchVersion(versionId) {
      if (isConfigSwitchLocked()) {
        setStatus('自动任务运行中，暂时不能切换配置版本', 'error');
        return false;
      }
      try {
        setActiveVersion(versionId);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
        setStatus(`已切换到配置版本：${loadConfig().versionName}`, 'success');
        return true;
      } catch (error) {
        setStatus(`配置版本切换失败：${error.message}`, 'error');
        return false;
      }
    }

    function bindVersionSelector(container) {
      const selector = container?.querySelector('.boss-auto-version-select');
      if (!selector) return;
      selector.addEventListener('change', () => {
        const previous = loadConfig().versionId;
        if (!switchVersion(selector.value)) selector.value = previous;
      });
    }
  
    function openSettingsView() {
      if (!document.body) return;
      const existing = document.getElementById(SETTINGS_VIEW_ID);
      if (existing && existing.hidden && !settingsViewDirty) {
        existing.remove();
        document.getElementById(`${SETTINGS_VIEW_ID}-style`)?.remove();
      }
      if (!document.getElementById(SETTINGS_VIEW_ID)) createSettingsView();
      const view = document.getElementById(SETTINGS_VIEW_ID);
      view.hidden = false;
      view.focus({ preventScroll: true });
    }

    function handleExternalConfigChange(event) {
      if (event.detail?.source !== 'ai-chat') return;
      const view = document.getElementById(SETTINGS_VIEW_ID);
      if (!view) return;
      if (settingsViewDirty) {
        settingsViewStale = true;
        const note = view.querySelector('.boss-auto-save-note');
        if (note) note.textContent = '配置已被 AI 更新，请关闭后重新打开';
        setStatus('AI 已更新配置；当前设置页有未保存修改，已阻止旧表单覆盖', 'error');
        return;
      }

      const wasVisible = !view.hidden;
      view.remove();
      document.getElementById(`${SETTINGS_VIEW_ID}-style`)?.remove();
      createSettingsView();
      const refreshedView = document.getElementById(SETTINGS_VIEW_ID);
      if (refreshedView) refreshedView.hidden = !wasVisible;
      if (wasVisible) setStatus('AI 已更新配置，设置页已同步', 'success');
    }
    window.addEventListener('boss-auto-config-changed', handleExternalConfigChange);
  
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
      settingsViewStale = false;
  
      const config = loadConfig();
      const store = loadConfigStore();
      const style = document.createElement('style');
      style.id = `${SETTINGS_VIEW_ID}-style`;
      style.textContent = `
        #${SETTINGS_VIEW_ID} { position: fixed; inset: 0; z-index: 2147483645; overflow: auto; padding: 32px 20px; background: #f4faf7; color: #203e3b; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-card { max-width: 760px; margin: 0 auto; padding: 24px; background: #fff; border: 1px solid #dcece7; border-radius: 18px; box-shadow: 0 18px 60px rgba(19, 68, 57, .16); }
        #${SETTINGS_VIEW_ID} h2 { margin: 0; font-size: 20px; } #${SETTINGS_VIEW_ID} h3 { margin: 24px 0 10px; font-size: 15px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section { margin-top: 20px; padding: 18px; background: #fbfdfc; border: 1px solid #e8f0eb; border-radius: 14px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section h3 { margin: 0 0 12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section > :last-child { margin-bottom: 0; }
        #${SETTINGS_VIEW_ID} .boss-auto-section-hint { display: block; margin: -3px 0 12px; color: #71857c; font-size: 12px; line-height: 1.6; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; color: #245247; background: #eff8f3; border-radius: 9px; font-weight: 600; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle input { width: 16px; height: 16px; margin: 0; accent-color: #187a64; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-details { margin-top: 14px; padding-top: 4px; border-top: 1px dashed #dcece3; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-subsection { padding: 10px 0 2px; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-subsection + .boss-auto-ai-subsection { margin-top: 14px; padding-top: 14px; border-top: 1px solid #edf3ef; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-subsection h4 { margin: 0 0 8px; color: #245247; font-size: 13px; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin-top: 20px; padding: 12px; background: #f7faf8; border-radius: 10px; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar label { flex: 1 1 220px; margin: 0; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar button { min-height: 34px; padding: 6px 9px; font-size: 12px; }
        #${SETTINGS_VIEW_ID} label { display: block; margin: 12px 0; } #${SETTINGS_VIEW_ID} label > span { display:block; margin-bottom: 5px; font-weight: 600; }
        #${SETTINGS_VIEW_ID} input[type="text"], #${SETTINGS_VIEW_ID} input[type="password"], #${SETTINGS_VIEW_ID} textarea { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #dce8e2; border-radius: 9px; background: #fafcfb; font: inherit; }
        #${SETTINGS_VIEW_ID} textarea { min-height: 72px; resize: vertical; }
        #${SETTINGS_VIEW_ID} .boss-auto-status-options { display: flex; flex-wrap: wrap; gap: 8px 14px; }
        #${SETTINGS_VIEW_ID} .boss-auto-status-options label { margin: 0; font-weight: 400; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-row { display: grid; grid-template-columns: 92px 1fr auto auto; gap: 8px; align-items: start; margin: 10px 0; padding: 10px; background: #f7faf8; border-radius: 10px; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-row select, #${SETTINGS_VIEW_ID} button { min-height: 36px; padding: 7px 11px; border: 1px solid #d5e5dd; border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
        #${SETTINGS_VIEW_ID} .boss-auto-image-picker { display: inline-flex; align-items: center; min-height: 36px; margin: 0; padding: 0 11px; color: #187a64; border: 1px solid #d5e5dd; border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
        #${SETTINGS_VIEW_ID} .boss-auto-image-picker input[type="file"] { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
        #${SETTINGS_VIEW_ID} .boss-auto-image-preview { display: block; width: 96px; height: 72px; margin-top: 8px; object-fit: cover; border: 1px solid #dce8e2; border-radius: 8px; background: #f7faf8; }
        #${SETTINGS_VIEW_ID} .boss-auto-image-name { display: block; margin-top: 5px; color: #71857c; font-size: 12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
        #${SETTINGS_VIEW_ID} .boss-auto-save-settings { color: #fff; background: #187a64; border-color: #187a64; }
        @media (max-width: 600px) { #${SETTINGS_VIEW_ID} { padding: 12px; } #${SETTINGS_VIEW_ID} .boss-auto-settings-card { padding: 16px; } #${SETTINGS_VIEW_ID} .boss-auto-message-row { grid-template-columns: 1fr; } }
        #${SETTINGS_VIEW_ID} { z-index:2147483646; padding:32px; overflow:hidden; background:rgba(227,237,237,.86); backdrop-filter:blur(8px); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; color-scheme:light; }
        #${SETTINGS_VIEW_ID}[hidden] { display:none; }
        body:has(#${SETTINGS_VIEW_ID}:not([hidden])) #${STATUS_ID} { bottom:90px; }
        #${SETTINGS_VIEW_ID}, #${SETTINGS_VIEW_ID} * { box-sizing:border-box; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-card { display:grid; grid-template-columns:176px minmax(0,1fr); grid-template-rows:82px minmax(0,1fr) 72px; width:100%; max-width:1060px; height:calc(100dvh - 64px); max-height:840px; padding:0; overflow:hidden; border-color:#d0e2dd; border-radius:20px; box-shadow:0 28px 90px #20433c26; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-head { grid-column:1 / -1; padding:20px 26px; background:linear-gradient(110deg,#edf9f4,#f8fbfc); border-bottom:1px solid #e2eeea; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-head h2 { color:#1d453f; font-size:19px; letter-spacing:.2px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-head p { margin:4px 0 0; color:#829994; font-size:11px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-nav { grid-column:1; grid-row:2; padding:24px 12px; background:#f6faf8; border-right:1px solid #e8f0ed; }
        #${SETTINGS_VIEW_ID} .boss-auto-nav-caption { padding:0 12px 14px; color:#96a7a2; font-size:10px; letter-spacing:2px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-nav button { display:flex; align-items:center; gap:10px; width:100%; margin-bottom:6px; padding:12px; border:1px solid transparent; background:transparent; color:#6d8780; text-align:left; font-size:12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-nav button span { font-size:10px; color:#9bafa8; font-variant-numeric:tabular-nums; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-nav button[aria-selected="true"] { color:#108674; background:#e5f3ec; border-color:#d3e9de; font-weight:650; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-content { grid-column:2; grid-row:2; overflow:auto; padding:22px 26px 28px; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#cadbd3 transparent; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar { margin:0 0 22px; padding:12px; gap:6px; background:#f5f9f7; border:1px solid #e5eeea; border-radius:12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar label { flex-basis:180px; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar label span { font-size:10px; color:#7c938b; }
        #${SETTINGS_VIEW_ID} .boss-auto-version-toolbar button { min-height:34px; font-size:11px; padding:6px 8px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section { margin:0 0 18px; padding:20px; border:1px solid #e1ece7; background:#fff; border-radius:13px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section[hidden] { display:none; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section h3 { display:flex; align-items:center; gap:9px; margin:0 0 10px; color:#294f43; font-size:14px; }
        #${SETTINGS_VIEW_ID} .boss-auto-settings-section h3::before { content:''; width:4px; height:14px; border-radius:2px; background:#66b99c; }
        #${SETTINGS_VIEW_ID} .boss-auto-section-hint { margin:0 0 16px; color:#8b9c96; font-size:11px; }
        #${SETTINGS_VIEW_ID} label { margin:14px 0; font-size:12px; }
        #${SETTINGS_VIEW_ID} label > span { margin-bottom:7px; color:#546e63; font-size:12px; font-weight:550; }
        #${SETTINGS_VIEW_ID} :is(input[type="text"],input[type="password"],textarea,select) { width:100%; min-width:0; min-height:39px; padding:9px 12px; color:#294b40; background:#f9fbfa; border:1px solid #dce8e1; border-radius:8px; outline:none; font:inherit; font-size:12px; line-height:1.6; transition:border-color .15s,box-shadow .15s; }
        #${SETTINGS_VIEW_ID} :is(input,textarea,select):focus { border-color:#66b89a; box-shadow:0 0 0 3px #e6f5ed; background:#fff; }
        #${SETTINGS_VIEW_ID} :is(input,textarea)::placeholder { color:#a1afa8; }
        #${SETTINGS_VIEW_ID} textarea { min-height:100px; line-height:1.8; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle { justify-content:space-between; flex-direction:row-reverse; padding:12px 14px; margin-bottom:12px; color:#32725b; font-size:12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle input { appearance:none; flex-shrink:0; width:34px; height:20px; padding:2px; border:0; border-radius:12px; background:#c8d7cf; cursor:pointer; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle input::before { content:''; display:block; width:16px; height:16px; border-radius:50%; background:white; box-shadow:0 1px 3px #234d3420; transition:transform .15s; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle input:checked { background:#21a182; }
        #${SETTINGS_VIEW_ID} .boss-auto-ai-toggle input:checked::before { transform:translateX(14px); }
        #${SETTINGS_VIEW_ID} .boss-auto-status-options, #${SETTINGS_VIEW_ID} .boss-auto-status-checkboxes { display:flex; flex-wrap:wrap; gap:8px; }
        #${SETTINGS_VIEW_ID} .boss-auto-status-options label { display:flex; align-items:center; gap:5px; padding:7px 10px; border:1px solid #e2ebe5; border-radius:7px; color:#769082; font-size:11px; cursor:pointer; }
        #${SETTINGS_VIEW_ID} .boss-auto-status-options label:has(:checked) { border-color:#bbdccb; background:#eff8f3; color:#268465; }
        #${SETTINGS_VIEW_ID} input:is([type="checkbox"],[type="radio"]) { accent-color:#159778; }
        #${SETTINGS_VIEW_ID} .boss-auto-status-capability { display:block; margin-top:10px; color:#9baaa3; font-size:10px; }
        #${SETTINGS_VIEW_ID} button { color:#607b6d; font-size:12px; transition:background .15s,border-color .15s; }
        #${SETTINGS_VIEW_ID} button:hover { background:#f0f8f3; border-color:#bcd8c8; }
        #${SETTINGS_VIEW_ID} button:focus-visible { outline:2px solid #54aa89; outline-offset:2px; }
        #${SETTINGS_VIEW_ID} :is(.boss-auto-delete-version,.remove-message) { color:#ba7a6e; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-row { background:#f7faf8; border:1px solid #e7eee9; gap:8px; padding:12px; grid-template-columns:72px minmax(0,1fr) 34px 48px; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-row button { padding:5px 7px; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-row select { padding:7px; }
        #${SETTINGS_VIEW_ID} .boss-auto-message-list:empty::before { content:'还没有消息模板，添加第一条打招呼内容吧。'; display:block; padding:30px 16px; margin-bottom:14px; border:1px dashed #d7e6dc; border-radius:10px; color:#91a69a; text-align:center; font-size:12px; }
        #${SETTINGS_VIEW_ID} .boss-auto-actions { grid-column:1 / -1; grid-row:3; align-items:center; margin:0; padding:14px 26px; border-top:1px solid #e5eee8; background:#fff; }
        #${SETTINGS_VIEW_ID} .boss-auto-save-note { margin-right:auto; color:#94a49a; font-size:11px; }
        #${SETTINGS_VIEW_ID} .boss-auto-actions button { min-width:88px; }
        #${SETTINGS_VIEW_ID} .boss-auto-save-settings { color:#fff; background:#108674; border-color:#108674; box-shadow:0 3px 8px #1086741f; }
        #${SETTINGS_VIEW_ID} .boss-auto-save-settings:hover { background:#0b7565; }
        @media(max-width:700px) {
          #${SETTINGS_VIEW_ID} { padding:10px; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-card { height:calc(100dvh - 20px); max-height:none; grid-template-columns:minmax(0,1fr); grid-template-rows:74px 56px minmax(0,1fr) 68px; border-radius:14px; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-head { padding:14px 16px; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-nav { grid-column:1; grid-row:2; display:flex; gap:4px; padding:7px 10px; border:0; }
          #${SETTINGS_VIEW_ID} .boss-auto-nav-caption, #${SETTINGS_VIEW_ID} .boss-auto-settings-nav button span { display:none; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-nav button { justify-content:center; padding:8px; margin:0; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-content { grid-column:1; grid-row:3; padding:14px; }
          #${SETTINGS_VIEW_ID} .boss-auto-settings-section { padding:15px; }
          #${SETTINGS_VIEW_ID} .boss-auto-actions { grid-row:4; padding:12px 14px; }
          #${SETTINGS_VIEW_ID} .boss-auto-save-note { font-size:10px; max-width:110px; }
          #${SETTINGS_VIEW_ID} .boss-auto-message-row { grid-template-columns:minmax(0,1fr); }
        }
        @media(prefers-reduced-motion:reduce) { #${SETTINGS_VIEW_ID} * { transition:none !important; } }
      `;
      document.head.appendChild(style);
  
      const view = document.createElement('section');
      view.id = SETTINGS_VIEW_ID;
      view.hidden = true;
      view.tabIndex = -1;
      view.setAttribute('aria-label', 'Boss Auto 设置');
      view.innerHTML = `
        <div class="boss-auto-settings-card">
          <div class="boss-auto-settings-head"><div><h2>偏好设置</h2><p>Boss Auto · 为你的下一份工作，做好准备</p></div><button type="button" class="boss-auto-close-settings" data-confirm-discard="true">返回工作台</button></div>
          <div class="boss-auto-version-toolbar">
            <label><span>当前配置版本</span><select class="boss-auto-version-select">${versionOptions(store)}</select></label>
            <button type="button" class="boss-auto-new-version">新建版本</button>
            <button type="button" class="boss-auto-copy-version">复制版本</button>
            <button type="button" class="boss-auto-rename-version">重命名</button>
            <button type="button" class="boss-auto-delete-version">删除版本</button>
          </div>
          <div class="boss-auto-settings-section boss-auto-global-ai-section">
            <h3>AI 接入配置（全局共用）</h3>
            <span class="boss-auto-section-hint">接口地址、模型和 API Key 不属于配置版本；切换配置版本时保持不变。</span>
            <label><span>AI 接口地址</span><input type="text" name="aiEndpoint" value="${escapeHtml(config.aiEndpoint)}" placeholder="例如：https://api.deepseek.com/chat/completions"></label>
            <label><span>模型选择</span><select name="aiModel">${aiModelOptions(config.aiModel)}</select></label>
              <label><span>API Key</span><input type="password" name="aiApiKey" value="${escapeHtml(config.aiApiKey)}" placeholder="仅保存在当前浏览器"></label>
          </div>
          <div class="boss-auto-settings-section">
            <h3>职位筛选</h3>
            <span class="boss-auto-section-hint">用于从职位列表中筛选符合方向的岗位，多个条件用 “-” 分隔。</span>
            <label><span>职位关键词</span><input type="text" name="keywords" value="${escapeHtml(config.keywords)}"></label>
            <label><span>工作地点</span><input type="text" name="locations" value="${escapeHtml(config.locations)}"></label>
            <label><span>屏蔽词</span><input type="text" name="blockedWords" value="${escapeHtml(config.blockedWords)}"></label>
          </div>
          <div class="boss-auto-settings-section">
            <h3>招聘者在线状态</h3>
            <span class="boss-auto-section-hint">只处理指定活跃状态的招聘者；选择“不限”表示不进行状态筛选。</span>
            <div class="boss-auto-status-options"><label><input type="radio" name="onlineStatusMode" value="不限" ${config.onlineStatusMode === '不限' ? 'checked' : ''}> 不限</label><span class="boss-auto-status-checkboxes"></span></div>
            <small class="boss-auto-status-capability">${onlineStatusFieldAvailable === false ? '当前页面不支持在线状态筛选' : '在线状态将在职位详情加载后确认'}</small>
            <label><span>未知状态</span><select name="unknownOnlineStatusPolicy"><option value="skip">跳过职位</option><option value="keep">允许继续</option></select></label>
          </div>
          <div class="boss-auto-settings-section">
            <h3>AI 职位判别</h3>
            <label class="boss-auto-ai-toggle"><input type="checkbox" name="aiEnabled" ${config.aiEnabled ? 'checked' : ''}> 启用 AI 判别</label>
            <span class="boss-auto-section-hint">打开职位详情后，系统会把已读取的岗位信息和下方提示词发送给 AI，作为是否点击“立即沟通”的判断因素。</span>
            <div class="boss-auto-ai-details">
              <div class="boss-auto-ai-subsection">
                <h4>AI 判别规则（当前配置版本）</h4>
                <label><span>简历提示词</span><textarea name="resumePrompt" placeholder="描述求职者的经历、技能、期望或其他需要 AI 参考的信息。">${escapeHtml(config.resumePrompt)}</textarea></label>
                <label><span>判断提示词</span><textarea name="aiPrompt" placeholder="请根据岗位信息判断是否适合我。">${escapeHtml(config.aiPrompt)}</textarea></label>
                <label><span>AI 调用失败时</span><select name="aiFailurePolicy"><option value="skip" ${config.aiFailurePolicy === 'skip' ? 'selected' : ''}>跳过职位</option><option value="keep" ${config.aiFailurePolicy === 'keep' ? 'selected' : ''}>允许继续</option></select></label>
              </div>
            </div>
          </div>
          <div class="boss-auto-settings-section">
            <h3>多轮聊天消息</h3>
            <span class="boss-auto-section-hint">按保存顺序发送，支持文字和图片消息。</span>
            <div class="boss-auto-message-list"></div>
            <button type="button" class="boss-auto-add-text">+ 添加文字</button>
            <button type="button" class="boss-auto-add-image">+ 添加图片</button>
          </div>
          <div class="boss-auto-actions"><span class="boss-auto-save-note" role="status">配置仅保存在当前浏览器</span><button type="button" class="boss-auto-close-settings">取消</button><button type="button" class="boss-auto-save-settings">保存设置</button></div>
        </div>
      `;
      document.body.appendChild(view);
      const card = view.querySelector('.boss-auto-settings-card');
      const content = document.createElement('div');
      content.className = 'boss-auto-settings-content';
      content.appendChild(view.querySelector('.boss-auto-version-toolbar'));
      const sections = [...view.querySelectorAll('.boss-auto-settings-section')];
      const nav = document.createElement('div');
      nav.className = 'boss-auto-settings-nav';
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', '设置分类');
      nav.innerHTML = '<div class="boss-auto-nav-caption">PREFERENCES</div>';
      const groups = [
        { title: '求职偏好', sections: [1, 2] },
        { title: 'AI 助手', sections: [0, 3] },
        { title: '聊天消息', sections: [4] },
      ];
      groups.forEach((group, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.id = `${SETTINGS_VIEW_ID}-tab-${index}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `${SETTINGS_VIEW_ID}-group-${index}`);
        tab.innerHTML = `<span>0${index + 1}</span>${group.title}`;
        const pane = document.createElement('div');
        pane.id = `${SETTINGS_VIEW_ID}-group-${index}`;
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', tab.id);
        group.sections.forEach((position) => pane.appendChild(sections[position]));
        content.appendChild(pane);
        nav.appendChild(tab);
        tab.addEventListener('click', () => {
          nav.querySelectorAll('[role="tab"]').forEach((button) => {
            const selected = button === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            view.querySelector(`#${button.getAttribute('aria-controls')}`).hidden = !selected;
          });
          content.scrollTop = 0;
        });
        tab.addEventListener('keydown', (event) => {
          if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? 2 : 1)) % 3;
          const button = nav.querySelectorAll('button')[next];
          button.click();
          button.focus();
        });
      });
      card.append(nav, content);
      nav.querySelector('button').click();
      const recreateVersionView = () => {
        settingsViewDirty = false;
        settingsViewStale = false;
        view.remove();
        document.getElementById(`${SETTINGS_VIEW_ID}-style`)?.remove();
        createSettingsView();
        document.getElementById(SETTINGS_VIEW_ID).hidden = false;
      };
      view.querySelector('.boss-auto-version-select').addEventListener('change', (event) => {
        const selector = event.currentTarget;
        const previous = loadConfig().versionId;
        if (settingsViewDirty && !window.confirm('当前版本有未保存修改，确定切换并放弃修改吗？')) {
          selector.value = previous;
          return;
        }
        if (switchVersion(selector.value)) recreateVersionView();
        else selector.value = previous;
      });
      view.querySelector('[name="aiModel"]').addEventListener('change', (event) => {
        markSettingsDirty();
      });
      view.querySelector('.boss-auto-new-version').addEventListener('click', () => {
        if (isConfigSwitchLocked()) { setStatus('自动任务运行中，暂时不能切换配置版本', 'error'); return; }
        const name = window.prompt('请输入配置版本名称', `配置 ${loadConfigStore().versions.length + 1}`)?.trim();
        if (!name) return;
        const current = loadConfig();
        const id = `version-${Date.now()}`;
        const storeNow = loadConfigStore();
        storeNow.versions.push({ ...current, id, name, versionId: undefined, versionName: undefined });
        storeNow.activeVersionId = id;
        saveConfigStore(storeNow);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
        setStatus(`已新建配置版本：${name}`, 'success');
        recreateVersionView();
      });
      view.querySelector('.boss-auto-copy-version').addEventListener('click', () => {
        if (isConfigSwitchLocked()) { setStatus('自动任务运行中，暂时不能切换配置版本', 'error'); return; }
        const current = loadConfig();
        const name = window.prompt('请输入复制版本名称', `${current.versionName} 副本`)?.trim();
        if (!name) return;
        const id = `version-${Date.now()}`;
        const storeNow = loadConfigStore();
        storeNow.versions.push({ ...current, id, name, versionId: undefined, versionName: undefined });
        storeNow.activeVersionId = id;
        saveConfigStore(storeNow);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
        setStatus(`已复制配置版本：${name}`, 'success');
        recreateVersionView();
      });
      view.querySelector('.boss-auto-rename-version').addEventListener('click', () => {
        if (isConfigSwitchLocked()) { setStatus('自动任务运行中，暂时不能修改配置版本', 'error'); return; }
        const current = loadConfig();
        const name = window.prompt('请输入新的版本名称', current.versionName)?.trim();
        if (!name) return;
        const storeNow = loadConfigStore();
        const target = storeNow.versions.find((version) => version.id === storeNow.activeVersionId);
        if (target) target.name = name;
        saveConfigStore(storeNow);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
        setStatus(`已重命名配置版本：${name}`, 'success');
        recreateVersionView();
      });
      view.querySelector('.boss-auto-delete-version').addEventListener('click', () => {
        if (isConfigSwitchLocked()) { setStatus('自动任务运行中，暂时不能删除配置版本', 'error'); return; }
        const storeNow = loadConfigStore();
        if (storeNow.versions.length <= 1) { setStatus('至少需要保留一个配置版本', 'error'); return; }
        const current = loadConfig();
        if (!window.confirm(`确定删除配置版本“${current.versionName}”吗？`)) return;
        storeNow.versions = storeNow.versions.filter((version) => version.id !== storeNow.activeVersionId);
        storeNow.activeVersionId = storeNow.versions[0].id;
        saveConfigStore(storeNow);
        window.dispatchEvent(new Event('boss-auto-config-changed'));
        setStatus(`已删除配置版本：${current.versionName}`, 'success');
        recreateVersionView();
      });
      const markSettingsDirty = () => {
        settingsViewDirty = true;
        view.querySelector('.boss-auto-save-note').textContent = '有未保存的修改';
      };
      view.addEventListener('input', markSettingsDirty);
      const aiToggle = view.querySelector('[name="aiEnabled"]');
      const aiDetails = view.querySelector('.boss-auto-ai-details');
      const updateAiDetailsVisibility = () => { aiDetails.hidden = !aiToggle.checked; };
      updateAiDetailsVisibility();
      aiToggle.addEventListener('change', () => {
        updateAiDetailsVisibility();
        markSettingsDirty();
      });
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
            if (message.content) {
              const preview = document.createElement('img');
              preview.className = 'boss-auto-image-preview';
              preview.src = message.content;
              preview.alt = message.name || '图片预览';
              content.appendChild(preview);
            }
            row.querySelector('.message-image').addEventListener('change', (event) => {
              const file = event.target.files?.[0];
              markSettingsDirty();
              handleImageFileSelection(file, message, renderMessages);
            });
          } else {
            content.innerHTML = `<textarea class="message-text" maxlength="${MAX_CHAT_MESSAGE_LENGTH}" placeholder="输入消息（最多 ${MAX_CHAT_MESSAGE_LENGTH} 字）">${escapeHtml(message.content || '')}</textarea>`;
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
      const closeSettingsView = (confirmDiscard = false) => {
        if (confirmDiscard && settingsViewDirty && !window.confirm('设置尚未保存，确定放弃修改吗？')) return;
        settingsViewDirty = false;
        view.hidden = true;
      };
      view.querySelectorAll('.boss-auto-close-settings').forEach((button) => button.addEventListener('click', () => {
        closeSettingsView(button.dataset.confirmDiscard === 'true');
      }));
      view.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeSettingsView(false);
      });
      view.querySelector('[name="onlineStatusMode"]').addEventListener('change', (event) => {
        if (event.target.checked) view.querySelectorAll('[name="selectedOnlineStatuses"]').forEach((item) => { item.checked = false; });
        markSettingsDirty();
      });
      view.querySelectorAll('[name="selectedOnlineStatuses"]').forEach((item) => item.addEventListener('change', () => {
        if (item.checked) view.querySelector('[name="onlineStatusMode"]').checked = false;
        markSettingsDirty();
      }));
      view.querySelectorAll('input[type="text"], input[type="password"], input[type="checkbox"], select:not(.boss-auto-version-select), textarea').forEach((input) => input.addEventListener('change', markSettingsDirty));
      view.querySelector('.boss-auto-save-settings').addEventListener('click', () => {
        if (settingsViewStale) {
          setStatus('配置已被 AI 更新，请关闭设置页后重新打开，避免覆盖新配置', 'error');
          return;
        }
        const unlimited = view.querySelector('[name="onlineStatusMode"]').checked;
        const selected = [...view.querySelectorAll('[name="selectedOnlineStatuses"]:checked')].map((item) => item.value);
        if (!unlimited && !selected.length) { setStatus('请至少选择一个在线状态，或选择“不限”', 'error'); return; }
        if (!unlimited && onlineStatusFieldAvailable === false) { setStatus('当前页面没有在线状态字段，只能选择“不限”', 'error'); return; }
        const invalidMessage = messages.find((message) => !message.content || (message.type === 'text' && !message.content.trim()));
        if (invalidMessage) { setStatus('请补全所有文字消息或图片消息', 'error'); return; }
        const oversizedMessageIndex = messages.findIndex((message) => (
          message.type !== 'image' && message.content.trim().length > MAX_CHAT_MESSAGE_LENGTH
        ));
        if (oversizedMessageIndex >= 0) {
          setStatus(`第 ${oversizedMessageIndex + 1} 条文字消息超过 ${MAX_CHAT_MESSAGE_LENGTH} 字限制`, 'error');
          return;
        }
        const selectedAiModel = view.querySelector('[name="aiModel"]').value;
        if (view.querySelector('[name="aiEnabled"]').checked) {
          const missingAiField = [
            ['aiEndpoint', 'AI 接口地址'], ['aiApiKey', 'API Key'],
            ['aiPrompt', '判断提示词'],
          ].find(([name]) => !view.querySelector(`[name="${name}"]`).value.trim());
          if (!selectedAiModel) { setStatus('启用 AI 判别后请填写模型名称', 'error'); return; }
          if (missingAiField) { setStatus(`启用 AI 判别后请填写${missingAiField[1]}`, 'error'); return; }
        }
        const next = {
          ...loadConfig(),
          schemaVersion: 2,
          keywords: view.querySelector('[name="keywords"]').value.trim(),
          locations: view.querySelector('[name="locations"]').value.trim(),
          blockedWords: view.querySelector('[name="blockedWords"]').value.trim(),
          onlineStatusMode: unlimited ? '不限' : '状态筛选',
          selectedOnlineStatuses: unlimited ? [] : selected,
          unknownOnlineStatusPolicy: view.querySelector('[name="unknownOnlineStatusPolicy"]').value,
          aiEnabled: view.querySelector('[name="aiEnabled"]').checked,
          aiEndpoint: view.querySelector('[name="aiEndpoint"]').value.trim(),
          aiModel: selectedAiModel,
          aiApiKey: view.querySelector('[name="aiApiKey"]').value.trim(),
          resumePrompt: view.querySelector('[name="resumePrompt"]').value.trim(),
          aiPrompt: view.querySelector('[name="aiPrompt"]').value.trim(),
          aiFailurePolicy: view.querySelector('[name="aiFailurePolicy"]').value,
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
          <div class="boss-auto-intro"><span>投递设置</span><small>当前方案</small></div>
          <p class="boss-auto-description">确认你的求职偏好，让每一次投递更合适。</p>
          <label>
            <span>配置版本</span>
            <select class="boss-auto-version-select" style="display:block;width:100%;height:42px;padding:0 12px;border:1px solid #e1eae5;border-radius:10px;color:#243e34;background:#f8faf9;font:inherit;">
              ${versionOptions(loadConfigStore())}
            </select>
          </label>
          <label>
            <span>职位关键词</span>
            <input name="keywords" value="${escapeHtml(config.keywords)}" placeholder="例如：前端-React-Node.js" readonly aria-readonly="true">
          </label>
          <label>
            <span>工作地包含</span>
            <input name="locations" value="${escapeHtml(config.locations)}" placeholder="例如：上海-杭州-远程" readonly aria-readonly="true">
          </label>
          <label>
            <span>屏蔽词</span>
            <input name="blockedWords" value="${escapeHtml(config.blockedWords)}" placeholder="例如：销售-客服-外包" readonly aria-readonly="true">
          </label>
          <div class="boss-auto-hint">留空表示不限 · 点击下方设置修改条件</div>
          <button type="button" class="boss-auto-start">开始投递</button>
          <div class="boss-auto-footer">配置保存在当前浏览器</div>
        </div>
      `;
      document.body.appendChild(panel);
      addSettingsButton(panel.querySelector('.boss-auto-panel-body'));
      bindVersionSelector(panel);
      window.addEventListener('boss-auto-config-changed', () => {
        const current = loadConfig();
        const selector = panel.querySelector('.boss-auto-version-select');
        if (selector) selector.innerHTML = versionOptions(loadConfigStore());
        if (selector) selector.value = current.versionId;
        ['keywords', 'locations', 'blockedWords'].forEach((name) => {
          const input = panel.querySelector(`[name="${name}"]`);
          if (input) input.value = current[name];
        });
      });
  
      const header = panel.querySelector('.boss-auto-panel-header');
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;
  
      const startDragging = (event) => {
        const target = event.target;
        const interactive = target?.closest?.('button, input, textarea, select, a, label, .boss-auto-log-list, .boss-auto-ai-chat-list');
        const rect = panel.getBoundingClientRect();
        const inResizeHandle = event.clientX >= rect.right - 20 && event.clientY >= rect.bottom - 20;
        if (event.button !== 0 || !header.contains(target) || interactive || inResizeHandle) return;

        dragging = true;
        dragOffsetX = event.clientX - rect.left;
        dragOffsetY = event.clientY - rect.top;
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.setPointerCapture(event.pointerId);
        header.classList.add('dragging');
      };
      panel.addEventListener('pointerdown', startDragging);
  
      panel.addEventListener('pointermove', (event) => {
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
      panel.addEventListener('pointerup', stopDragging);
      panel.addEventListener('pointercancel', stopDragging);
  
      panel.querySelector('.boss-auto-start').addEventListener('click', () => {
        const button = panel.querySelector('.boss-auto-start');
        const deliveryState = jobBridge.getState();
        if (deliveryState.paginationRunning || deliveryState.deliveryRunning || deliveryState.deliveryPaused) {
          const paused = jobBridge.togglePause();
          button.textContent = paused ? '继续投递' : '暂停投递';
          setStatus(paused ? '投递已暂停，当前步骤完成后等待继续' : '投递已继续');
          return;
        }
        jobBridge.startDelivery();
      });
  
      panel.querySelector('.boss-auto-collapse').addEventListener('click', (event) => {
        const collapsed = panel.classList.toggle('collapsed');
        event.currentTarget.textContent = collapsed ? '+' : '−';
        event.currentTarget.setAttribute('aria-label', collapsed ? '展开面板' : '收起面板');
        event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
      });
    }
  

    return {
      getConfig,
      addSettingsButton,
      openSettingsView,
      updateOnlineStatusCapability,
      createSettingsView,
      createSettingsPanel,
      reset() { settingsViewDirty = false; },
    };
  };
})();
