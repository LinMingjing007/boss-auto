(function () {
  'use strict';

  window.BossAutoLog = function createLogModule(context) {
    const { LOG_PANEL_ID, PANEL_ID, CHAT_PANEL_ID, AI_CHAT_PANEL_ID, escapeHtml } = context;
    const entries = [];
    const MAX_ENTRIES = 300;
    let panel = null;
    let list = null;
    let count = null;
    let resizeObserver = null;
    const shell = `:is(#${PANEL_ID}, #${CHAT_PANEL_ID}).boss-auto-unified-panel`;

    function installWorkspace(target) {
      if (target.querySelector('.boss-auto-layout-tools')) return;
      const header = target.querySelector('.boss-auto-panel-header, .chat-panel-header');
      if (target.id === CHAT_PANEL_ID) {
        const body = document.createElement('div');
        body.className = 'boss-auto-panel-body';
        [...target.children].filter((child) => child !== header && child !== panel && child.id !== AI_CHAT_PANEL_ID)
          .forEach((child) => body.appendChild(child));
        target.appendChild(body);
      }
      const toolbar = document.createElement('div');
      toolbar.className = 'boss-auto-layout-tools';
      toolbar.setAttribute('aria-label', '面板布局');
      toolbar.innerHTML = '<span>工作台</span><button type="button" data-layout="balanced" title="恢复均衡三栏">均衡</button><button type="button" data-layout="ai">AI 对话</button><button type="button" data-layout="settings">配置</button><button type="button" data-layout="log">日志</button>';
      header.insertBefore(toolbar, header.lastElementChild);
      let weights = [1, 1.08, 1];
      const presets = { balanced: [1, 1.08, 1], ai: [2, 1, 1], settings: [1, 2, 1], log: [1, 1, 2] };
      const apply = () => {
        weights.forEach((value, index) => target.style.setProperty(`--pane-${index}`, `${value}fr`));
      };
      toolbar.addEventListener('click', (event) => {
        const mode = event.target.dataset.layout;
        if (!presets[mode]) return;
        target.querySelectorAll(`#${AI_CHAT_PANEL_ID}.collapsed .boss-auto-ai-chat-collapse, #${LOG_PANEL_ID}.collapsed .boss-auto-log-collapse`)
          .forEach((button) => button.click());
        weights = [...presets[mode]];
        apply();
        toolbar.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === mode)));
      });
      [0, 1].forEach((index) => {
        const divider = document.createElement('div');
        divider.className = `boss-auto-divider divider-${index}`;
        divider.tabIndex = 0;
        divider.setAttribute('role', 'separator');
        divider.setAttribute('aria-orientation', 'vertical');
        divider.setAttribute('aria-label', index === 0 ? '调整 AI 对话与配置宽度' : '调整配置与日志宽度');
        divider.title = '拖动调整宽度 · 双击恢复均衡 · 方向键微调';
        divider.innerHTML = '<span aria-hidden="true">↔</span>';
        let drag = null;
        const resize = (delta, initial) => {
          const total = initial[index] + initial[index + 1];
          const minimum = Math.min(200, total / 2);
          const left = Math.max(minimum, Math.min(total - minimum, initial[index] + delta));
          weights = [...initial];
          weights[index] = left;
          weights[index + 1] = total - left;
          apply();
          toolbar.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', 'false'));
          divider.setAttribute('aria-valuenow', String(Math.round(left / total * 100)));
        };
        const widths = () => [target.querySelector(`#${AI_CHAT_PANEL_ID}`), target.querySelector('.boss-auto-panel-body'), panel]
          .map((element) => element?.getBoundingClientRect().width || 200);
        divider.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          drag = { x: event.clientX, widths: widths() };
          divider.setPointerCapture(event.pointerId);
          divider.classList.add('is-dragging');
        });
        divider.addEventListener('pointermove', (event) => {
          if (drag) resize(event.clientX - drag.x, drag.widths);
        });
        const stop = () => { drag = null; divider.classList.remove('is-dragging'); };
        divider.addEventListener('pointerup', stop);
        divider.addEventListener('pointercancel', stop);
        divider.addEventListener('lostpointercapture', stop);
        divider.addEventListener('dblclick', () => toolbar.querySelector('[data-layout="balanced"]').click());
        divider.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          resize(event.key === 'ArrowLeft' ? -24 : 24, widths());
        });
        target.appendChild(divider);
      });
      apply();
      toolbar.querySelector('[data-layout="balanced"]').setAttribute('aria-pressed', 'true');
    }

    function render() {
      if (!list) return;
      list.innerHTML = entries.length ? entries.map((entry) => (
        `<div class="boss-auto-log-entry" data-type="${escapeHtml(entry.type)}"><time>${escapeHtml(entry.time)}</time><span>${escapeHtml(entry.message)}</span></div>`
      )).join('') : '<div class="boss-auto-log-empty">暂无操作日志</div>';
      list.scrollTop = list.scrollHeight;
      if (count) count.textContent = String(entries.length);
    }

    function add(message, type = 'info') {
      const text = String(message || '').trim();
      if (!text) return;
      entries.push({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: text,
        type: type === 'error' ? 'error' : (type === 'success' ? 'success' : 'info'),
      });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      render();
      console.info('[Boss Auto][log]', text);
    }

    function createLogPanel(page = 'jobs') {
      if (panel?.isConnected) return;
      if (panel && !panel.isConnected) {
        panel = null;
        document.getElementById(`${LOG_PANEL_ID}-style`)?.remove();
      }
      const style = document.createElement('style');
      style.id = `${LOG_PANEL_ID}-style`;
      style.textContent = `
        #${LOG_PANEL_ID} {
          position: fixed; top: 84px; left: 372px; z-index: 2147483644;
          width: 320px; max-width: calc(100vw - 380px); height: 430px;
          overflow: hidden; color: #203e3b; background: #fff;
          border: 1px solid #dcece7; border-radius: 16px;
          box-shadow: 0 12px 40px rgba(19, 68, 57, .16);
          font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${LOG_PANEL_ID}.chat-position { top: 84px; left: 396px; }
        #${PANEL_ID}.boss-auto-unified-panel, #${CHAT_PANEL_ID}.boss-auto-unified-panel { display: grid; grid-template-columns: minmax(280px, 320px) minmax(280px, 336px) minmax(280px, 320px); grid-template-rows: auto 1fr; width: 992px; max-width: calc(100vw - 24px); max-height: calc(100vh - 108px); overflow: hidden; }
        #${PANEL_ID}.boss-auto-unified-panel > .boss-auto-panel-header, #${CHAT_PANEL_ID}.boss-auto-unified-panel > .chat-panel-header { grid-column: 1 / -1; }
        #${PANEL_ID}.boss-auto-unified-panel > .boss-auto-panel-body { grid-column: 2; min-width: 0; overflow: auto; }
        #${PANEL_ID}.boss-auto-unified-panel > #${AI_CHAT_PANEL_ID}, #${CHAT_PANEL_ID}.boss-auto-unified-panel > #${AI_CHAT_PANEL_ID} { grid-column: 1; grid-row: 2 / span 5; min-height:0; height:100%; overflow:hidden; }
        #${PANEL_ID}.boss-auto-unified-panel > #${LOG_PANEL_ID}, #${CHAT_PANEL_ID}.boss-auto-unified-panel > #${LOG_PANEL_ID} { grid-column: 3; grid-row: 2 / span 5; }
        #${PANEL_ID}.boss-auto-unified-panel.collapsed, #${CHAT_PANEL_ID}.boss-auto-unified-panel.collapsed { display: block; width: 190px; min-width: 190px; }
        #${PANEL_ID}.boss-auto-unified-panel.collapsed > #${LOG_PANEL_ID}, #${PANEL_ID}.boss-auto-unified-panel.collapsed > #${AI_CHAT_PANEL_ID}, #${CHAT_PANEL_ID}.boss-auto-unified-panel.collapsed > #${LOG_PANEL_ID}, #${CHAT_PANEL_ID}.boss-auto-unified-panel.collapsed > #${AI_CHAT_PANEL_ID} { display: none; }
        #${PANEL_ID}.boss-auto-unified-panel.compact, #${CHAT_PANEL_ID}.boss-auto-unified-panel.compact { display: block; }
        #${PANEL_ID}.boss-auto-unified-panel.compact > .boss-auto-panel-body { max-height: 360px; overflow: auto; }
        #${CHAT_PANEL_ID}.boss-auto-unified-panel.compact > #${LOG_PANEL_ID} { border-top: 1px solid #e4efe9; border-left: 0; }
        #${PANEL_ID}.boss-auto-unified-panel.log-collapsed, #${CHAT_PANEL_ID}.boss-auto-unified-panel.log-collapsed { grid-template-columns: minmax(280px, 320px) minmax(280px, 336px) 42px; width: 698px; }
        #${PANEL_ID}.boss-auto-unified-panel.ai-collapsed, #${CHAT_PANEL_ID}.boss-auto-unified-panel.ai-collapsed { grid-template-columns: 42px minmax(280px, 336px) minmax(280px, 320px); width: 698px; }
        #${LOG_PANEL_ID}.integrated.collapsed { display: block; width: 42px; min-width: 42px; height: 100%; overflow: hidden; }
        #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-header { height: 100%; min-height: 180px; padding: 10px 5px; flex-direction: column; justify-content: flex-start; gap: 7px; }
        #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-title { writing-mode: vertical-rl; font-size: 11px; }
        #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-count { margin: 0; }
        #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-clear { display: none; }
        #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-collapse { margin-top: auto; }
        #${LOG_PANEL_ID}.integrated { position: relative; top: auto; right: auto; bottom: auto; left: auto; z-index: auto; width: auto; max-width: none; height: auto; min-height: 0; max-height: none; border: 0; border-left: 1px solid #e4efe9; border-radius: 0; box-shadow: none; }
        #${LOG_PANEL_ID}.integrated .boss-auto-log-list { min-height: 180px; height: 100%; }
        #${LOG_PANEL_ID} .boss-auto-log-header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; color:#164d43; background:#eef8f3; border-bottom:1px solid #e4efe9; cursor:grab; user-select:none; }
        #${LOG_PANEL_ID} .boss-auto-log-title { font-size:14px; font-weight:700; }
        #${LOG_PANEL_ID} .boss-auto-log-count { display:inline-flex; min-width:20px; height:20px; align-items:center; justify-content:center; margin-left:5px; padding:0 5px; color:#187a64; background:#d9f1e5; border-radius:10px; font-size:10px; }
        #${LOG_PANEL_ID} .boss-auto-log-actions { display:flex; gap:5px; }
        #${LOG_PANEL_ID} button { width:auto; height:27px; margin:0; padding:0 7px; color:#426e62; background:#fff; border:1px solid #d5e5dd; border-radius:7px; cursor:pointer; font:inherit; }
        #${LOG_PANEL_ID} button:hover { background:#f6faf8; }
        #${LOG_PANEL_ID} .boss-auto-log-list { height:calc(100% - 49px); overflow:auto; padding:8px; background:#fbfdfc; }
        #${LOG_PANEL_ID} .boss-auto-log-empty { padding:24px 10px; color:#8b9b94; text-align:center; }
        #${LOG_PANEL_ID} .boss-auto-log-entry { display:grid; grid-template-columns:58px 1fr; gap:7px; padding:7px 6px; border-bottom:1px solid #eef3f0; word-break:break-word; }
        #${LOG_PANEL_ID} .boss-auto-log-entry time { color:#91a19a; font-size:10px; }
        #${LOG_PANEL_ID} .boss-auto-log-entry[data-type="success"] span { color:#187a64; }
        #${LOG_PANEL_ID} .boss-auto-log-entry[data-type="error"] span { color:#c93636; }
        #${LOG_PANEL_ID}.collapsed { width:190px; height:auto; }
        #${LOG_PANEL_ID}.collapsed .boss-auto-log-list { display:none; }
        @media (max-width: 900px) { #${PANEL_ID}.boss-auto-unified-panel, #${CHAT_PANEL_ID}.boss-auto-unified-panel { display: block; width: min(100vw - 24px, 420px); max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto; } #${PANEL_ID}.boss-auto-unified-panel.log-collapsed, #${CHAT_PANEL_ID}.boss-auto-unified-panel.log-collapsed, #${PANEL_ID}.boss-auto-unified-panel.ai-collapsed, #${CHAT_PANEL_ID}.boss-auto-unified-panel.ai-collapsed { width: min(100vw - 24px, 378px); } #${LOG_PANEL_ID}.integrated { border-top: 1px solid #e4efe9; border-left: 0; } #${LOG_PANEL_ID}.integrated .boss-auto-log-list { height: 260px; } #${LOG_PANEL_ID}.integrated.collapsed { width: 100%; height: 42px; min-width: 0; } #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-header { min-height: 42px; height: 42px; flex-direction: row; align-items: center; } #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-title { writing-mode: horizontal-tb; } #${LOG_PANEL_ID}.integrated.collapsed .boss-auto-log-collapse { margin-top: 0; margin-left: auto; } #${AI_CHAT_PANEL_ID}.integrated { width: 100%; min-height: 0; height: 360px; } #${AI_CHAT_PANEL_ID}.integrated.collapsed { width: 100%; height: 42px; min-width: 0; } #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-header { min-height: 42px; height: 42px; flex-direction: row; align-items: center; } #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-title { writing-mode: horizontal-tb; } #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-collapse { margin-top: 0; margin-left: auto; } }
      `;
      style.textContent += `
        ${shell} { --pane-0:1fr; --pane-1:1.08fr; --pane-2:1fr; --left-pane:minmax(200px,var(--pane-0)); --right-pane:minmax(200px,var(--pane-2));
          display:grid; grid-template-columns:var(--left-pane) 10px minmax(200px,var(--pane-1)) 10px var(--right-pane); grid-template-rows:58px minmax(0,1fr);
          width:1120px; height:590px; min-width:660px; min-height:320px; max-width:calc(100vw - 24px); max-height:calc(100vh - 108px); padding:0;
          border:1px solid #cbdedc; border-radius:16px; background:#fff; box-shadow:0 24px 80px #173d4826,0 3px 12px #173d4810; color:#203c40; color-scheme:light; }
        ${shell}, ${shell} * { box-sizing:border-box; scrollbar-width:thin; scrollbar-color:#ccddda transparent; }
        ${shell} > :is(.boss-auto-panel-header,.chat-panel-header) { grid-column:1 / -1; grid-row:1; margin:0; padding:10px 16px; background:linear-gradient(110deg,#eaf8f4,#f7fafc); border-bottom:1px solid #e4eeec; min-width:0; gap:12px; touch-action:none; }
        ${shell} .boss-auto-brand > div:last-child { display:flex; align-items:center; gap:16px; }
        ${shell} .boss-auto-logo { width:34px; height:34px; border-radius:10px; font-size:22px; background:#108674; }
        ${shell} .boss-auto-subtitle { font-size:12px; }
        ${shell} .boss-auto-layout-tools { display:flex; align-items:center; gap:3px; margin-left:auto; padding:3px; border:1px solid #dceae7; border-radius:9px; background:#ffffffb3; }
        ${shell} .boss-auto-layout-tools > span { padding:0 7px; color:#819591; font-size:11px; }
        ${shell} .boss-auto-layout-tools button { width:auto; height:27px; margin:0; padding:0 9px; border:0; border-radius:6px; background:transparent; color:#657b7c; font:500 11px/1.4 sans-serif; cursor:pointer; }
        ${shell} .boss-auto-layout-tools button[aria-pressed="true"], ${shell} .boss-auto-layout-tools button:hover { color:#087e6b; background:#e4f4ee; }
        ${shell} > .boss-auto-panel-body { grid-column:3; grid-row:2; min-width:0; min-height:0; overflow:auto; padding:16px 18px; }
        ${shell} > #${AI_CHAT_PANEL_ID} { grid-column:1; grid-row:2; height:100%; }
        ${shell} > #${LOG_PANEL_ID} { grid-column:5; grid-row:2; display:flex; flex-direction:column; border:0; }
        ${shell} :is(.boss-auto-ai-chat-header,.boss-auto-log-header) { flex-shrink:0; min-height:52px; padding:12px 14px; background:#fff; border-bottom:0; cursor:default; }
        ${shell} :is(.boss-auto-ai-chat-title,.boss-auto-log-title) { font-size:14px; color:#193f3c; }
        ${shell} :is(.boss-auto-ai-chat-header,.boss-auto-log-header) button { width:auto; height:27px; margin:0; padding:0 7px; background:#fff; border:1px solid #deebe8; border-radius:7px; color:#6c8581; font:12px/1.4 sans-serif; }
        ${shell} .boss-auto-ai-chat-list { padding:16px 14px; gap:16px; background:linear-gradient(#fff,#f9fcfc); }
        ${shell} .boss-auto-ai-chat-message { border-radius:14px; max-width:94%; }
        ${shell} .boss-auto-ai-chat-message.is-user { color:#31496e; background:#e9f0ff; border-bottom-right-radius:4px; }
        ${shell} .boss-auto-ai-chat-message.is-assistant { background:#edf8f4; border-bottom-left-radius:4px; }
        ${shell} .boss-auto-ai-chat-message summary { padding:10px 12px; }
        ${shell} .boss-auto-ai-chat-message-content { padding:0 12px 12px; line-height:1.75; }
        ${shell} .boss-auto-ai-chat-empty { padding:26px 12px; font-size:12px; line-height:1.9; }
        ${shell} .boss-auto-ai-chat-empty::before { content:'AI'; display:block; width:46px; height:46px; margin:0 auto 16px; border-radius:15px; background:#e3f4ee; color:#118774; font:700 18px/46px sans-serif; }
        ${shell} .boss-auto-ai-chat-footer { padding:12px; gap:9px; border-top:1px solid #edf2f1; }
        ${shell} .boss-auto-ai-chat-input { width:100%; min-height:56px; font-size:12px; background:#fff; }
        ${shell} .boss-auto-ai-chat-send { width:54px; height:auto; margin:0; background:#108674; border-radius:10px; }
        ${shell} .boss-auto-ai-chat-storage-hint { font-size:10px; color:#94a5a2; }
        ${shell} .boss-auto-ai-chat-attachment-preview[hidden] { display:none; }
        ${shell} .boss-auto-ai-chat-message[open] summary em { display:none; }
        ${shell} .boss-auto-log-list { flex:1; height:auto; min-height:0; padding:0 12px 12px; background:#fff; overscroll-behavior:contain; }
        ${shell} .boss-auto-log-entry { position:relative; grid-template-columns:54px minmax(0,1fr); gap:8px; padding:11px 0 11px 14px; font-size:12px; border-bottom:1px solid #f0f4f4; }
        ${shell} .boss-auto-log-entry::before { content:''; position:absolute; left:0; top:17px; width:6px; height:6px; border-radius:50%; background:#a3b2bc; }
        ${shell} .boss-auto-log-entry[data-type="success"]::before { background:#12a389; }
        ${shell} .boss-auto-log-entry[data-type="error"]::before { background:#ef795b; }
        ${shell} .boss-auto-log-entry[data-type="error"] span { color:#d9684b; }
        ${shell} .boss-auto-intro { font-size:14px; }
        ${shell} .boss-auto-description { margin:7px 0 10px; }
        ${shell} label { margin-bottom:9px; }
        ${shell} .boss-auto-panel-body input { height:38px; }
        ${shell} .boss-auto-hint { margin-bottom:8px; }
        ${shell} .boss-auto-footer { margin-top:8px; }
        ${shell} .boss-auto-start { background:#108674; border-radius:9px; }
        ${shell} .boss-auto-open-settings { color:#108674; background:#fff; border:1px solid #9bcfc2; }
        ${shell} .boss-auto-open-settings:hover { background:#edf8f4; }
        ${shell} .boss-auto-divider { grid-row:2; position:relative; width:10px; cursor:col-resize; touch-action:none; user-select:none; background:linear-gradient(90deg,transparent 4px,#e4eeed 4px,#e4eeed 5px,transparent 5px); }
        ${shell} .divider-0 { grid-column:2; } ${shell} .divider-1 { grid-column:4; }
        ${shell} .boss-auto-divider span { position:absolute; top:48%; left:-6px; z-index:2; width:22px; height:30px; border:1px solid #d9e6f0; border-radius:10px; background:#fff; color:#6e87cb; text-align:center; font:17px/28px sans-serif; box-shadow:0 2px 6px #24435a0d; }
        ${shell} .boss-auto-divider:hover, ${shell} .boss-auto-divider.is-dragging { background:#dce9fc; }
        ${shell} :focus-visible { outline:2px solid #6a9cdd; outline-offset:-2px; }
        ${shell}.ai-collapsed { --left-pane:42px; }
        ${shell}.log-collapsed { --right-pane:42px; }
        ${shell}:is(.ai-collapsed,.log-collapsed) { width:1120px; grid-template-columns:var(--left-pane) 10px minmax(200px,var(--pane-1)) 10px var(--right-pane); }
        ${shell}.ai-collapsed .divider-0, ${shell}.log-collapsed .divider-1 { visibility:hidden; }
        ${shell}.collapsed { display:block; width:190px !important; height:auto !important; min-width:190px; min-height:0; }
        ${shell}.collapsed > :not(.boss-auto-panel-header):not(.chat-panel-header), ${shell}.collapsed .boss-auto-layout-tools { display:none; }
        ${shell}.compact:not(.collapsed) { display:flex; flex-direction:column; min-width:280px; overflow:auto; }
        ${shell}.compact .boss-auto-layout-tools, ${shell}.compact .boss-auto-divider { display:none; }
        ${shell}.compact > :is(.boss-auto-panel-header,.chat-panel-header) { flex-shrink:0; }
        ${shell}.compact > #${AI_CHAT_PANEL_ID} { order:1; flex:0 0 330px; max-height:none; }
        ${shell}.compact > .boss-auto-panel-body { order:2; flex:0 0 auto; max-height:none; overflow:visible; }
        ${shell}.compact > #${LOG_PANEL_ID} { order:3; flex:0 0 270px; }
        ${shell}.compact > :is(#${AI_CHAT_PANEL_ID},#${LOG_PANEL_ID}).collapsed { width:100%; min-width:0; flex:0 0 44px; height:44px; }
        ${shell}.compact :is(#${AI_CHAT_PANEL_ID},#${LOG_PANEL_ID}).collapsed > :is(.boss-auto-ai-chat-header,.boss-auto-log-header) { height:44px; min-height:44px; flex-direction:row; padding:8px 14px; }
        ${shell}.compact :is(.boss-auto-ai-chat-title,.boss-auto-log-title) { writing-mode:horizontal-tb; }
        @media(max-width:900px) { ${shell} { min-width:280px; } ${shell} .boss-auto-subtitle { display:none; } }
      `;
      document.head.appendChild(style);
      panel = document.createElement('section');
      panel.id = LOG_PANEL_ID;
      panel.className = page === 'chat' ? 'chat-position' : '';
      panel.setAttribute('aria-label', 'Boss Auto 操作日志');
      panel.innerHTML = `
        <div class="boss-auto-log-header">
          <div class="boss-auto-log-title">操作日志<span class="boss-auto-log-count">0</span></div>
          <div class="boss-auto-log-actions"><button type="button" class="boss-auto-log-clear">清空</button><button type="button" class="boss-auto-log-collapse" aria-expanded="true">−</button></div>
        </div>
        <div class="boss-auto-log-list"><div class="boss-auto-log-empty">暂无操作日志</div></div>
      `;
      document.body.appendChild(panel);
      list = panel.querySelector('.boss-auto-log-list');
      count = panel.querySelector('.boss-auto-log-count');
      panel.querySelector('.boss-auto-log-clear').addEventListener('click', () => {
        entries.length = 0;
        render();
      });
      panel.querySelector('.boss-auto-log-collapse').addEventListener('click', () => {
        const collapsed = panel.classList.toggle('collapsed');
        panel.parentElement?.classList.toggle('log-collapsed', collapsed);
        panel.querySelector('.boss-auto-log-collapse').textContent = collapsed ? '+' : '−';
        panel.querySelector('.boss-auto-log-collapse').setAttribute('aria-expanded', String(!collapsed));
      });
      render();
    }

    function removeLogPanel() {
      panel?.remove();
      document.getElementById(`${LOG_PANEL_ID}-style`)?.remove();
      panel = null;
      list = null;
      count = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
    }

    function setPage(page) {
      if (!panel) return;
      panel.classList.toggle('chat-position', page === 'chat');
    }

    function attachTo(targetId) {
      const target = document.getElementById(targetId);
      if (!target || !panel) return;
      target.classList.add('boss-auto-unified-panel');
      panel.classList.add('integrated');
      target.appendChild(panel);
      installWorkspace(target);
      const updateLayout = () => {
        if (!target.isConnected) return;
        target.classList.toggle('compact', target.getBoundingClientRect().width < 660);
      };
      updateLayout();
      if (window.ResizeObserver) {
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(updateLayout);
        resizeObserver.observe(target);
      }
    }

    return { add, createLogPanel, removeLogPanel, setPage, attachTo };
  };
})();
