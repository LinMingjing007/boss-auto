(function () {
  'use strict';

  window.BossAutoSettings = function createSettingsModule(context) {
    const {
      PANEL_ID, SETTINGS_VIEW_ID, STATUS_OPTIONS, MESSAGE_INTERVAL_MS,
      loadConfig, saveConfig, handleImageFileSelection, setStatus, escapeHtml,
      jobBridge,
    } = context;
    let settingsViewDirty = false;
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
