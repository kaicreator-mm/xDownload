/**
 * xDownload S2 action popup — the explicit attachment-selection surface
 * (#95). This page is part of the shipped extension artifact; it runs in
 * the extension origin and holds no privilege beyond what the privileged
 * service worker grants it (the internal message boundary checks
 * sender.id, and ONLY this page's explicit Download click starts a
 * journey).
 *
 * Flow: scrape the current page's anchor links (activeTab scripting) →
 * render one row per http(s) attachment link → Download click = the
 * explicit user decision → the service worker runs the installed S2
 * journey → this page polls the truthful journey state and renders the
 * verbatim Core terminal result.
 *
 * R1 (PR #96 review F01/F03):
 * - no checksum is required: the explicit selection observed on the current
 *   page is the target anchor (PRD §31 CJ-02). A digest the page/publisher
 *   made known can be entered optionally and only STRENGTHENS Core-side
 *   target validation — it never gates an ordinary selection, and the
 *   downloaded bytes' own hash is never used as the oracle (C34);
 * - a cross-origin attachment (provenance-bound CDN member observed on the
 *   page) is admissible: the click requests the scoped host permission for
 *   exactly that origin (never a blanket grant); denial fails truthfully.
 */
(() => {
  'use strict';

  const list = document.getElementById('attachments');
  const stateBox = document.getElementById('state');
  const s5Group = document.getElementById('s5-group');
  const s5PreviewButton = document.getElementById('s5-preview');
  const s5PrepareButton = document.getElementById('s5-prepare');
  const s5PreviewResult = document.getElementById('s5-preview-result');
  const s5ObservedRows = [];
  let s5ObservedTab = null;
  let s5ObservedComplete = false;

  /** Localize renderer-authored copy; never rewrite Core-owned diagnostic values or raw terminal JSON. */
  function localizeUiMessage(value) {
    let text = String(value);
    const rawTerminalMarkers = [
      ['Core terminal projection (verbatim):', 'Core 原始终态（原样）：'],
      ['Core terminal:', 'Core 原始终态：'],
      ['Core aggregate terminal (verbatim):', 'Core 汇总终态（原样）：'],
    ];
    for (const [source, localized] of rawTerminalMarkers) {
      const index = text.indexOf(source);
      if (index >= 0) {
        return text.slice(0, index) + localized + text.slice(index + source.length);
      }
    }

    const exact = new Map([
      ['selection rejected: unknown error', '文件选择被拒绝：未知错误'],
      ['batch failed: unknown failure', '批量任务失败：未知原因'],
      ['Journey accepted; the service worker is acquiring…', '任务已受理，服务工作线程正在处理…'],
      [
        'the journey is unknown to the service worker (fresh worker or invalid id)',
        '服务工作线程中没有此任务记录（可能刚重启或任务标识无效）',
      ],
      ['no active tab', '没有活动标签页'],
      [
        'no http(s) attachment links found on the current page',
        '当前页面没有发现 http/https 文件链接',
      ],
      [
        'Awaiting your batch confirmation — nothing is downloaded yet.',
        '等待你确认批量任务，尚未开始下载。',
      ],
      [
        'No frozen Core group; request S5 group admission first.',
        'Core 尚未冻结批量候选，请先准备批量任务。',
      ],
      ['Select at least one frozen member for the batch.', '请至少选择一个已冻结的文件。'],
      ['Confirm the batch with Core before downloading.', '请先向 Core 确认批量任务，再开始下载。'],
      ['The service worker could not answer the status poll.', '服务工作线程无法返回任务状态。'],
      [
        'Enter the Host-issued target handle and the authorized output root first.',
        '请先填写 Host 签发的目标句柄和已授权的保存目录。',
      ],
      [
        'This action needs an active http(s) page tab (origin authority).',
        '此操作需要活动的 http/https 页面标签（用于验证来源）。',
      ],
      [
        'Submitting the confirmed intent through the trusted local Host…',
        '正在通过可信本地 Host 提交已确认的操作…',
      ],
      [
        'No frozen Core collection; request S6 collection admission first.',
        'Core 尚未冻结合集，请先准备合集任务。',
      ],
      [
        'Select at least one frozen member for the collection batch.',
        '请至少选择一个已冻结的合集成员。',
      ],
      [
        'Confirm the collection with Core before downloading.',
        '请先向 Core 确认合集任务，再开始下载。',
      ],
      [
        'The declared range is fully walked; Core will never treat extra pages as part of this collection.',
        '指定范围已完整遍历；Core 不会把额外页面计入本合集。',
      ],
      [
        'The page declares no next-page edge; the declared walk stopped truthfully. You may still confirm the recorded members.',
        '当前页面没有声明下一页链接，遍历已如实停止。你仍可确认已记录的成员。',
      ],
      ['S6 page walk refused: no active tab to navigate.', 'S6 已拒绝：没有可供导航的活动标签页。'],
    ]);
    if (exact.has(text)) return exact.get(text);
    const patterns = [
      [
        /^journey status unreadable \(service worker may have restarted\): /,
        '无法读取任务状态（服务工作线程可能已重启）：',
      ],
      [/^journey status unreadable: /, '无法读取任务状态：'],
      [/^journey status unreadable/, '无法读取任务状态'],
      [/^Running the S2 journey \(([^)]+)\)…$/, '正在执行单项下载（$1）…'],
      [/^selection rejected: /, '文件选择被拒绝：'],
      [
        /^scoped host permission for (.+) was not granted; the cross-origin attachment was not acquired$/,
        '未获准访问跨域来源 $1；未获取该文件。',
      ],
      [/^scoped host permission request failed: /, '申请来源权限失败：'],
      [/^Core refused the confirmation: /, 'Core 拒绝了确认：'],
      [/^Core refused the execution: /, 'Core 拒绝执行：'],
      [/^Confirmation failed: /, '确认失败：'],
      [/^Execution failed: /, '执行失败：'],
      [/^S5 admission refused without downloading: /, 'S5 准入被拒绝，未开始下载：'],
      [/^S5 admission failed without downloading: /, 'S5 准备失败，未开始下载：'],
      [/^S5 preview failed without any acquisition: /, 'S5 预览失败，未执行获取：'],
      [/^S5 refused: /, 'S5 已拒绝：'],
      [/^batch failed: /, '批量任务失败：'],
      [
        /^Core is downloading the batch \(([^)]+)\)… per-member status so far:\n/,
        'Core 正在处理批量任务（$1）…各文件状态：\n',
      ],
      [
        /^Core durably confirmed (.+) members \(group (.+)\)\. Start the batch download when ready\.$/,
        'Core 已确认 $1 个成员（组 $2）。准备就绪后可开始批量下载。',
      ],
      [/^S6 page (\d+) scan produced no member anchors; /, 'S6 第$1页扫描未发现文件链接；'],
      [
        /^S6 page (\d+) carries (\d+) member anchors and the shipped scan admits only (\d+); recording a truncated page could fabricate coverage, so the declared walk stopped truthfully before Core froze anything from this page\.$/,
        'S6 第$1页观察到 $2 个文件链接，但当前扫描只读取了 $3 个；为避免把不完整页面误报为完整覆盖，已停止遍历，Core 未冻结该页。',
      ],
      [/^Core refused the page (\d+) observation: /, 'Core 拒绝记录 S6 第$1页：'],
      [/^Core refused the page (\d+) navigation admit: /, 'Core 拒绝 S6 第$1页的导航准入：'],
      [
        /^S6 page (\d+) navigation timed out; the walk stopped\.$/,
        'S6 第$1页加载超时，已停止遍历。',
      ],
      [/^S6 page walk failed: /, 'S6 页面遍历失败：'],
      [/^S6 admission refused without navigating: /, 'S6 准入被拒绝，未执行页面跳转：'],
      [/^S6 preparation failed without navigating: /, 'S6 准备失败，未执行页面跳转：'],
      [/^Core froze page (\d+) with (\d+) members\. /, 'Core 已冻结第$1页的 $2 个成员。'],
      [
        /^Core durably confirmed (.+) members \(group (.+)\)\. Start the collection download when ready\.$/,
        'Core 已确认 $1 个成员（组 $2）。准备就绪后可开始合集下载。',
      ],
      [
        /^Core is downloading the collection \(([^)]+)\)… per-member status so far:\n/,
        'Core 正在处理合集任务（$1）…各文件状态：\n',
      ],
      [/^collection failed: /, '合集任务失败：'],
      [/^The service worker refused the submission: /, '服务工作线程拒绝了提交：'],
      [/^Status unavailable \(([^)]+)\)\. /, '状态不可用（$1）。'],
      [/^Refused \(([^)]+)\)\. /, '已拒绝（$1）。'],
      [
        /^Accepted by Core \(lineage (.+)\)\. Polling the Core-owned projection…$/,
        'Core 已受理（任务标识 $1），正在读取 Core 状态…',
      ],
    ];
    for (const [pattern, replacement] of patterns) {
      text = text.replace(pattern, replacement);
    }
    return text;
  }

  function setState(kind, text) {
    stateBox.className = `state ${kind}`;
    stateBox.textContent = localizeUiMessage(text);
  }

  const scanErrorDetails = document.getElementById('scan-error-details');
  const scanErrorRaw = document.getElementById('scan-error-raw');

  function isChromeMissingPageAccessDiagnostic(raw) {
    return (
      /Cannot access contents of (?:url|the page)/i.test(raw) &&
      /Extension manifest must request permission to access this host/i.test(raw)
    );
  }

  function setInitialScanError(error) {
    const raw = String(error);
    scanErrorRaw.textContent = raw;
    scanErrorDetails.hidden = false;
    if (isChromeMissingPageAccessDiagnostic(raw)) {
      setState(
        'FAILED',
        '页面扫描失败：当前页面不允许扩展读取内容。请检查扩展的网站访问权限，或打开可访问的 http/https 页面后重试。未自动申请权限。',
      );
      return;
    }
    setState('FAILED', `页面扫描失败：${raw}`);
  }

  const STRUCTURED_FORM_OPERATION_FIELDS = Object.freeze({
    S6_PREPARE_COLLECTION: Object.freeze(['s6-identity', 's6-kind', 's6-from', 's6-to']),
    V02_ADD_DOWNLOAD: Object.freeze(['v02-target-ref', 'v02-output-root']),
  });
  const STRUCTURED_FIELD_KINDS = Object.freeze(['text', 'select', 'integer']);
  const STRUCTURED_FORM_DESCRIPTOR = Object.freeze({
    schemaVersion: 1,
    operations: Object.freeze({
      S6_PREPARE_COLLECTION: Object.freeze({
        fields: Object.freeze([
          Object.freeze({
            id: 's6-identity',
            mount: 's6-identity-field',
            kind: 'text',
            required: true,
            placeholder: 'playlist/my-list',
          }),
          Object.freeze({
            id: 's6-kind',
            mount: 's6-kind-field',
            kind: 'select',
            defaultValue: 'playlist',
            options: Object.freeze([
              Object.freeze({ value: 'playlist', label: '播放列表' }),
              Object.freeze({ value: 'gallery', label: '图片合集' }),
            ]),
          }),
          Object.freeze({
            id: 's6-from',
            mount: 's6-from-field',
            kind: 'integer',
            required: true,
            defaultValue: '1',
            min: 1,
            max: 10000,
          }),
          Object.freeze({
            id: 's6-to',
            mount: 's6-to-field',
            kind: 'integer',
            required: true,
            defaultValue: '1',
            min: 1,
            max: 10000,
          }),
        ]),
      }),
      V02_ADD_DOWNLOAD: Object.freeze({
        fields: Object.freeze([
          Object.freeze({
            id: 'v02-target-ref',
            mount: 'v02-target-ref-field',
            kind: 'text',
            required: true,
            placeholder: 'ref:your-host-target',
          }),
          Object.freeze({
            id: 'v02-output-root',
            mount: 'v02-output-root-field',
            kind: 'text',
            required: true,
            placeholder: 'C:\\Users\\me\\Downloads',
          }),
        ]),
      }),
    }),
  });

  function validateStructuredFormDescriptor(descriptor) {
    if (!descriptor || descriptor.schemaVersion !== 1 || !descriptor.operations) return false;
    const operationIds = Object.keys(STRUCTURED_FORM_OPERATION_FIELDS);
    const actualOperationIds = Object.keys(descriptor.operations);
    if (
      actualOperationIds.length !== operationIds.length ||
      actualOperationIds.some((operationId) => !operationIds.includes(operationId))
    ) {
      return false;
    }
    for (const operationId of operationIds) {
      const operation = descriptor.operations[operationId];
      if (!operation || !Array.isArray(operation.fields)) return false;
      const allowedFieldIds = STRUCTURED_FORM_OPERATION_FIELDS[operationId];
      if (operation.fields.length !== allowedFieldIds.length) return false;
      const seen = new Set();
      for (const field of operation.fields) {
        if (
          !field ||
          !allowedFieldIds.includes(field.id) ||
          !STRUCTURED_FIELD_KINDS.includes(field.kind) ||
          typeof field.mount !== 'string' ||
          field.mount === '' ||
          seen.has(field.id)
        ) {
          return false;
        }
        seen.add(field.id);
        if (
          field.kind === 'select' &&
          (!Array.isArray(field.options) ||
            field.options.length === 0 ||
            field.options.some(
              (option) =>
                !option || typeof option.value !== 'string' || typeof option.label !== 'string',
            ))
        ) {
          return false;
        }
        if (
          field.kind === 'integer' &&
          (!Number.isSafeInteger(field.min) ||
            !Number.isSafeInteger(field.max) ||
            field.max < field.min)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  function structuredFormField(operationId, fieldId) {
    const operation = STRUCTURED_FORM_DESCRIPTOR.operations[operationId];
    return operation ? operation.fields.find((field) => field.id === fieldId) : undefined;
  }

  function renderStructuredForm(operationId, descriptor = STRUCTURED_FORM_DESCRIPTOR) {
    if (
      !validateStructuredFormDescriptor(descriptor) ||
      !Object.prototype.hasOwnProperty.call(STRUCTURED_FORM_OPERATION_FIELDS, operationId)
    ) {
      return false;
    }
    const fields = descriptor.operations[operationId].fields;
    const mounts = fields.map((field) => document.getElementById(field.mount));
    if (mounts.some((mount) => !mount)) return false;
    fields.forEach((field, index) => {
      const control = document.createElement(field.kind === 'select' ? 'select' : 'input');
      control.id = field.id;
      if (field.kind === 'select') {
        for (const option of field.options) {
          const optionNode = document.createElement('option');
          optionNode.value = option.value;
          optionNode.textContent = option.label;
          control.appendChild(optionNode);
        }
        control.value = field.defaultValue || field.options[0].value;
      } else {
        control.type = 'text';
        control.value = field.defaultValue || '';
        control.placeholder = field.placeholder || '';
        control.required = field.required === true;
        if (field.kind === 'integer') control.setAttribute('inputmode', 'numeric');
      }
      mounts[index].appendChild(control);
    });
    return true;
  }

  function renderStructuredForms() {
    if (!validateStructuredFormDescriptor(STRUCTURED_FORM_DESCRIPTOR)) return false;
    return Object.keys(STRUCTURED_FORM_OPERATION_FIELDS).every((operationId) =>
      renderStructuredForm(operationId),
    );
  }

  const structuredFormsReady = renderStructuredForms();

  function createSingleFlightPollController({ intervalMs, request, isFinal, apply, onError }) {
    let current = null;
    let generation = 0;

    function clearRunTimer(run) {
      if (run.timer !== null) {
        clearInterval(run.timer);
        run.timer = null;
      }
    }

    async function tick(run) {
      if (current !== run || run.inFlight || run.latched) return;
      run.inFlight = true;
      try {
        const payload = await request(run.identity, run.generation);
        if (current !== run || run.latched) return;
        if (isFinal(payload)) {
          run.latched = true;
          clearRunTimer(run);
        }
        apply(payload, run);
      } catch (error) {
        if (current !== run || run.latched) return;
        if (onError(error, run) === true) {
          run.latched = true;
          clearRunTimer(run);
        }
      } finally {
        run.inFlight = false;
      }
    }

    function stop() {
      if (current !== null) clearRunTimer(current);
      current = null;
    }

    function start(identity) {
      stop();
      const run = {
        identity,
        generation: ++generation,
        startedAt: Date.now(),
        inFlight: false,
        latched: false,
        timer: null,
      };
      current = run;
      run.timer = setInterval(() => tick(run), intervalMs);
      void tick(run);
    }

    return { start, stop };
  }

  /** Injected into the page (self-contained; returns plain data only). */
  function scrapeAttachmentLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const candidates = anchors
      .map((anchor) => ({ href: anchor.href, text: (anchor.textContent || '').trim() }))
      .filter((item) => /^https?:\/\//i.test(item.href));
    return { links: candidates.slice(0, 20), observedCount: candidates.length };
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  function pollJourney(observationId) {
    const started = Date.now();
    const timer = setInterval(async () => {
      let payload = null;
      try {
        payload = await chrome.runtime.sendMessage({
          kind: 'S2_JOURNEY_STATUS',
          observationId,
        });
      } catch (error) {
        clearInterval(timer);
        setState(
          'UNKNOWN',
          `journey status unreadable (service worker may have restarted): ${String(error)}`,
        );
        return;
      }
      const journey = payload && payload.journey;
      if (!journey) {
        clearInterval(timer);
        setState(
          'UNKNOWN',
          'the journey is unknown to the service worker (fresh worker or invalid id)',
        );
        return;
      }
      if (journey.status === 'RUNNING') {
        setState(
          'RUNNING',
          `Running the S2 journey (${Math.round((Date.now() - started) / 1000)}s)…`,
        );
        return;
      }
      clearInterval(timer);
      if (journey.status === 'COMPLETE') {
        const terminal = journey.terminal || {};
        setState(
          'COMPLETE',
          `Core terminal projection (verbatim):\n${JSON.stringify(terminal, null, 2)}`,
        );
        return;
      }
      const failure = journey.failure || { stage: 'FAILED', detail: '未知错误' };
      const terminalText = journey.terminal
        ? `\nCore terminal: ${JSON.stringify(journey.terminal)}`
        : '';
      setState('FAILED', `任务失败（阶段：${failure.stage}）：${failure.detail}${terminalText}`);
    }, 300);
  }

  async function startDownload(row, digest, contentTypePrefix) {
    const selection = {
      kind: 'S2_SELECT_ATTACHMENT',
      tabId: row.dataset.tabId ? Number(row.dataset.tabId) : -1,
      pageUrl: row.dataset.pageUrl || '',
      linkUrl: row.dataset.href,
      linkText: row.dataset.text || '',
      ...(digest ? { expectedSha256: digest } : {}),
      ...(contentTypePrefix ? { contentTypePrefix } : {}),
    };
    let response = null;
    try {
      response = await chrome.runtime.sendMessage(selection);
    } catch (error) {
      setState('FAILED', `selection rejected: ${String(error)}`);
      return;
    }
    if (!response || response.ok !== true) {
      setState('FAILED', `selection rejected: ${(response && response.error) || 'unknown error'}`);
      return;
    }
    setState('RUNNING', 'Journey accepted; the service worker is acquiring…');
    pollJourney(response.observationId);
  }

  function renderRow(tab, item) {
    const li = document.createElement('li');
    li.dataset.href = item.href;
    li.dataset.text = item.text;
    li.dataset.tabId = String(tab.id);
    li.dataset.pageUrl = tab.url || '';

    const link = document.createElement('div');
    link.className = 'link';
    link.textContent = `${item.text || '（未命名链接）'} — ${item.href}`;
    li.appendChild(link);

    // A checked row is only a local, explicitly selected S5 PREVIEW member.
    // It NEVER starts individual S2 acquisition or commits group Core truth.
    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.setAttribute('aria-label', '将此链接加入 S5 批量预览');
    li.appendChild(groupCheckbox);
    s5ObservedRows.push({ checkbox: groupCheckbox, href: item.href, text: item.text });

    const digest = document.createElement('input');
    digest.type = 'text';
    digest.placeholder = '已知 SHA-256（可选，用于加强目标校验）';
    li.appendChild(digest);

    const contentType = document.createElement('input');
    contentType.type = 'text';
    contentType.placeholder = '预期内容类型前缀（可选，例如 application/octet-stream）';
    li.appendChild(contentType);

    const button = document.createElement('button');
    button.textContent = '使用 xDownload 下载';
    button.addEventListener('click', async () => {
      // Optional digest: when entered it must be a canonical SHA-256; the
      // journey never requires it (F01).
      const value = digest.value.trim().toLowerCase();
      if (value !== '' && !/^[0-9a-f]{64}$/.test(value)) {
        setState('FAILED', '填写的 SHA-256 必须是 64 位十六进制字符串；不填写也可以。');
        return;
      }
      // F03: a cross-origin selected member needs the scoped host permission
      // for exactly its own origin, requested inside this explicit user
      // gesture. A denial is a truthful refusal, never a silent widening.
      try {
        const pageOrigin = new URL(tab.url).origin;
        const linkOrigin = new URL(item.href).origin;
        if (linkOrigin !== pageOrigin) {
          const granted = await chrome.permissions.request({ origins: [`${linkOrigin}/*`] });
          if (!granted) {
            setState(
              'FAILED',
              `scoped host permission for ${linkOrigin} was not granted; the cross-origin attachment was not acquired`,
            );
            return;
          }
        }
      } catch (error) {
        setState('FAILED', `scoped host permission request failed: ${String(error)}`);
        return;
      }
      void startDownload(
        li,
        value === '' ? undefined : value,
        contentType.value.trim() || undefined,
      );
    });
    li.appendChild(button);
    list.appendChild(li);
  }

  // ------------------------------------------------------------------ S5 batch
  // The prepare gesture is browser-observed only; Core independently freezes
  // the member tuple (PREPARE), mints the confirmation authority (CONFIRM
  // with a single-use Core challenge), and performs every member download
  // itself (EXECUTE). This UI renders verbatim Core facts — it never derives
  // a status, member identity or terminal of its own.
  const s5BatchBox = document.getElementById('s5-batch');
  const s5FrozenList = document.getElementById('s5-frozen');
  const s5ConfirmButton = document.getElementById('s5-confirm');
  const s5ExecuteButton = document.getElementById('s5-execute');
  const s5BatchResult = document.getElementById('s5-batch-result');
  let s5Prepared = null;
  let s5Confirmed = null;

  function setS5State(kind, text) {
    s5BatchResult.className = `state ${kind}`;
    s5BatchResult.textContent = localizeUiMessage(text);
  }

  function renderFrozenMembers(facts) {
    const members = Array.isArray(facts.members) ? facts.members : [];
    s5FrozenList.textContent = '';
    for (const member of members) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.memberId = String(member.memberId);
      label.appendChild(checkbox);
      label.appendChild(
        document.createTextNode(` ${member.text || '（未命名）'} — ${member.href}`),
      );
      li.appendChild(label);
      s5FrozenList.appendChild(li);
    }
  }

  function selectedFrozenMemberIds() {
    return Array.from(s5FrozenList.querySelectorAll('input[type=checkbox]:checked')).map(
      (checkbox) => checkbox.dataset.memberId,
    );
  }

  s5PrepareButton.addEventListener('click', async () => {
    s5PrepareButton.disabled = true;
    try {
      const currentTab = await activeTab();
      if (
        !currentTab ||
        !s5ObservedTab ||
        currentTab.id !== s5ObservedTab.id ||
        (currentTab.url || '') !== s5ObservedTab.url
      ) {
        s5PreviewResult.textContent =
          'S5 已拒绝：观察后标签页发生变化；请重新扫描页面再确认批量任务。';
        return;
      }
      if (!s5ObservedComplete) {
        s5PreviewResult.textContent =
          'S5 已拒绝：页面链接超过 20 个，当前扫描不完整，不能将部分链接视为整个页面的批量范围。';
        return;
      }
      const latest = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: scrapeAttachmentLinks,
      });
      const observed = latest && latest[0] ? latest[0].result : null;
      if (
        !observed ||
        !Array.isArray(observed.links) ||
        observed.observedCount !== s5ObservedRows.length ||
        observed.links.length !== s5ObservedRows.length ||
        observed.links.some(
          (item, index) =>
            item.href !== s5ObservedRows[index].href || item.text !== s5ObservedRows[index].text,
        )
      ) {
        s5PreviewResult.textContent = 'S5 已拒绝：观察后页面成员发生变化；请重新打开弹窗重新扫描。';
        return;
      }
      if (new Set(observed.links.map((item) => item.href)).size !== observed.links.length) {
        s5PreviewResult.textContent = 'S5 已拒绝：重复资源地址需要可信且不同的成员标识。';
        return;
      }
      const response = await chrome.runtime.sendMessage({
        kind: 'S5_PREPARE_CURRENT_PAGE_GROUP',
        tabId: currentTab.id,
        pageUrl: currentTab.url,
        observedMemberCount: observed.links.length,
        members: observed.links.map((item) => ({ href: item.href, text: item.text })),
      });
      if (!response || response.ok !== true) {
        s5PreviewResult.textContent = `S5 准入被拒绝，未开始下载：${(response && response.error) || 'UNKNOWN'}`;
        return;
      }
      s5Prepared = {
        contractId: response.contractId,
        prepareId: (response.facts && response.facts.prepareId) || '',
        snapshotId: (response.facts && response.facts.snapshotId) || '',
        digest: (response.facts && response.facts.observedTupleDigest) || '',
      };
      renderFrozenMembers(response.facts || {});
      s5BatchBox.hidden = false;
      s5ExecuteButton.disabled = true;
      s5PreviewResult.textContent = `Core 已冻结 ${String(
        (response.facts &&
          Array.isArray(response.facts.members) &&
          response.facts.members.length) ||
          0,
      )} 个成员（摘要 ${String(s5Prepared.digest).slice(0, 16)}…）。请勾选批量文件并确认。`;
      setS5State('RUNNING', 'Awaiting your batch confirmation — nothing is downloaded yet.');
    } catch (error) {
      s5PreviewResult.textContent = `S5 准备失败，未开始下载：${String(error)}`;
    } finally {
      s5PrepareButton.disabled = false;
    }
  });

  s5ConfirmButton.addEventListener('click', async () => {
    if (!s5Prepared) {
      setS5State('FAILED', 'No frozen Core group; request S5 group admission first.');
      return;
    }
    const selected = selectedFrozenMemberIds();
    if (selected.length === 0) {
      setS5State('FAILED', 'Select at least one frozen member for the batch.');
      return;
    }
    s5ConfirmButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'S5_CONFIRM_GROUP',
        contractId: s5Prepared.contractId,
        prepareId: s5Prepared.prepareId,
        snapshotId: s5Prepared.snapshotId,
        selectedMemberIds: selected,
      });
      if (!response || response.ok !== true) {
        setS5State(
          'FAILED',
          `Core refused the confirmation: ${(response && response.error) || 'UNKNOWN'}`,
        );
        return;
      }
      const facts = response.facts || {};
      s5Confirmed = {
        contractId: s5Prepared.contractId,
        confirmedGroupId: facts.confirmedGroupId || '',
        snapshotId: s5Prepared.snapshotId,
      };
      s5ExecuteButton.disabled = false;
      setS5State(
        'RUNNING',
        `Core durably confirmed ${String(Array.isArray(facts.selectedMemberIds) ? facts.selectedMemberIds.length : '?')} members (group ${String(facts.confirmedGroupId || '')}). Start the batch download when ready.`,
      );
    } catch (error) {
      setS5State('FAILED', `Confirmation failed: ${String(error)}`);
    } finally {
      s5ConfirmButton.disabled = false;
    }
  });

  function renderTerminal(facts) {
    const members = Array.isArray(facts.members) ? facts.members : [];
    const lines = members.map(
      (member) =>
        `[${member.outcome === 'ACQUIRED' && member.accepted ? 'OK' : member.outcome}] ${member.href} — ${member.detail}`,
    );
    // The state class mirrors the verbatim Core aggregate only: COMPLETE
    // renders green, anything else (PARTIAL/…) renders the honest mixed
    // style — the popup never upgrades a partial batch to green.
    const aggregate = facts.terminal || {};
    const kind = aggregate.requestFulfillment === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
    setS5State(
      kind,
      `${lines.join('\n')}\n\nCore aggregate terminal (verbatim):\n${JSON.stringify(facts.terminal, null, 2)}`,
    );
  }

  function pollS5Terminal() {
    const started = Date.now();
    const timer = setInterval(async () => {
      let payload = null;
      try {
        payload = await chrome.runtime.sendMessage({
          kind: 'S5_GROUP_JOURNEY_STATUS',
          contractId: s5Confirmed.contractId,
        });
      } catch (error) {
        clearInterval(timer);
        setS5State('UNKNOWN', `journey status unreadable: ${String(error)}`);
        return;
      }
      const facts = payload && payload.facts;
      if (payload && payload.ok === true && payload.status === 'TERMINAL') {
        clearInterval(timer);
        renderTerminal(facts || {});
        return;
      }
      if (payload && payload.ok !== true) {
        clearInterval(timer);
        setS5State('FAILED', `batch failed: ${payload.error || 'unknown failure'}`);
        return;
      }
      setS5State(
        'RUNNING',
        `Core is downloading the batch (${Math.round((Date.now() - started) / 1000)}s)… per-member status so far:\n${JSON.stringify(
          (facts && facts.members) || [],
          null,
          2,
        )}`,
      );
    }, 700);
  }

  s5ExecuteButton.addEventListener('click', async () => {
    if (!s5Confirmed) {
      setS5State('FAILED', 'Confirm the batch with Core before downloading.');
      return;
    }
    s5ExecuteButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'S5_EXECUTE_GROUP',
        contractId: s5Confirmed.contractId,
        confirmedGroupId: s5Confirmed.confirmedGroupId,
        snapshotId: s5Confirmed.snapshotId,
      });
      if (!response || response.ok !== true) {
        setS5State(
          'FAILED',
          `Core refused the execution: ${(response && response.error) || 'UNKNOWN'}`,
        );
        return;
      }
      if (response.status === 'TERMINAL') {
        renderTerminal(response.facts || {});
        return;
      }
      pollS5Terminal();
    } catch (error) {
      setS5State('FAILED', `Execution failed: ${String(error)}`);
    }
  });

  s5PreviewButton.addEventListener('click', async () => {
    // Selection is frozen against the initially observed page and tab.
    // A navigation between scanning and confirmation must never silently
    // enlarge a current-page scope or reuse stale observations.
    try {
      const currentTab = await activeTab();
      if (
        !currentTab ||
        !s5ObservedTab ||
        currentTab.id !== s5ObservedTab.id ||
        (currentTab.url || '') !== s5ObservedTab.url
      ) {
        s5PreviewResult.textContent =
          '扫描后页面已发生变化；请重新打开 xDownload 获取新的候选快照。';
        return;
      }
      const selected = s5ObservedRows.filter((row) => row.checkbox.checked);
      if (selected.length === 0) {
        s5PreviewResult.textContent = '请至少选择一个已观察到的文件进行预览。';
        return;
      }
      const uniqueHrefs = new Set(selected.map((row) => row.href));
      if (uniqueHrefs.size !== selected.length) {
        s5PreviewResult.textContent = '重复资源地址需要不同的可信成员标识；未确认任何批量任务。';
        return;
      }
      const subset = selected.length !== s5ObservedRows.length;
      s5PreviewResult.textContent = [
        `S5 仅预览：已选择 ${selected.length} 个 / 观察到 ${s5ObservedRows.length} 个链接。`,
        subset
          ? '该子集需要单独确认 selected_collection_members 后继范围。'
          : '当前页面成员仅为观察结果；续传范围为 NONE。',
        '尚未创建 Core 快照或下载任务，也没有 Coverage 或 COMPLETE 终态。',
      ].join(' ');
    } catch (error) {
      s5PreviewResult.textContent = `S5 预览失败，未执行获取：${String(error)}`;
    }
  });

  (async () => {
    try {
      const tab = await activeTab();
      if (!tab || tab.id === undefined) {
        setState('UNKNOWN', 'no active tab');
        return;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeAttachmentLinks,
      });
      const observed = results && results[0] && results[0].result ? results[0].result : null;
      const links = observed && Array.isArray(observed.links) ? observed.links : [];
      if (links.length === 0) {
        setState('UNKNOWN', 'no http(s) attachment links found on the current page');
        return;
      }
      list.textContent = '';
      s5ObservedTab = { id: tab.id, url: tab.url || '' };
      s5ObservedComplete = observed.observedCount === links.length;
      s5ObservedRows.length = 0;
      for (const item of links) {
        renderRow(tab, item);
      }
      s5Group.hidden = false;
      if (!s5ObservedComplete) {
        s5PreviewResult.textContent =
          '只扫描了页面前 20 个链接；无法确认完整的 S5 当前页面成员范围。';
      }
      setState(
        'RUNNING',
        '选择一个文件开始单项下载，或预览当前页面的 S5 批量任务（不会自动下载）。',
      );
      const s6SectionEl = document.getElementById('s6-collection');
      if (s6SectionEl !== null) {
        s6SectionEl.hidden = false;
      }
    } catch (error) {
      setInitialScanError(error);
    }
  })();

  // ------------------------------------------------------------------ S6 collection
  // The declared page range is frozen by Core BEFORE any navigation effect
  // (PREPARE), every later page needs a durable Core navigation admit, and
  // Core alone freezes the observed page members (RECORD). The popup only
  // navigates along the page's own declared next-page edge inside the frozen
  // range and renders verbatim Core facts — it never derives a member
  // identity, coverage claim or terminal of its own.
  const s6IdentityInput = document.getElementById('s6-identity');
  const s6KindSelect = document.getElementById('s6-kind');
  const s6FromInput = document.getElementById('s6-from');
  const s6ToInput = document.getElementById('s6-to');
  const s6PrepareButton = document.getElementById('s6-prepare');
  const s6PrepareResult = document.getElementById('s6-prepare-result');
  const s6WalkBox = document.getElementById('s6-walk');
  const s6MemberList = document.getElementById('s6-members');
  const s6NextPageButton = document.getElementById('s6-next-page');
  const s6ConfirmButton = document.getElementById('s6-confirm');
  const s6ExecuteButton = document.getElementById('s6-execute');
  const s6BatchResult = document.getElementById('s6-batch-result');
  let s6Prepared = null;
  let s6Confirmed = null;
  let s6CurrentPage = 0;
  let s6NextPageHref = null;
  let s6Walking = false;

  function setS6State(kind, text) {
    s6BatchResult.className = `state ${kind}`;
    s6BatchResult.textContent = localizeUiMessage(text);
  }

  /** Injected into the page (self-contained; returns plain data only). */
  function scrapeCollectionPage() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const candidates = anchors
      .map((anchor) => ({ href: anchor.href, text: (anchor.textContent || '').trim() }))
      .filter((item) => /^https?:\/\//i.test(item.href));
    const unique = [];
    const seen = new Set();
    for (const item of candidates) {
      if (!seen.has(item.href)) {
        seen.add(item.href);
        unique.push(item);
      }
    }
    let nextPageHref = null;
    for (const anchor of anchors) {
      // v0.1 supports one explicitly declared next-page relation, not a
      // guess based on arbitrary same-origin anchor text such as "next".
      const rel = (anchor.getAttribute('rel') || '').toLowerCase();
      if (rel.split(/\s+/u).includes('next')) {
        if (/^https?:\/\//i.test(anchor.href)) {
          nextPageHref = anchor.href;
          break;
        }
      }
    }
    // The declared continuation edge is NAVIGATION, never a collection
    // member (PRD §10.3): a pagination control must not silently become a
    // downloadable candidate of the declared range.
    const members =
      nextPageHref === null ? unique : unique.filter((item) => item.href !== nextPageHref);
    return {
      links: members.slice(0, 20),
      observedCount: members.length,
      nextPageHref,
      pageUrl: document.location.href,
    };
  }

  async function s6ScanCurrentPage() {
    const currentTab = await activeTab();
    if (!currentTab || currentTab.id === undefined || !s6Prepared) return null;
    const latest = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: scrapeCollectionPage,
    });
    return latest && latest[0] ? latest[0].result : null;
  }

  // Members accumulate across the walked pages (the confirm step selects
  // from the WHOLE declared-range collection, not just the last page); the
  // checkbox state is preserved per Core member identity across re-renders.
  const s6MemberAccum = new Map();
  const s6MemberUnchecked = new Set();

  function renderS6Members(facts, scannedLinks) {
    const memberIds = Array.isArray(facts.memberIds) ? facts.memberIds : [];
    memberIds.forEach((memberId, index) => {
      const observed = scannedLinks[index] || { href: '', text: '' };
      s6MemberAccum.set(String(memberId), {
        href: String(observed.href || ''),
        text: String(observed.text || ''),
        page: s6CurrentPage,
      });
    });
    renderS6Accum();
  }

  /** Render purely from the accumulated map (Core facts or fresh scans). */
  function renderS6Accum() {
    s6MemberList.textContent = '';
    for (const [memberId, member] of s6MemberAccum) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !s6MemberUnchecked.has(memberId);
      checkbox.dataset.memberId = memberId;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          s6MemberUnchecked.delete(memberId);
        } else {
          s6MemberUnchecked.add(memberId);
        }
      });
      label.appendChild(checkbox);
      label.appendChild(
        document.createTextNode(
          ` [p${String(member.page)}] ${member.text || '（未命名）'} — ${member.href}`,
        ),
      );
      li.appendChild(label);
      s6MemberList.appendChild(li);
    }
  }

  function selectedS6MemberIds() {
    return Array.from(s6MemberList.querySelectorAll('input[type=checkbox]:checked')).map(
      (checkbox) => checkbox.dataset.memberId,
    );
  }

  async function s6RecordPage(pageNumber) {
    const observed = await s6ScanCurrentPage();
    if (!observed || !Array.isArray(observed.links) || observed.links.length === 0) {
      setS6State(
        'FAILED',
        `S6 第 ${String(pageNumber)} 页没有发现文件链接；已停止遍历，未扩大范围。`,
      );
      return false;
    }
    // R1 P1-02: a page with more member anchors than the shipped scan admits
    // is TRUNCATED observation — recording it as the whole page could let
    // Core project false requested-scope coverage. The walk stops here
    // truthfully; the recorded pages stand, nothing is fabricated.
    if (Number(observed.observedCount) > observed.links.length) {
      setS6State(
        'FAILED',
        `S6 第 ${String(pageNumber)} 页观察到 ${String(observed.observedCount)} 个文件链接，但当前扫描只读取了 ${String(observed.links.length)} 个；为避免不完整页面造成虚假覆盖，已停止遍历，Core 未冻结该页。`,
      );
      return false;
    }
    const response = await chrome.runtime.sendMessage({
      kind: 'S6_PAGE_RECORD',
      contractId: s6Prepared.contractId,
      prepareId: s6Prepared.prepareId,
      snapshotId: s6Prepared.snapshotId,
      pageNumber,
      members: observed.links.map((item) => ({ href: item.href, text: item.text })),
      // R1 P1-01: the actually observed page location travels with the
      // record; Core verifies it against the prepare/admit before freezing.
      pageUrl: String(observed.pageUrl || ''),
    });
    if (!response || response.ok !== true) {
      setS6State(
        'FAILED',
        `Core refused the page ${String(pageNumber)} observation: ${(response && response.error) || 'UNKNOWN'}`,
      );
      return false;
    }
    s6CurrentPage = pageNumber;
    s6NextPageHref = pageNumber < s6Prepared.toPage ? observed.nextPageHref : null;
    renderS6Members(response.facts || {}, observed.links);
    s6NextPageButton.disabled = pageNumber >= s6Prepared.toPage || s6NextPageHref === null;
    setS6State(
      'RUNNING',
      `Core froze page ${String(pageNumber)} with ${String(
        (response.facts &&
          Array.isArray(response.facts.memberIds) &&
          response.facts.memberIds.length) ||
          0,
      )} 个成员。取消不需要的成员，然后继续下一指定页或确认。`,
    );
    return true;
  }

  s6PrepareButton.addEventListener('click', async () => {
    s6PrepareButton.disabled = true;
    try {
      if (
        !structuredFormsReady ||
        !s6IdentityInput ||
        !s6KindSelect ||
        !s6FromInput ||
        !s6ToInput
      ) {
        s6PrepareResult.textContent = 'S6 已拒绝：本地表单描述不受支持，未提交任何任务。';
        return;
      }
      const identity = s6IdentityInput.value.trim();
      const fromPage = Number(s6FromInput.value.trim());
      const toPage = Number(s6ToInput.value.trim());
      const fromRules = structuredFormField('S6_PREPARE_COLLECTION', 's6-from');
      const toRules = structuredFormField('S6_PREPARE_COLLECTION', 's6-to');
      if (!/^[A-Za-z0-9_./:-]{1,256}$/u.test(identity) || identity.includes('//')) {
        s6PrepareResult.textContent =
          'S6 已拒绝：合集标识必须是长度受限的路径（例如 playlist/my-list）。';
        return;
      }
      if (
        !Number.isSafeInteger(fromPage) ||
        !Number.isSafeInteger(toPage) ||
        fromPage < fromRules.min ||
        toPage < fromPage ||
        toPage > toRules.max
      ) {
        s6PrepareResult.textContent =
          'S6 已拒绝：页码范围必须是有上限的闭区间，且从 1 开始并满足起始页不大于结束页。';
        return;
      }
      // R1 P2-01: the shipped v0.1 installed lane binds declared-range page 1
      // to the CURRENTLY OPEN collection page (the prepare freezes this exact
      // URL). A range starting later has no executable, provably-current
      // first page here — refuse truthfully instead of admitting an
      // unreachable selection.
      if (fromPage !== 1) {
        s6PrepareResult.textContent =
          'S6 已拒绝：当前版本只能从已打开的页面开始遍历（fromPage 必须为 1）。请先打开目标起始页，再设置页码范围。';
        return;
      }
      const currentTab = await activeTab();
      if (!currentTab || currentTab.id === undefined) {
        s6PrepareResult.textContent = 'S6 已拒绝：没有活动标签页；请重新打开弹窗。';
        return;
      }
      // The declared walk navigates the collection origin's own pages. The
      // scoped host permission for EXACTLY this origin (an explicit user
      // decision inside this gesture) is what lets the popup re-scan each
      // walked page after navigation; activeTab alone dies with the first
      // navigation. The request is best-effort inside this gesture: a denial
      // OR an environment without a gesture (programmatic open) is honest —
      // the walk then only proceeds on pages the extension can already scan
      // (pre-granted site access), and stops truthfully everywhere else.
      let scopedNote = '';
      try {
        const origin = new URL(currentTab.url).origin;
        const scopedGranted = await chrome.permissions.request({ origins: [`${origin}/*`] });
        if (!scopedGranted) {
          scopedNote = 'S6：未获准访问合集来源；只能遍历扩展已具备访问权限的页面。';
        }
      } catch (error) {
        scopedNote = `S6：无法请求来源权限（${String(error)}）；只能遍历扩展已具备访问权限的页面。`;
      }
      const response = await chrome.runtime.sendMessage({
        kind: 'S6_PREPARE_COLLECTION',
        tabId: currentTab.id,
        pageUrl: currentTab.url,
        collectionIdentity: identity,
        collectionKind: s6KindSelect.value === 'gallery' ? 'gallery' : 'playlist',
        fromPage,
        toPage,
      });
      if (!response || response.ok !== true) {
        s6PrepareResult.textContent = `S6 准入被拒绝，未执行页面跳转：${(response && response.error) || 'UNKNOWN'}（原始响应：${JSON.stringify(response)}）`;
        return;
      }
      s6Prepared = {
        contractId: response.contractId,
        prepareId: (response.facts && response.facts.prepareId) || '',
        snapshotId: (response.facts && response.facts.snapshotId) || '',
        fromPage,
        toPage,
      };
      s6WalkBox.hidden = false;
      s6ExecuteButton.disabled = true;
      s6PrepareResult.textContent = `${scopedNote ? `${scopedNote} ` : ''}Core 已冻结合集任务： ${identity}，页码范围 ${String(
        fromPage,
      )}..${String(toPage)}（摘要 ${String(
        (response.facts && response.facts.observedTupleDigest) || '',
      ).slice(0, 16)}…）。指定范围是唯一允许的导航边界。`;
      // Page 1 is the already-open current page: record it (no navigation).
      const recorded = await s6RecordPage(1);
      if (recorded && s6Prepared.toPage === 1) {
        setS6State('RUNNING', '指定范围只有一页，已完成扫描。请取消不需要的成员，然后确认。');
      }
    } catch (error) {
      s6PrepareResult.textContent = `S6 准备失败，未执行页面跳转：${String(error)}`;
    } finally {
      s6PrepareButton.disabled = false;
    }
  });

  s6NextPageButton.addEventListener('click', async () => {
    if (!s6Prepared || s6Walking) {
      return;
    }
    const nextPage = s6CurrentPage + 1;
    if (nextPage > s6Prepared.toPage) {
      setS6State(
        'RUNNING',
        'The declared range is fully walked; Core will never treat extra pages as part of this collection.',
      );
      return;
    }
    if (!s6NextPageHref) {
      setS6State(
        'FAILED',
        'The page declares no next-page edge; the declared walk stopped truthfully. You may still confirm the recorded members.',
      );
      return;
    }
    s6Walking = true;
    s6NextPageButton.disabled = true;
    try {
      const admitted = await chrome.runtime.sendMessage({
        kind: 'S6_PAGE_ADMIT',
        contractId: s6Prepared.contractId,
        prepareId: s6Prepared.prepareId,
        snapshotId: s6Prepared.snapshotId,
        pageNumber: nextPage,
        // R1 P1-01: Core durably pins THIS exact href as the only approved
        // navigation target for the page; RECORD verifies the landing URL
        // against it.
        nextPageUrl: s6NextPageHref,
      });
      if (!admitted || admitted.ok !== true) {
        setS6State(
          'FAILED',
          `Core refused the page ${String(nextPage)} navigation admit: ${(admitted && admitted.error) || 'UNKNOWN'}`,
        );
        return;
      }
      // The durable navigation intent is recorded; only now does the
      // privileged browser follow the page's own declared next edge. The
      // walked tab is the CURRENT active tab (fresh query — a stale tab
      // binding must never navigate a page outside the user's view).
      const walkedTab = await activeTab();
      if (!walkedTab || walkedTab.id === undefined) {
        setS6State('FAILED', 'S6 page walk refused: no active tab to navigate.');
        return;
      }
      await chrome.tabs.update(walkedTab.id, { url: s6NextPageHref });
      const settled = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(false);
        }, 20000);
        const listener = (tabId, changeInfo) => {
          if (tabId === walkedTab.id && changeInfo.status === 'complete') {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(true);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      if (!settled) {
        setS6State('FAILED', `S6 page ${String(nextPage)} navigation timed out; the walk stopped.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (s5ObservedTab !== null) {
        s5ObservedTab.url = s6NextPageHref;
      }
      await s6RecordPage(nextPage);
    } catch (error) {
      setS6State('FAILED', `S6 page walk failed: ${String(error)}`);
    } finally {
      s6Walking = false;
      s6NextPageButton.disabled =
        !s6Prepared || s6CurrentPage >= s6Prepared.toPage || s6NextPageHref === null;
    }
  });

  s6ConfirmButton.addEventListener('click', async () => {
    if (!s6Prepared) {
      setS6State('FAILED', 'No frozen Core collection; request S6 collection admission first.');
      return;
    }
    const selected = selectedS6MemberIds();
    if (selected.length === 0) {
      setS6State('FAILED', 'Select at least one frozen member for the collection batch.');
      return;
    }
    s6ConfirmButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'S6_CONFIRM_COLLECTION',
        contractId: s6Prepared.contractId,
        prepareId: s6Prepared.prepareId,
        snapshotId: s6Prepared.snapshotId,
        selectedMemberIds: selected,
      });
      if (!response || response.ok !== true) {
        setS6State(
          'FAILED',
          `Core refused the confirmation: ${(response && response.error) || 'UNKNOWN'}`,
        );
        return;
      }
      const facts = response.facts || {};
      s6Confirmed = {
        contractId: s6Prepared.contractId,
        confirmedGroupId: facts.confirmedGroupId || '',
        snapshotId: s6Prepared.snapshotId,
      };
      s6ExecuteButton.disabled = false;
      setS6State(
        'RUNNING',
        `Core durably confirmed ${String(Array.isArray(facts.selectedMemberIds) ? facts.selectedMemberIds.length : '?')} members (group ${String(facts.confirmedGroupId || '')}). Start the collection download when ready.`,
      );
    } catch (error) {
      setS6State('FAILED', `Confirmation failed: ${String(error)}`);
    } finally {
      s6ConfirmButton.disabled = false;
    }
  });

  function renderS6Terminal(facts) {
    const members = Array.isArray(facts.members) ? facts.members : [];
    const lines = members.map(
      (member) =>
        `[${member.outcome === 'ACQUIRED' && member.accepted ? 'OK' : member.outcome}] ${member.href} — ${member.detail}`,
    );
    // The state class mirrors the verbatim Core aggregate only: COMPLETE
    // renders green, anything else (PARTIAL/TRUNCATED/UNKNOWN…) renders the
    // honest mixed style — the popup never upgrades a partial or truncated
    // collection to green, and budget exhaustion is never a COMPLETE.
    const aggregate = facts.terminal || {};
    const kind = aggregate.requestFulfillment === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL';
    setS6State(
      kind,
      `${lines.join('\n')}\n\nCore aggregate terminal (verbatim):\n${JSON.stringify(facts.terminal, null, 2)}`,
    );
  }

  const s6PollController = createSingleFlightPollController({
    intervalMs: 700,
    request: (contractId) =>
      chrome.runtime.sendMessage({
        kind: 'S6_COLLECTION_JOURNEY_STATUS',
        contractId,
      }),
    isFinal: (payload) =>
      Boolean(
        payload && ((payload.ok === true && payload.status === 'TERMINAL') || payload.ok !== true),
      ),
    apply: (payload, run) => {
      const facts = payload && payload.facts;
      if (payload && payload.ok === true && payload.status === 'TERMINAL') {
        renderS6Terminal(facts || {});
        return;
      }
      if (payload && payload.ok !== true) {
        setS6State('FAILED', `collection failed: ${payload.error || 'unknown failure'}`);
        return;
      }
      setS6State(
        'RUNNING',
        `Core is downloading the collection (${Math.round((Date.now() - run.startedAt) / 1000)}s)… per-member status so far:\n${JSON.stringify(
          (facts && facts.members) || [],
          null,
          2,
        )}`,
      );
    },
    onError: (error) => {
      setS6State('UNKNOWN', `journey status unreadable: ${String(error)}`);
      return true;
    },
  });

  function pollS6Terminal() {
    s6PollController.start(s6Confirmed.contractId);
  }

  s6ExecuteButton.addEventListener('click', async () => {
    if (!s6Confirmed) {
      setS6State('FAILED', 'Confirm the collection with Core before downloading.');
      return;
    }
    s6PollController.stop();
    s6ExecuteButton.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'S6_EXECUTE_COLLECTION',
        contractId: s6Confirmed.contractId,
        confirmedGroupId: s6Confirmed.confirmedGroupId,
        snapshotId: s6Confirmed.snapshotId,
      });
      if (!response || response.ok !== true) {
        setS6State(
          'FAILED',
          `Core refused the execution: ${(response && response.error) || 'UNKNOWN'}`,
        );
        return;
      }
      if (response.status === 'TERMINAL') {
        renderS6Terminal(response.facts || {});
        return;
      }
      pollS6Terminal();
    } catch (error) {
      setS6State('FAILED', `Execution failed: ${String(error)}`);
    }
  });

  // ------------------------------------------------------------------ S6 restore
  // R1 P2-02: the anchored action popup auto-dismisses whenever browser
  // focus moves (official popup lifecycle) — mid-walk that orphans state
  // held only in this closure. The workflow therefore restores FROM CORE:
  // the worker persists the active journey id; this popup rebuilds its view
  // from the verbatim Core projection facts (frozen admission, recorded
  // pages with Core-minted member identities, confirmed selection) and
  // never from its own memory.
  async function s6RestoreActiveJourney() {
    let active = null;
    try {
      active = await chrome.runtime.sendMessage({ kind: 'S6_ACTIVE_COLLECTION_QUERY' });
    } catch {
      return; // no worker answer — nothing to restore, fresh open works
    }
    if (!active || active.ok !== true || !active.journey) {
      return;
    }
    const journey = active.journey;
    if (journey.status !== 'PREPARE' && journey.status !== 'WALK' && journey.status !== 'CONFIRM') {
      return;
    }
    const facts = journey.facts || {};
    const prepared = facts.prepared || {};
    const pages = Array.isArray(facts.pages) ? facts.pages : [];
    const preparedId = String(prepared.prepareId ?? facts.prepareId ?? '');
    if (preparedId === '') {
      return; // nothing restorable without the frozen admission
    }
    s6Prepared = {
      contractId: String(journey.contractId),
      prepareId: preparedId,
      snapshotId: String(prepared.snapshotId ?? facts.snapshotId ?? ''),
      fromPage: Number(prepared.fromPage ?? facts.fromPage ?? 1),
      toPage: Number(prepared.toPage ?? facts.toPage ?? 1),
    };
    s6MemberAccum.clear();
    s6MemberUnchecked.clear();
    for (const page of pages) {
      for (const member of Array.isArray(page.members) ? page.members : []) {
        s6MemberAccum.set(String(member.memberId), {
          href: String(member.href || ''),
          text: String(member.text || ''),
          page: Number(page.pageNumber),
        });
      }
    }
    s6CurrentPage = pages.length > 0 ? Number(pages[pages.length - 1].pageNumber) : 0;
    // The popup has no trustworthy cached navigation link after dismissal.
    // Only a fresh scan of the actual recorded Core page may restore it.
    s6NextPageHref = null;
    const confirmedFacts = facts.confirmed;
    if (confirmedFacts && confirmedFacts.confirmedGroupId) {
      s6Confirmed = {
        contractId: String(journey.contractId),
        confirmedGroupId: String(confirmedFacts.confirmedGroupId),
        snapshotId: s6Prepared.snapshotId,
      };
      s6ExecuteButton.disabled = false;
    }
    s6WalkBox.hidden = false;
    const s6SectionRestore = document.getElementById('s6-collection');
    if (s6SectionRestore !== null) {
      s6SectionRestore.hidden = false;
    }
    renderS6Accum();
    s6NextPageButton.disabled = true; // Re-enabled only after a fresh bound page scan.
    s6PrepareResult.textContent = `已从 Core 恢复 S6 任务 ${String(
      journey.contractId,
    )}（准入 ${s6Prepared.prepareId}；共冻结 ${String(s6MemberAccum.size)} 个成员，已遍历 ${String(pages.length)} 页。指定范围 ${String(s6Prepared.fromPage)}..${String(
      s6Prepared.toPage,
    )} 是唯一允许的导航边界。`;
    setS6State(
      'RUNNING',
      `已从 Core 恢复：已遍历 ${String(pages.length)} 个指定页面，冻结 ${String(s6MemberAccum.size)} 个成员。${
        s6Confirmed
          ? '所选成员已确认，可以开始下载合集。'
          : '请取消不需要的成员后确认，或继续遍历指定范围。'
      }`,
    );
    // R1 P2-02 continuation: the dismissed-mid-walk case leaves the browser
    // sitting on the page the durable ADMIT approved but the dead popup never
    // recorded. If the currently open page is a NEW declared-range page
    // (same collection origin, different from the last recorded page), the
    // scan is real and Core alone decides whether the observation qualifies —
    // attempt the record; a typed refusal is honest and keeps the bounds.
    if (s6CurrentPage < s6Prepared.toPage && s6MemberAccum.size > 0) {
      try {
        const scanned = await s6ScanCurrentPage();
        const lastRecordedUrl = String(
          pages.length > 0 ? pages[pages.length - 1].pageUrl || '' : '',
        );
        if (
          scanned &&
          Array.isArray(scanned.links) &&
          scanned.links.length > 0 &&
          typeof scanned.pageUrl === 'string' &&
          Number(scanned.observedCount) === scanned.links.length
        ) {
          const origin = new URL(prepared.collectionOrigin).origin;
          if (new URL(scanned.pageUrl).origin !== origin) return;
          if (scanned.pageUrl !== lastRecordedUrl) {
            // A previous Core ADMIT is required for this already-navigated
            // page; RECORD independently checks its exact pinned URL.
            await s6RecordPage(s6CurrentPage + 1);
          } else if (typeof scanned.nextPageHref === 'string') {
            // Rebuild the "next" control when the popup was dismissed on an
            // ALREADY RECORDED page. Never activate it from old popup memory
            // or from a cross-origin, noncanonical or self-looping anchor.
            const next = new URL(scanned.nextPageHref);
            if (
              next.origin === origin &&
              next.href === scanned.nextPageHref &&
              next.href !== scanned.pageUrl &&
              next.username === '' &&
              next.password === '' &&
              next.search === '' &&
              next.hash === ''
            ) {
              s6NextPageHref = scanned.nextPageHref;
              s6NextPageButton.disabled = false;
            }
          }
        }
      } catch {
        // Continuation is best-effort: a refused/unavailable scan leaves the
        // restored state intact and truthful.
      }
    }
  }

  // ---------------- v0.2 Domain App submission (v0.2.1 T05 cutover) ----------------
  //
  // The explicit v0.2 submission surface: the user names the Host-issued
  // opaque target handle and the authorized output root; the service worker
  // owns the ordered fail-closed lane (origin authority → intent gate →
  // permission decision → v0.2 DOMAIN_APP_SEND → trusted Host answer). This
  // panel renders the selected target, the typed refusals verbatim and the
  // Core-owned job projection — it never fabricates status or progress.

  const v02TargetRefInput = document.getElementById('v02-target-ref');
  const v02OutputRootInput = document.getElementById('v02-output-root');
  const v02SubmitButton = document.getElementById('v02-submit');
  const v02ResultBox = document.getElementById('v02-result');
  let v02Lineage = null;

  function setV02State(kind, text) {
    v02ResultBox.className = `state ${kind}`;
    v02ResultBox.textContent = localizeUiMessage(text);
  }

  function renderV02Projection(projection) {
    const status = String(projection.status || 'UNKNOWN');
    const owner = String(projection.owner || '');
    let text = 'Core 任务状态：' + status + '（所有者：' + owner + '）。';
    const error = projection.error;
    if (error && error.code) {
      text += ' 错误：' + String(error.code) + ' — ' + String(error.message || error.code) + '。';
    }
    // Truthful progress only: rendered when Core reported a byte sample; the
    // total size stays unknown unless Core says otherwise (never fabricated).
    const progress = projection.progress;
    if (progress && typeof progress.transferredBytes === 'number') {
      text += ' 已传输：' + String(progress.transferredBytes) + ' 字节（总量未知）。';
    }
    setV02State(status, text);
  }

  const v02PollController = createSingleFlightPollController({
    intervalMs: 1000,
    request: (lineageId) => chrome.runtime.sendMessage({ kind: 'V02_JOB_STATUS', lineageId }),
    isFinal: (answer) =>
      !answer ||
      answer.outcome !== 'PROJECTION' ||
      String(answer.projection && answer.projection.status) !== 'RUNNING',
    apply: (answer) => {
      if (!answer || answer.outcome !== 'PROJECTION') {
        const code = answer && answer.code ? String(answer.code) : 'UNKNOWN';
        const detail = answer && answer.detail ? String(answer.detail) : '';
        setV02State('FAILED', `Status unavailable (${code}). ${detail}`);
        return;
      }
      renderV02Projection(answer.projection);
    },
    onError: () => {
      setV02State('UNKNOWN', 'The service worker could not answer the status poll.');
      return false;
    },
  });

  v02SubmitButton.addEventListener('click', async () => {
    if (!structuredFormsReady || !v02TargetRefInput || !v02OutputRootInput) {
      setV02State('FAILED', '本地表单描述不受支持，未提交任何任务。');
      return;
    }
    const targetRef = String(v02TargetRefInput.value || '').trim();
    const outputRoot = String(v02OutputRootInput.value || '').trim();
    const targetRules = structuredFormField('V02_ADD_DOWNLOAD', 'v02-target-ref');
    const outputRules = structuredFormField('V02_ADD_DOWNLOAD', 'v02-output-root');
    if ((targetRules.required && targetRef === '') || (outputRules.required && outputRoot === '')) {
      setV02State(
        'UNKNOWN',
        'Enter the Host-issued target handle and the authorized output root first.',
      );
      return;
    }
    const tab = await activeTab();
    const tabId = tab && typeof tab.id === 'number' ? tab.id : -1;
    const pageUrl = tab && typeof tab.url === 'string' ? tab.url : '';
    if (tabId < 0 || !/^https?:\/\//i.test(pageUrl)) {
      setV02State('FAILED', 'This action needs an active http(s) page tab (origin authority).');
      return;
    }
    v02PollController.stop();
    setV02State('RUNNING', 'Submitting the confirmed intent through the trusted local Host…');
    let answer;
    try {
      answer = await chrome.runtime.sendMessage({
        kind: 'V02_ADD_DOWNLOAD',
        tabId,
        pageUrl,
        action: {
          targetRef,
          outputRootScope: outputRoot,
          allowedOperation: 'acquisition.acquire',
          slice: 'S1',
          caller: { actor: 'browser-extension', sessionRef: 'popup-v02' },
        },
      });
    } catch (error) {
      setV02State(
        'FAILED',
        `The service worker refused the submission: ${String(error && error.message ? error.message : error)}`,
      );
      return;
    }
    if (!answer || answer.outcome !== 'ADMITTED') {
      const code = answer && answer.code ? String(answer.code) : 'UNKNOWN';
      const detail = answer && answer.detail ? String(answer.detail) : '提交被拒绝';
      const diagnostics = answer && Array.isArray(answer.diagnostics) ? answer.diagnostics : [];
      const codes = diagnostics
        .map((entry) => String(entry && entry.code ? entry.code : ''))
        .filter((entry) => entry !== '')
        .join(', ');
      setV02State(
        'FAILED',
        `Refused (${code}). ${detail}${codes !== '' ? ` Gate reasons: ${codes}.` : ''}`,
      );
      return;
    }
    v02Lineage = String(answer.lineageId);
    setV02State(
      'RUNNING',
      `Accepted by Core (lineage ${v02Lineage}). Polling the Core-owned projection…`,
    );
    v02PollController.start(v02Lineage);
  });

  // UI-only navigation. No permission request, worker command or Core change.
  const modeTabs =
    typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll('.mode-tab'))
      : [];
  const modePanels =
    typeof document.querySelectorAll === 'function'
      ? Array.from(document.querySelectorAll('[data-mode-panel]'))
      : [];
  function showMode(mode, shouldFocus) {
    const recognized = ['page', 'batch', 'collection', 'advanced'];
    if (!recognized.includes(mode)) return;
    for (const panel of modePanels) {
      panel.hidden = panel.dataset.modePanel !== mode;
    }
    for (const tab of modeTabs) {
      const selected = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      if (selected && shouldFocus) tab.focus();
    }
  }
  for (const tab of modeTabs) {
    tab.addEventListener('click', () => showMode(tab.dataset.mode, false));
    tab.addEventListener('keydown', (event) => {
      const index = modeTabs.indexOf(tab);
      let nextIndex = null;
      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % modeTabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + modeTabs.length) % modeTabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = modeTabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const next = modeTabs[nextIndex];
      if (next) showMode(next.dataset.mode, true);
    });
  }
  showMode('page', false);

  void s6RestoreActiveJourney();
})();
