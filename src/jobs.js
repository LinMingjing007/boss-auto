(function () {
  'use strict';

  window.BossAutoJobs = function createJobsModule(context) {
    const {
      setStatus, getConfig, loadConfig, isJobAllowed, STATUS_OPTIONS, randomDelay,
      AI_REQUEST_TIMEOUT_MS,
      isJobsPage, updateOnlineStatusCapability,
    } = context;
    let paginationRunning = false;
    let deliveryRunning = false;
    let deliveryPaused = false;
    const jobRecords = [];
    let deliveryIndex = 0;

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

    function parseAiDecision(content) {
      const rawContent = Array.isArray(content)
        ? content.map((item) => typeof item === 'string' ? item : (item?.text || '')).join('')
        : content;
      const normalized = String(rawContent || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      let result;
      try {
        result = JSON.parse(normalized);
      } catch {
        const match = normalized.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI 返回的内容不是有效 JSON');
        try { result = JSON.parse(match[0]); } catch { throw new Error('AI 返回的 JSON 无法解析'); }
      }
      if (typeof result.pass !== 'boolean') throw new Error('AI 返回结果缺少 pass 布尔值');
      const score = Number(result.score);
      return {
        pass: result.pass,
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
        reason: String(result.reason || result.reasons || '').trim(),
        risks: String(result.risks || '').trim(),
      };
    }

    async function judgeJobWithAi(record, config) {
      if (!config.aiEndpoint || !config.aiModel || !config.aiApiKey || !config.aiPrompt) {
        throw new Error('AI 配置不完整');
      }
      const detail = document.querySelector('.job-detail-container');
      if (!detail) throw new Error('未找到职位详情');
      const detailText = (detail.innerText || detail.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16000);
      const knownInfo = {
        jobName: record.jobName,
        salary: record.salary,
        company: record.company,
        location: record.location,
        tags: record.tags,
        url: record.url,
        detailText,
      };
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
      try {
        const isDeepSeek = /deepseek/i.test(`${config.aiEndpoint} ${config.aiModel}`);
        const decisionSchema = {
          type: 'object',
          properties: {
            pass: { type: 'boolean', description: '是否通过岗位匹配判断' },
            score: { type: 'number', minimum: 0, maximum: 100, description: '岗位匹配分数' },
            reason: { type: 'string', description: '判断理由' },
            risks: { type: 'string', description: '风险或不匹配点，没有则为空字符串' },
          },
          required: ['pass', 'score', 'reason', 'risks'],
          additionalProperties: false,
        };
        const response = await fetch(config.aiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.aiApiKey}`,
          },
          body: JSON.stringify({
            model: config.aiModel,
            temperature: 0,
            max_tokens: 256,
            ...(isDeepSeek ? {
              thinking: { type: 'disabled' },
              tools: [{
                type: 'function',
                function: {
                  name: 'job_match_decision',
                  description: '输出岗位匹配判断结果',
                  strict: true,
                  parameters: decisionSchema,
                },
              }],
              tool_choice: { type: 'function', function: { name: 'job_match_decision' } },
            } : { response_format: { type: 'json_object' } }),
            messages: [
              { role: 'system', content: [config.resumePrompt, config.aiPrompt].filter(Boolean).join('\n\n') },
              { role: 'user', content: `请判断以下职位信息：\n${JSON.stringify(knownInfo, null, 2)}` },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`AI 接口 HTTP ${response.status}`);
        const data = await response.json();
        const message = data?.choices?.[0]?.message;
        const content = message?.tool_calls?.[0]?.function?.arguments || message?.content;
        if (!content) throw new Error('AI 接口未返回判断内容');
        return parseAiDecision(content);
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('AI 请求超时');
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
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
        if (config.aiEnabled) {
          setStatus(`正在用 AI 判断：${record.jobName}`);
          try {
            const aiResult = await judgeJobWithAi(record, config);
            record.aiPass = aiResult.pass;
            record.aiScore = aiResult.score;
            record.aiReason = aiResult.reason;
            record.aiRisks = aiResult.risks;
            record.aiCheckedAt = new Date().toISOString();
            if (!aiResult.pass) {
              record.status = 'skipped';
              record.skipReason = `AI 判别未通过${aiResult.reason ? `：${aiResult.reason}` : ''}`;
              setStatus(`已跳过${record.jobName}：${record.skipReason}`);
              deliveryIndex += 1;
              return;
            }
            setStatus(`AI 判别通过${aiResult.score === null ? '' : `（${aiResult.score}分）`}：${record.jobName}`, 'success');
          } catch (error) {
            record.aiError = error.message;
            record.aiCheckedAt = new Date().toISOString();
            if (config.aiFailurePolicy !== 'keep') {
              record.status = 'skipped';
              record.skipReason = `AI 判别失败：${error.message}`;
              setStatus(`已跳过${record.jobName}：${record.skipReason}`, 'error');
              deliveryIndex += 1;
              return;
            }
            setStatus(`AI 判别失败，按设置继续：${error.message}`);
          }
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

    return {
      startDelivery,
      getState: () => ({ paginationRunning, deliveryRunning, deliveryPaused }),
      togglePause() {
        deliveryPaused = !deliveryPaused;
        return deliveryPaused;
      },
    };
  };
})();
