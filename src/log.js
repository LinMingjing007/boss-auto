(function () {
  'use strict';

  window.BossAutoLog = function createLogModule(context) {
    const { LOG_PANEL_ID, escapeHtml } = context;
    const entries = [];
    const MAX_ENTRIES = 300;
    let panel = null;
    let list = null;
    let count = null;
    let targetId = '';
    let positionTimer = null;
    let resizeObserver = null;

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

    function syncPosition() {
      if (!panel || !targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const gap = 16;
      const panelWidth = panel.offsetWidth || 320;
      const preferredLeft = rect.right + gap;
      const fallbackLeft = rect.left - panelWidth - gap;
      const left = preferredLeft + panelWidth <= window.innerWidth - 12
        ? preferredLeft : Math.max(12, fallbackLeft);
      const maxTop = Math.max(12, window.innerHeight - panel.offsetHeight - 12);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(Math.min(Math.max(12, rect.top), maxTop))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    function createLogPanel(page = 'jobs') {
      if (panel) return;
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
        @media (max-width: 900px) { #${LOG_PANEL_ID} { max-width:calc(100vw - 24px); } }
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
        panel.querySelector('.boss-auto-log-collapse').textContent = collapsed ? '+' : '−';
        panel.querySelector('.boss-auto-log-collapse').setAttribute('aria-expanded', String(!collapsed));
      });
      render();
      syncPosition();
    }

    function removeLogPanel() {
      panel?.remove();
      document.getElementById(`${LOG_PANEL_ID}-style`)?.remove();
      if (positionTimer) window.clearInterval(positionTimer);
      resizeObserver?.disconnect();
      panel = null;
      list = null;
      count = null;
      targetId = '';
      positionTimer = null;
      resizeObserver = null;
    }

    function setPage(page) {
      if (!panel) return;
      panel.classList.toggle('chat-position', page === 'chat');
      syncPosition();
    }

    function setTarget(nextTargetId) {
      targetId = nextTargetId || '';
      const target = document.getElementById(targetId);
      if (!target) return;
      syncPosition();
      if (!positionTimer) positionTimer = window.setInterval(syncPosition, 250);
      if (!resizeObserver && window.ResizeObserver) {
        resizeObserver = new ResizeObserver(syncPosition);
        resizeObserver.observe(target);
      }
    }

    return { add, createLogPanel, removeLogPanel, setPage, setTarget };
  };
})();
