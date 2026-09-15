(function () {
  'use strict';

  window.BossAutoChat = function createChatModule(context) {
    const {
      CHAT_PANEL_ID, MESSAGE_INTERVAL_MS,
      loadConfig, getMessageRecordKey, hasMessageRecord, saveMessageRecord,
      setStatus, addSettingsButton, isChatPage, randomDelay,
      loadConfigStore, setActiveVersion, setMonitoringState,
    } = context;
    let chatMonitorTimer = null;
    let chatMonitorObserver = null;
    let chatMonitorBodyObserver = null;
    let observedChatList = null;
    let chatMonitorDebounceTimer = null;
    let chatMonitorBusy = false;
    let chatMonitorRunId = 0;
    const chatCardSignatures = new Map();
    const chatProcessingKeys = new Set();

    function versionOptions(store) {
      return store.versions.map((version) => (
        `<option value="${String(version.id).replace(/"/g, '&quot;')}" ${version.id === store.activeVersionId ? 'selected' : ''}>${String(version.name).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]))}</option>`
      )).join('');
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
        #${CHAT_PANEL_ID} .boss-auto-version-select { display: block; width: 100%; height: 36px; margin: 8px 0; padding: 0 9px; color: #243e34; background: #f8faf9; border: 1px solid #e1eae5; border-radius: 9px; font: inherit; }
        #${CHAT_PANEL_ID} button:hover { filter: brightness(.97); }
      `;
      document.head.appendChild(style);
  
      const panel = document.createElement('section');
      panel.id = CHAT_PANEL_ID;
      panel.innerHTML = `
        <div class="chat-panel-header"><h3>聊天监听</h3><div><button type="button" class="chat-collapse" title="收起悬浮窗" aria-label="收起悬浮窗" aria-expanded="true">−</button></div></div>
        <p>模板、图片和在线状态统一在“设置”页面修改；消息间隔固定为 30 毫秒。</p>
        <select class="boss-auto-version-select" aria-label="当前配置版本">${versionOptions(loadConfigStore())}</select>
        <div class="chat-config-summary"></div>
        <button type="button" class="start-chat">开始沟通</button>
      `;
      document.body.appendChild(panel);
      addSettingsButton(panel);
      const versionSelector = panel.querySelector('.boss-auto-version-select');
      versionSelector.addEventListener('change', () => {
        const previous = loadConfig().versionId;
        if (chatMonitorTimer) {
          setStatus('聊天监听运行中，暂时不能切换配置版本', 'error');
          versionSelector.value = previous;
          return;
        }
        try {
          setActiveVersion(versionSelector.value);
          window.dispatchEvent(new Event('boss-auto-config-changed'));
          setStatus(`已切换到配置版本：${loadConfig().versionName}`, 'success');
        } catch (error) {
          versionSelector.value = previous;
          setStatus(`配置版本切换失败：${error.message}`, 'error');
        }
      });
  
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
        versionSelector.innerHTML = versionOptions(loadConfigStore());
        versionSelector.value = current.versionId;
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
      setMonitoringState(true);
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
      setMonitoringState(false);
      chatMonitorObserver = null;
      chatMonitorBodyObserver = null;
      observedChatList = null;
      chatMonitorDebounceTimer = null;
      chatCardSignatures.clear();
      console.info('[Boss Auto] first chat monitor stopped');
    }
  

    return { createChatPanel, startChatMonitor, stopChatMonitor };
  };
})();
