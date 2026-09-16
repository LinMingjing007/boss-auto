(function () {
  'use strict';

  window.BossAutoAiChat = function createAiChatModule(context) {
    const {
      AI_CHAT_PANEL_ID, AI_REQUEST_TIMEOUT_MS, loadConfig, setStatus, escapeHtml,
    } = context;
    let panel = null;
    let targetId = null;
    let messages = [];
    let busy = false;

    function addLog(message, type = 'info') {
      window.BossAutoLogInstance?.add(message, type);
    }

    function renderMessages() {
      const list = panel?.querySelector('.boss-auto-ai-chat-list');
      if (!list) return;
      list.innerHTML = messages.length ? messages.map((message) => (
        `<div class="boss-auto-ai-chat-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>`
      )).join('') : '<div class="boss-auto-ai-chat-empty">输入问题，开始和 AI 对话</div>';
      list.scrollTop = list.scrollHeight;
    }

    function positionPanel() {
      if (!panel) return;
      if (panel.classList.contains('integrated')) {
        panel.style.top = '';
        panel.style.left = '';
        return;
      }
      const target = targetId && document.getElementById(targetId);
      const panelWidth = panel.getBoundingClientRect().width || 320;
      if (target) {
        const rect = target.getBoundingClientRect();
        panel.style.top = `${Math.max(12, rect.top)}px`;
        panel.style.left = `${Math.max(12, rect.left - panelWidth - 12)}px`;
      } else {
        panel.style.top = '84px';
        panel.style.left = '12px';
      }
    }

    function clearConversation() {
      messages = [];
      renderMessages();
      addLog('已清空 AI 对话');
    }

    function toggleCollapsed() {
      const collapsed = panel.classList.toggle('collapsed');
      const button = panel.querySelector('.boss-auto-ai-chat-collapse');
      button.textContent = collapsed ? '+' : '−';
      button.title = collapsed ? '展开 AI 对话' : '收起 AI 对话';
      button.setAttribute('aria-label', collapsed ? '展开 AI 对话' : '收起 AI 对话');
      button.setAttribute('aria-expanded', String(!collapsed));
      panel.parentElement?.classList.toggle('ai-collapsed', collapsed);
    }

    async function sendMessage() {
      if (busy) return;
      const input = panel?.querySelector('.boss-auto-ai-chat-input');
      const sendButton = panel?.querySelector('.boss-auto-ai-chat-send');
      const content = input?.value.trim();
      if (!content) return;
      const config = loadConfig();
      if (!config.aiEndpoint || !config.aiModel || !config.aiApiKey) {
        setStatus('请先在设置中完善 AI 接口、模型和 API Key', 'error');
        addLog('AI 对话失败：AI 配置不完整', 'error');
        return;
      }

      messages.push({ role: 'user', content });
      input.value = '';
      renderMessages();
      busy = true;
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = '发送中…';
      }
      addLog(`AI 对话：${content.slice(0, 80)}`);

      const systemContext = [
        '你是求职助手，请用中文回答用户问题。',
        config.resumePrompt,
        config.aiPrompt,
      ].filter(Boolean).join('\n\n');
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      try {
        const isDeepSeek = /deepseek/i.test(`${config.aiEndpoint} ${config.aiModel}`);
        const response = await fetch(config.aiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.aiApiKey}`,
          },
          body: JSON.stringify({
            model: config.aiModel,
            temperature: 0.2,
            max_tokens: 1024,
            ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}),
            messages: [
              { role: 'system', content: systemContext },
              ...messages.map((item) => ({ role: item.role, content: item.content })),
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`AI 接口 HTTP ${response.status}`);
        const data = await response.json();
        const answer = data?.choices?.[0]?.message?.content;
        if (!answer) throw new Error('AI 接口未返回内容');
        messages.push({ role: 'assistant', content: String(answer).trim() });
        renderMessages();
        addLog('AI 对话回复成功', 'success');
      } catch (error) {
        if (messages.at(-1)?.role === 'user' && messages.at(-1).content === content) messages.pop();
        renderMessages();
        const message = error.name === 'AbortError' ? 'AI 请求超时' : error.message;
        setStatus(`AI 对话失败：${message}`, 'error');
        addLog(`AI 对话失败：${message}`, 'error');
      } finally {
        window.clearTimeout(timer);
        busy = false;
        if (sendButton) {
          sendButton.disabled = false;
          sendButton.textContent = '发送';
        }
      }
    }

    function bindDragging() {
      let dragging = false;
      let offsetX = 0;
      let offsetY = 0;
      const header = panel.querySelector('.boss-auto-ai-chat-header');
      const start = (event) => {
        if (panel.classList.contains('integrated')) return;
        const target = event.target;
        const interactive = target?.closest?.('button, input, textarea, select, a, label, .boss-auto-ai-chat-list');
        const rect = panel.getBoundingClientRect();
        const inResizeHandle = event.clientX >= rect.right - 20 && event.clientY >= rect.bottom - 20;
        if (interactive || inResizeHandle) return;
        dragging = true;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.setPointerCapture(event.pointerId);
        header.classList.add('dragging');
      };
      const move = (event) => {
        if (!dragging) return;
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.min(Math.max(0, event.clientX - offsetX), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, event.clientY - offsetY), maxTop)}px`;
      };
      const stop = () => {
        dragging = false;
        header.classList.remove('dragging');
      };
      panel.addEventListener('pointerdown', start);
      panel.addEventListener('pointermove', move);
      panel.addEventListener('pointerup', stop);
      panel.addEventListener('pointercancel', stop);
    }

    function createAiChatPanel(nextTargetId) {
      targetId = nextTargetId;
      if (panel?.isConnected) {
        attachTo(nextTargetId);
        positionPanel();
        return;
      }
      const style = document.createElement('style');
      style.id = `${AI_CHAT_PANEL_ID}-style`;
      style.textContent = `
        #${AI_CHAT_PANEL_ID} { position:fixed; top:84px; left:12px; z-index:2147483645; display:flex; flex-direction:column; width:320px; height:430px; max-width:calc(100vw - 24px); max-height:calc(100vh - 24px); min-width:260px; min-height:260px; resize:both; overflow:hidden; padding:0; color:#203e3b; background:#fff; border:1px solid #dcece7; border-radius:16px; box-shadow:0 12px 40px rgba(19,68,57,.18); font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        #${AI_CHAT_PANEL_ID}.integrated { position:relative; top:auto; left:auto; z-index:auto; width:auto; height:auto; min-width:0; min-height:0; max-width:none; max-height:none; resize:none; border:0; border-radius:0; box-shadow:none; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed { width:42px; min-width:42px; height:100%; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-list, #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-footer { display:none; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-clear { display:none; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-header { height:100%; min-height:180px; padding:10px 5px; flex-direction:column; gap:7px; justify-content:flex-start; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-title { writing-mode:vertical-rl; font-size:11px; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-collapse { margin-top:auto; }
        #${AI_CHAT_PANEL_ID} * { box-sizing:border-box; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; color:#164d43; background:linear-gradient(120deg,#e5f7ef,#f4faf7); border-bottom:1px solid #e4efe9; cursor:grab; user-select:none; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header.dragging { cursor:grabbing; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-title { font-weight:700; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header > div { display:flex; gap:5px; }
        #${AI_CHAT_PANEL_ID} button { border:1px solid #d5e5dd; border-radius:7px; cursor:pointer; font:inherit; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-clear { padding:4px 7px; color:#426e62; background:#fff; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-list { flex:1; overflow:auto; display:flex; flex-direction:column; gap:8px; padding:12px; background:#fbfdfc; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-empty { margin:auto; color:#8b9b94; text-align:center; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message { max-width:88%; padding:8px 10px; border-radius:10px; word-break:break-word; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message.is-user { align-self:flex-end; color:#fff; background:#187a64; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message.is-assistant { align-self:flex-start; color:#29483d; background:#eef8f3; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-footer { display:flex; gap:7px; padding:10px; border-top:1px solid #e4efe9; background:#fff; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-input { flex:1; min-width:0; min-height:38px; max-height:100px; resize:vertical; padding:8px 9px; color:#243e34; background:#f8faf9; border:1px solid #e1eae5; border-radius:8px; outline:none; font:inherit; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-input:focus { border-color:#21846a; background:#fff; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-send { width:54px; color:#fff; background:#187a64; border:0; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-send:disabled { opacity:.6; cursor:wait; }
        @media (max-width:900px) { #${AI_CHAT_PANEL_ID} { top:12px; left:12px; width:min(320px,calc(100vw - 24px)); } }
      `;
      document.head.appendChild(style);
      panel = document.createElement('section');
      panel.id = AI_CHAT_PANEL_ID;
      panel.setAttribute('aria-label', 'AI 对话');
      panel.innerHTML = `
        <div class="boss-auto-ai-chat-header"><span class="boss-auto-ai-chat-title">AI 对话</span><div><button type="button" class="boss-auto-ai-chat-clear">清空</button><button type="button" class="boss-auto-ai-chat-collapse" title="收起 AI 对话" aria-label="收起 AI 对话" aria-expanded="true">−</button></div></div>
        <div class="boss-auto-ai-chat-list"><div class="boss-auto-ai-chat-empty">输入问题，开始和 AI 对话</div></div>
        <div class="boss-auto-ai-chat-footer"><textarea class="boss-auto-ai-chat-input" rows="2" placeholder="输入消息，Enter 发送"></textarea><button type="button" class="boss-auto-ai-chat-send">发送</button></div>
      `;
      document.body.appendChild(panel);
      panel.querySelector('.boss-auto-ai-chat-clear').addEventListener('click', clearConversation);
      panel.querySelector('.boss-auto-ai-chat-collapse').addEventListener('pointerdown', (event) => event.stopPropagation());
      panel.querySelector('.boss-auto-ai-chat-collapse').addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapsed();
      });
      panel.querySelector('.boss-auto-ai-chat-send').addEventListener('click', sendMessage);
      panel.querySelector('.boss-auto-ai-chat-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendMessage();
        }
      });
      bindDragging();
      attachTo(nextTargetId);
      positionPanel();
    }

    function attachTo(nextTargetId) {
      targetId = nextTargetId;
      const target = document.getElementById(targetId);
      if (!panel || !target) return;
      target.appendChild(panel);
      panel.classList.add('integrated');
      target.classList.toggle('ai-collapsed', panel.classList.contains('collapsed'));
    }

    function removeAiChatPanel() {
      panel?.remove();
      document.getElementById(`${AI_CHAT_PANEL_ID}-style`)?.remove();
      panel = null;
      targetId = null;
      messages = [];
      busy = false;
    }

    return { createAiChatPanel, removeAiChatPanel, attachTo };
  };
})();
