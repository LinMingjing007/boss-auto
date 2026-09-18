(function () {
  'use strict';

  window.BossAutoAiChat = function createAiChatModule(context) {
    const {
      AI_CHAT_PANEL_ID, AI_REQUEST_TIMEOUT_MS,
      loadConfig, loadConfigStore, saveConfig, setStatus, escapeHtml,
    } = context;
    let panel = null;
    let targetId = null;
    let messages = [];
    let busy = false;
    let pendingAttachment = null;
    let pendingAskUser = null;
    function addLog(message, type = 'info') {
      window.BossAutoLogInstance?.add(message, type);
    }

    const nullableString = { type: ['string', 'null'] };
    const nullableBoolean = { type: ['boolean', 'null'] };
    const onlineStatusValues = ['在线', '刚刚活跃', '今日活跃', '3日内活跃', '本周活跃', '本月活跃', '半年前活跃'];
    const updateConfigTool = {
      type: 'function',
      function: {
        name: 'update_user_config',
        description: '修改当前配置版本中的求职筛选和 AI 判别规则。只在用户明确要求修改时调用。AI 接入配置不在工具范围内。',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            keywords: nullableString,
            locations: nullableString,
            blockedWords: nullableString,
            resumePrompt: nullableString,
            aiPrompt: nullableString,
            aiEnabled: nullableBoolean,
            aiFailurePolicy: { type: ['string', 'null'], enum: ['skip', 'keep', null] },
            onlineStatusMode: { type: ['string', 'null'], enum: ['不限', '状态筛选', null] },
            unknownOnlineStatusPolicy: { type: ['string', 'null'], enum: ['skip', 'keep', null] },
            selectedOnlineStatuses: {
              type: ['array', 'null'], items: { type: 'string', enum: onlineStatusValues },
            },
          },
          required: ['keywords', 'locations', 'blockedWords', 'resumePrompt', 'aiPrompt', 'aiEnabled', 'aiFailurePolicy', 'onlineStatusMode', 'unknownOnlineStatusPolicy', 'selectedOnlineStatuses'],
          additionalProperties: false,
        },
      },
    };
    const readConfigTool = {
      type: 'function',
      function: {
        name: 'read_user_config',
        description: '读取当前配置版本，供 AI 了解用户的求职筛选和 AI 设置。不会返回 API Key 原文。',
        strict: true,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    };
    const askUserTool = {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '向用户提出需要用户选择或补充的信息。用户点击选项后会自动继续对话；需要自定义内容时允许选择其他并输入。',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, minItems: 1 },
            allowOther: { type: 'boolean' },
          },
          required: ['question', 'options', 'allowOther'],
          additionalProperties: false,
        },
      },
    };

    function updateUserConfig(argumentsText) {
      let changes;
      try {
        changes = JSON.parse(argumentsText || '{}');
      } catch {
        throw new Error('AI 配置工具参数不是有效 JSON');
      }
      const current = loadConfig();
      const next = { ...current };
      const editableFields = [
        'keywords', 'locations', 'blockedWords', 'resumePrompt', 'aiPrompt',
        'aiEnabled', 'aiFailurePolicy', 'onlineStatusMode', 'unknownOnlineStatusPolicy', 'selectedOnlineStatuses',
      ];
      const changedFields = editableFields.filter((field) => changes[field] !== null && changes[field] !== undefined);
      editableFields.forEach((field) => {
        if (changes[field] !== null && changes[field] !== undefined) next[field] = changes[field];
      });
      if (next.onlineStatusMode === '不限') next.selectedOnlineStatuses = [];
      if (next.onlineStatusMode === '状态筛选' && !Array.isArray(next.selectedOnlineStatuses)) {
        next.selectedOnlineStatuses = [];
      }
      if (Array.isArray(next.selectedOnlineStatuses)
        && next.selectedOnlineStatuses.some((status) => !onlineStatusValues.includes(status))) {
        throw new Error('在线状态包含不支持的选项');
      }
      if (!changedFields.length) return '没有需要修改的配置';
      saveConfig(next);
      const saved = loadConfig();
      const failedFields = changedFields.filter((field) => (
        JSON.stringify(saved[field]) !== JSON.stringify(next[field])
      ));
      if (failedFields.length) {
        throw new Error(`配置写入后校验失败：${failedFields.join('、')}`);
      }
      window.dispatchEvent(new CustomEvent('boss-auto-config-changed', {
        detail: { source: 'ai-chat', changedFields },
      }));
      return `配置已更新：${changedFields.join('、')}`;
    }

    function readUserConfig() {
      const config = loadConfig();
      const store = loadConfigStore();
      const versionNumber = store.versions.findIndex((version) => version.id === config.versionId) + 1;
      return JSON.stringify({
        versionNumber,
        versionId: config.versionId,
        versionName: config.versionName,
        keywords: config.keywords,
        locations: config.locations,
        blockedWords: config.blockedWords,
        onlineStatusMode: config.onlineStatusMode,
        selectedOnlineStatuses: config.selectedOnlineStatuses,
        unknownOnlineStatusPolicy: config.unknownOnlineStatusPolicy,
        aiEnabled: config.aiEnabled,
        resumePrompt: config.resumePrompt,
        aiPrompt: config.aiPrompt,
        aiFailurePolicy: config.aiFailurePolicy,
        messageSequence: (config.messageSequence || []).map((message, index) => ({
          index: index + 1,
          type: message.type,
          content: message.type === 'image' ? (message.name || '图片') : message.content,
        })),
      }, null, 2);
    }

    function getMessageText(message) {
      if (message.displayContent) return String(message.displayContent);
      if (Array.isArray(message.content)) {
        return message.content.map((part) => {
          if (part?.type === 'text') return part.text || '';
          if (part?.type === 'image_url') return '[图片]';
          return '';
        }).filter(Boolean).join('\n');
      }
      return String(message.content || '');
    }

    function renderMarkdown(source) {
      let html = escapeHtml(String(source || ''));
      const codeBlocks = [];
      html = html.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (match, language, code) => {
        const index = codeBlocks.push(`<pre><code${language ? ` data-language="${language}"` : ''}>${code.replace(/\n$/, '')}</code></pre>`) - 1;
        return `\n@@BOSSAUTOCODE${index}@@\n`;
      });
      const inline = (text) => text
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
      const splitRow = (line) => {
        const text = line.trim();
        const cells = [];
        let cell = '';
        let code = false;
        for (let index = 0; index < text.length; index += 1) {
          const char = text[index];
          if (char === '\\' && text[index + 1] === '|') { cell += '|'; index += 1; continue; }
          if (char === '`') code = !code;
          if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; }
          else cell += char;
        }
        cells.push(cell.trim());
        if (text.startsWith('|')) cells.shift();
        if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
        return cells;
      };
      const tableLines = html.split('\n');
      const tableBlocks = [];
      const remainingLines = [];
      for (let index = 0; index < tableLines.length; index += 1) {
        const headers = splitRow(tableLines[index]);
        const separators = splitRow(tableLines[index + 1] || '');
        if (!tableLines[index].includes('|') || headers.length !== separators.length
          || !separators.length || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
          remainingLines.push(tableLines[index]);
          continue;
        }
        const alignments = separators.map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
        const row = (cells, tag) => `<tr>${headers.map((_, column) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} style="text-align:${alignments[column]}">${inline(cells[column] || '')}</${tag}>`).join('')}</tr>`;
        index += 1;
        const body = [];
        while (index + 1 < tableLines.length && tableLines[index + 1].trim() && tableLines[index + 1].includes('|')) {
          body.push(row(splitRow(tableLines[++index]), 'td'));
        }
        const block = tableBlocks.push(`<div class="boss-auto-table-scroll" role="region" aria-label="AI 回复表格，可横向滚动" tabindex="0"><table><thead>${row(headers, 'th')}</thead><tbody>${body.join('')}</tbody></table></div>`) - 1;
        remainingLines.push(`@@BOSSAUTOTABLE${block}@@`);
      }
      html = inline(remainingLines.join('\n'));
      html = html.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, title) => `<h${hashes.length}>${title}</h${hashes.length}>`);
      html = html.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');

      const lines = html.split('\n');
      const renderedLines = [];
      let listType = null;
      const closeList = () => {
        if (listType) renderedLines.push(`</${listType}>`);
        listType = null;
      };
      lines.forEach((line) => {
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
        if (unordered || ordered) {
          const nextType = unordered ? 'ul' : 'ol';
          if (listType !== nextType) {
            closeList();
            listType = nextType;
            renderedLines.push(`<${listType}>`);
          }
          renderedLines.push(`<li>${(unordered || ordered)[1]}</li>`);
        } else {
          closeList();
          renderedLines.push(line);
        }
      });
      closeList();
      html = renderedLines.join('\n')
        .replace(/\n{2,}/g, '<br><br>')
        .replace(/\n/g, '<br>');
      codeBlocks.forEach((block, index) => {
        html = html.replace(`<br>@@BOSSAUTOCODE${index}@@<br>`, () => block);
        html = html.replace(`@@BOSSAUTOCODE${index}@@`, () => block);
      });
      tableBlocks.forEach((block, index) => {
        html = html.replace(`@@BOSSAUTOTABLE${index}@@`, () => block);
      });
      return html;
    }

    function parseAskUser(argumentsText) {
      let request;
      try {
        request = JSON.parse(argumentsText || '{}');
      } catch {
        throw new Error('AI ask_user 参数不是有效 JSON');
      }
      if (!request.question || !Array.isArray(request.options) || !request.options.length) {
        throw new Error('AI ask_user 缺少问题或选项');
      }
      const options = request.options.map((option) => String(option)).filter(Boolean);
      if (!options.length) throw new Error('AI ask_user 没有有效选项');
      return {
        question: String(request.question),
        options,
        allowOther: request.allowOther === true,
      };
    }

    function finishAskUser(answer) {
      if (!pendingAskUser || !String(answer || '').trim()) return;
      const { resolve } = pendingAskUser;
      pendingAskUser = null;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].askUser) {
          delete messages[index].askUser;
          break;
        }
      }
      messages.push({ role: 'user', content: String(answer).trim(), displayContent: String(answer).trim() });
      renderMessages();
      addLog(`用户回答 AI：${String(answer).trim().slice(0, 80)}`);
      resolve(String(answer).trim());
    }

    function requestUserAnswer(argumentsText) {
      const request = parseAskUser(argumentsText);
      messages.push({ role: 'assistant', content: request.question, displayContent: request.question, askUser: request });
      renderMessages();
      addLog(`AI 正在询问用户：${request.question.slice(0, 80)}`);
      return new Promise((resolve, reject) => {
        pendingAskUser = { resolve, reject };
      });
    }

    function renderMessages() {
      const list = panel?.querySelector('.boss-auto-ai-chat-list');
      if (!list) return;
      const shouldStickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      const openStates = [...list.querySelectorAll('.boss-auto-ai-chat-message')].map((message) => message.open);
      list.innerHTML = messages.length ? messages.map((message, index) => {
        const text = getMessageText(message);
        const summary = text.replace(/\s+/g, ' ').trim().slice(0, 42) || '空消息';
        const roleLabel = message.role === 'user' ? '我' : 'AI';
        const open = openStates[index] === undefined || openStates[index];
        const renderedText = message.role === 'user'
          ? escapeHtml(text).replace(/\n/g, '<br>')
          : renderMarkdown(text);
        const askMarkup = message.askUser ? `<div class="boss-auto-ai-chat-ask-options">${message.askUser.options.map((option) => `<button type="button" class="boss-auto-ai-chat-ask-option">${escapeHtml(option)}</button>`).join('')}${message.askUser.allowOther ? '<div class="boss-auto-ai-chat-ask-other"><input type="text" placeholder="输入其他内容"><button type="button" class="boss-auto-ai-chat-ask-other-submit">发送</button></div>' : ''}</div>` : '';
        return `<details class="boss-auto-ai-chat-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}"${open ? ' open' : ''}><summary><span>${roleLabel}</span><em>${escapeHtml(summary)}</em></summary><div class="boss-auto-ai-chat-message-content">${renderedText}${askMarkup}</div></details>`;
      }).join('') : '<div class="boss-auto-ai-chat-empty">输入问题，开始和 AI 对话</div>';
      list.querySelectorAll('.boss-auto-ai-chat-ask-option').forEach((button) => {
        button.addEventListener('click', () => finishAskUser(button.textContent));
      });
      const otherInput = list.querySelector('.boss-auto-ai-chat-ask-other input');
      const otherSubmit = list.querySelector('.boss-auto-ai-chat-ask-other-submit');
      if (otherInput && otherSubmit) {
        otherSubmit.addEventListener('click', () => finishAskUser(otherInput.value));
        otherInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finishAskUser(otherInput.value);
          }
        });
      }
      if (shouldStickToBottom) list.scrollTop = list.scrollHeight;
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
      if (pendingAskUser) {
        const { reject } = pendingAskUser;
        pendingAskUser = null;
        const error = new Error('用户取消了本次提问');
        error.code = 'USER_CANCELLED';
        reject(error);
      }
      messages = [];
      pendingAttachment = null;
      renderAttachmentPreview();
      renderMessages();
      addLog('已清空 AI 对话');
    }

    function renderAttachmentPreview() {
      const preview = panel?.querySelector('.boss-auto-ai-chat-attachment-preview');
      if (!preview) return;
      if (!pendingAttachment) {
        preview.hidden = true;
        preview.innerHTML = '';
        return;
      }
      preview.hidden = false;
      preview.innerHTML = `<img src="${escapeHtml(pendingAttachment.dataUrl)}" alt="${escapeHtml(pendingAttachment.name)}"><span>${escapeHtml(pendingAttachment.name)}</span><button type="button" class="boss-auto-ai-chat-remove-attachment" aria-label="移除图片">×</button>`;
      preview.querySelector('.boss-auto-ai-chat-remove-attachment').addEventListener('click', () => {
        pendingAttachment = null;
        renderAttachmentPreview();
      });
    }

    async function processAttachment(file) {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        setStatus('文件超过 2MB，无法导入 AI 对话', 'error');
        addLog(`AI 文件导入失败：${file.name} 超过 2MB`, 'error');
        return;
      }
      try {
        const input = panel.querySelector('.boss-auto-ai-chat-input');
        if (file.type.startsWith('image/')) {
          if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
            throw new Error('DeepSeek 暂不支持该图片格式');
          }
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          pendingAttachment = { name: file.name, dataUrl };
          renderAttachmentPreview();
          input.focus();
          addLog(`已选择图片：${file.name}`);
          return;
        }
        const text = await file.text();
        if (!text.trim()) throw new Error('文件内容为空');
        const prefix = input.value.trim() ? `${input.value.trim()}\n\n` : '';
        input.value = `${prefix}文件：${file.name}\n${text}`;
        pendingAttachment = null;
        renderAttachmentPreview();
        input.focus();
        addLog(`已导入文件：${file.name}`);
      } catch (error) {
        setStatus(`文件导入失败：${error.message}`, 'error');
        addLog(`AI 文件导入失败：${error.message}`, 'error');
      }
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
      if (!content && !pendingAttachment) return;
      const config = loadConfig();
      if (!config.aiEndpoint || !config.aiModel || !config.aiApiKey) {
        setStatus('请先在设置中完善 AI 接口、模型和 API Key', 'error');
        addLog('AI 对话失败：AI 配置不完整', 'error');
        return;
      }
      if (!/deepseek/i.test(config.aiModel)) {
        setStatus('当前仅支持 DeepSeek 模型', 'error');
        addLog('AI 对话失败：当前仅支持 DeepSeek 模型', 'error');
        return;
      }

      const attachment = pendingAttachment;
      const displayContent = `${content}${content && attachment ? '\n' : ''}${attachment ? `图片：${attachment.name}` : ''}`;
      const messageContent = attachment ? [
        { type: 'text', text: content || '请分析这张图片。' },
        { type: 'image_url', image_url: { url: attachment.dataUrl, detail: 'auto' } },
      ] : content;
      messages.push({ role: 'user', content: messageContent, displayContent });
      input.value = '';
      pendingAttachment = null;
      renderAttachmentPreview();
      renderMessages();
      busy = true;
      if (sendButton) {
        sendButton.disabled = true;
        sendButton.textContent = '发送中…';
      }
      addLog(`AI 对话：${(content || '图片消息').slice(0, 80)}`);

      const systemContext = [
        '你是求职助手，请用中文回答用户问题。',
        '需要了解当前配置时使用 read_user_config；当用户明确要求修改求职配置时使用 update_user_config；没有明确要求时不要修改配置。AI 接入配置（接口地址、模型和 API Key）不可读取、不可修改。',
        '工具执行失败时会返回包含 ok:false 和 error 的 JSON 工具结果。请根据错误自行决定修正参数后再次调用、询问用户补充信息，或停止尝试并说明原因。不要把失败说成成功，也不要重复执行已经成功且不需要再次执行的操作。',
        config.resumePrompt,
      ].filter(Boolean).join('\n\n');
      try {
        const conversation = [
          { role: 'system', content: systemContext },
          ...messages.map((item) => ({ role: item.role, content: item.content })),
        ];
        while (true) {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
          let response;
          try {
            response = await fetch(config.aiEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.aiApiKey}`,
              },
              body: JSON.stringify({
                model: config.aiModel,
                temperature: 0.2,
                max_tokens: 1024,
                thinking: { type: 'disabled' },
                tools: [readConfigTool, updateConfigTool, askUserTool],
                tool_choice: 'auto',
                messages: conversation,
              }),
              signal: controller.signal,
            });
          } finally {
            window.clearTimeout(timer);
          }
          if (!response.ok) throw new Error(`AI 接口 HTTP ${response.status}`);
          const data = await response.json();
          const responseMessage = data?.choices?.[0]?.message;
          const toolCalls = responseMessage?.tool_calls || [];
          if (!Array.isArray(toolCalls) || toolCalls.some((call) => typeof call?.id !== 'string' || !call.id)) {
            throw new Error('AI 工具调用格式不完整，缺少有效的 tool_call_id');
          }
          if (!toolCalls.length) {
            const answer = responseMessage?.content;
            if (!answer) throw new Error('AI 接口未返回内容');
            messages.push({ role: 'assistant', content: String(answer).trim() });
            break;
          }

          conversation.push({
            role: 'assistant',
            content: responseMessage.content || null,
            tool_calls: toolCalls,
          });
          for (const toolCall of toolCalls) {
            let result;
            const toolName = toolCall?.function?.name;
            try {
              if (toolName === 'update_user_config') {
                result = updateUserConfig(toolCall.function.arguments);
              } else if (toolName === 'read_user_config') {
                result = `当前配置：\n${readUserConfig()}`;
              } else if (toolName === 'ask_user') {
                result = await requestUserAnswer(toolCall.function.arguments);
              } else {
                throw new Error('AI 返回了不支持的工具');
              }
              addLog(toolName === 'read_user_config' ? 'AI 读取了当前配置' : toolName === 'ask_user' ? 'AI 已收到用户选择' : result, 'success');
            } catch (error) {
              // User cancellation ends the turn; ordinary tool errors go back to the model.
              if (error?.code === 'USER_CANCELLED') throw error;
              const message = error instanceof Error ? error.message : String(error);
              result = JSON.stringify({ ok: false, error: message });
              addLog(`工具 ${toolName || '未知工具'} 执行失败，已反馈给 AI：${message}`, 'error');
            }
            conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
          }
        }
        renderMessages();
        addLog('AI 对话回复成功', 'success');
      } catch (error) {
        if (messages.at(-1)?.role === 'user' && messages.at(-1).displayContent === displayContent) messages.pop();
        renderMessages();
        if (error.code === 'USER_CANCELLED') {
          addLog('AI 对话已取消');
        } else {
          const message = error.name === 'AbortError' ? 'AI 请求超时' : error.message;
          setStatus(`AI 对话失败：${message}`, 'error');
        }
      } finally {
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
        #${AI_CHAT_PANEL_ID}.integrated { position:relative; top:auto; left:auto; z-index:auto; width:auto; height:100%; min-width:0; min-height:0; max-width:none; max-height:100%; resize:none; overflow:hidden; border:0; border-radius:0; box-shadow:none; }
        #${AI_CHAT_PANEL_ID}.integrated, #${AI_CHAT_PANEL_ID}.integrated .boss-auto-ai-chat-list { min-height:0; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed { width:42px; min-width:42px; height:100%; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-list, #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-footer { display:none; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-clear { display:none; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-header { height:100%; min-height:180px; padding:10px 5px; flex-direction:column; gap:7px; justify-content:flex-start; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-title { writing-mode:vertical-rl; font-size:11px; }
        #${AI_CHAT_PANEL_ID}.integrated.collapsed .boss-auto-ai-chat-collapse { margin-top:auto; }
        #${AI_CHAT_PANEL_ID} * { box-sizing:border-box; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; color:#164d43; background:linear-gradient(120deg,#e5f7ef,#f4faf7); border-bottom:1px solid #e4efe9; cursor:grab; user-select:none; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header.dragging { cursor:grabbing; }
        #${AI_CHAT_PANEL_ID}.drag-over { outline:2px dashed #187a64; outline-offset:-5px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-title { font-weight:700; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-header > div { display:flex; gap:5px; }
        #${AI_CHAT_PANEL_ID} button { border:1px solid #d5e5dd; border-radius:7px; cursor:pointer; font:inherit; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-clear { padding:4px 7px; color:#426e62; background:#fff; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-list { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:8px; padding:12px; background:#fbfdfc; overscroll-behavior:contain; touch-action:pan-y; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-empty { margin:auto; color:#8b9b94; text-align:center; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message { flex:0 0 auto; max-width:88%; border-radius:10px; word-break:break-word; overflow:hidden; }
        #${AI_CHAT_PANEL_ID} :is(.boss-auto-ai-chat-header,.boss-auto-ai-chat-footer) { flex-shrink:0; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message.is-user { align-self:flex-end; color:#fff; background:#187a64; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message.is-assistant { align-self:flex-start; color:#29483d; background:#eef8f3; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message summary { display:flex; align-items:center; gap:8px; min-width:150px; padding:8px 10px; cursor:pointer; list-style:none; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message summary::-webkit-details-marker { display:none; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message summary::before { content:'›'; flex:0 0 auto; font-size:17px; line-height:12px; transform:rotate(0deg); transition:transform .15s ease; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message[open] summary::before { transform:rotate(90deg); }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message summary span { flex:0 0 auto; font-weight:700; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message summary em { min-width:0; overflow:hidden; color:inherit; opacity:.78; font-size:10px; font-style:normal; text-overflow:ellipsis; white-space:nowrap; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content { padding:0 10px 9px; line-height:1.5; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h1, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h2, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h3, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h4, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h5, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content h6 { margin:8px 0 4px; line-height:1.3; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content ul, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content ol { margin:4px 0 4px 20px; padding:0; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content blockquote { margin:6px 0; padding-left:9px; border-left:3px solid currentColor; opacity:.8; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content code { padding:1px 4px; border-radius:4px; background:rgba(0,0,0,.08); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content pre { margin:6px 0; padding:8px; overflow:auto; border-radius:6px; background:rgba(0,0,0,.1); }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content pre code { padding:0; background:transparent; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-message-content a { color:inherit; text-decoration:underline; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll { max-width:100%; margin:8px 0; overflow-x:auto; border:1px solid #d7e9e1; border-radius:9px; background:#fff; overscroll-behavior-x:contain; touch-action:pan-x pan-y; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll table { width:100%; min-width:360px; border-collapse:collapse; font:inherit; font-size:12px; line-height:1.65; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll :is(th,td) { min-width:100px; max-width:340px; padding:9px 12px; border-right:1px solid #e4eee9; border-bottom:1px solid #e4eee9; vertical-align:top; overflow-wrap:anywhere; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll th { background:#e4f3ed; color:#296452; font-weight:650; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll tr:nth-child(even) td { background:#f5faf7; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll tr:last-child td { border-bottom:0; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll :is(th,td):last-child { border-right:0; }
        #${AI_CHAT_PANEL_ID} .boss-auto-table-scroll:focus-visible { outline:2px solid #66b89a; outline-offset:2px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-options { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-option, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-other-submit { width:auto; min-height:28px; padding:4px 9px; color:#187a64; background:#fff; border:1px solid #b9ded0; border-radius:7px; cursor:pointer; font:inherit; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-option:hover, #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-other-submit:hover { background:#eaf8f1; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-other { display:flex; flex:1 1 100%; gap:6px; margin-top:2px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-ask-other input { min-width:0; flex:1; padding:5px 7px; color:#243e34; background:#fff; border:1px solid #d5e5dd; border-radius:6px; outline:none; font:inherit; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-footer { display:grid; grid-template-columns:minmax(0,1fr) 54px; gap:7px; padding:10px; border-top:1px solid #e4efe9; background:#fff; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-storage-hint { grid-column:1 / -1; color:#8b9b94; font-size:10px; line-height:1.3; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-attachment-preview { grid-column:1 / -1; display:flex; align-items:center; gap:7px; padding:5px 7px; color:#426e62; background:#f6f9f7; border:1px solid #dcece7; border-radius:7px; font-size:10px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-attachment-preview img { width:42px; height:42px; object-fit:cover; border-radius:5px; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-attachment-preview span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #${AI_CHAT_PANEL_ID} .boss-auto-ai-chat-remove-attachment { width:22px; height:22px; padding:0; color:#71857c; background:transparent; border:0; font-size:18px; line-height:18px; }
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
        <div class="boss-auto-ai-chat-footer"><div class="boss-auto-ai-chat-storage-hint">可粘贴或拖拽 TXT、MD、JSON、CSV、HTML 及 JPEG/PNG/GIF/WebP 文件，单个文件最大 2MB</div><div class="boss-auto-ai-chat-attachment-preview" hidden></div><textarea class="boss-auto-ai-chat-input" rows="2" placeholder="输入消息，Enter 发送"></textarea><button type="button" class="boss-auto-ai-chat-send">发送</button></div>
      `;
      document.body.appendChild(panel);
      renderMessages();
      panel.querySelector('.boss-auto-ai-chat-clear').addEventListener('click', clearConversation);
      panel.querySelector('.boss-auto-ai-chat-collapse').addEventListener('pointerdown', (event) => event.stopPropagation());
      panel.querySelector('.boss-auto-ai-chat-collapse').addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapsed();
      });
      panel.querySelector('.boss-auto-ai-chat-send').addEventListener('click', sendMessage);
      const input = panel.querySelector('.boss-auto-ai-chat-input');
      input.addEventListener('paste', (event) => {
        const file = [...(event.clipboardData?.items || [])]
          .find((item) => item.kind === 'file')?.getAsFile();
        if (!file) return;
        event.preventDefault();
        processAttachment(file);
      });
      panel.addEventListener('dragover', (event) => {
        if (![...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) return;
        event.preventDefault();
        panel.classList.add('drag-over');
      });
      panel.addEventListener('dragleave', (event) => {
        if (!panel.contains(event.relatedTarget)) panel.classList.remove('drag-over');
      });
      panel.addEventListener('drop', (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        event.preventDefault();
        panel.classList.remove('drag-over');
        processAttachment(file);
      });
      input.addEventListener('keydown', (event) => {
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
      pendingAttachment = null;
      busy = false;
    }

    return { createAiChatPanel, removeAiChatPanel, attachTo };
  };
})();
