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

  function setState(kind, text) {
    stateBox.className = `state ${kind}`;
    stateBox.textContent = text;
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
      const failure = journey.failure || { stage: 'FAILED', detail: 'unknown failure' };
      const terminalText = journey.terminal
        ? `\nCore terminal: ${JSON.stringify(journey.terminal)}`
        : '';
      setState('FAILED', `${failure.stage}: ${failure.detail}${terminalText}`);
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
    link.textContent = `${item.text || '(untitled link)'} — ${item.href}`;
    li.appendChild(link);

    // A checked row is only a local, explicitly selected S5 PREVIEW member.
    // It NEVER starts individual S2 acquisition or commits group Core truth.
    const groupCheckbox = document.createElement('input');
    groupCheckbox.type = 'checkbox';
    groupCheckbox.setAttribute('aria-label', 'Include this observed link in S5 preview');
    li.appendChild(groupCheckbox);
    s5ObservedRows.push({ checkbox: groupCheckbox, href: item.href, text: item.text });

    const digest = document.createElement('input');
    digest.type = 'text';
    digest.placeholder = 'known SHA-256 (optional — strengthens target verification)';
    li.appendChild(digest);

    const contentType = document.createElement('input');
    contentType.type = 'text';
    contentType.placeholder =
      'expected content-type prefix (optional, e.g. application/octet-stream)';
    li.appendChild(contentType);

    const button = document.createElement('button');
    button.textContent = 'Download with xDownload';
    button.addEventListener('click', async () => {
      // Optional digest: when entered it must be a canonical SHA-256; the
      // journey never requires it (F01).
      const value = digest.value.trim().toLowerCase();
      if (value !== '' && !/^[0-9a-f]{64}$/.test(value)) {
        setState(
          'FAILED',
          'the declared SHA-256, when entered, must be 64 hex chars (or leave the field empty)',
        );
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
    s5BatchResult.textContent = text;
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
        document.createTextNode(` ${member.text || '(untitled)'} — ${member.href}`),
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
          'S5 refused: tab changed since observation; rescan the page before group confirmation.';
        return;
      }
      if (!s5ObservedComplete) {
        s5PreviewResult.textContent =
          'S5 refused: the page has more than 20 observed links; partial membership cannot be called a whole current-page group.';
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
        s5PreviewResult.textContent =
          'S5 refused: the page membership changed since observation; reopen the popup.';
        return;
      }
      if (new Set(observed.links.map((item) => item.href)).size !== observed.links.length) {
        s5PreviewResult.textContent =
          'S5 refused: duplicate resource locators require trusted distinct member identities.';
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
        s5PreviewResult.textContent = `S5 admission refused without downloading: ${
          (response && response.error) || 'UNKNOWN'
        }`;
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
      s5PreviewResult.textContent = `Core froze ${String(
        (response.facts &&
          Array.isArray(response.facts.members) &&
          response.facts.members.length) ||
          0,
      )} members (digest ${String(s5Prepared.digest).slice(0, 16)}…). Pick the batch subset and confirm.`;
      setS5State('RUNNING', 'Awaiting your batch confirmation — nothing is downloaded yet.');
    } catch (error) {
      s5PreviewResult.textContent = `S5 admission failed without downloading: ${String(error)}`;
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
          'Page changed since scanning; reopen xDownload to get a fresh member snapshot.';
        return;
      }
      const selected = s5ObservedRows.filter((row) => row.checkbox.checked);
      if (selected.length === 0) {
        s5PreviewResult.textContent = 'Select at least one observed member to preview.';
        return;
      }
      const uniqueHrefs = new Set(selected.map((row) => row.href));
      if (uniqueHrefs.size !== selected.length) {
        s5PreviewResult.textContent =
          'Duplicate member locators need distinct verified identities; no group was confirmed.';
        return;
      }
      const subset = selected.length !== s5ObservedRows.length;
      s5PreviewResult.textContent = [
        `S5 preview only: ${selected.length} selected of ${s5ObservedRows.length} observed links.`,
        subset
          ? 'This subset requires a separately confirmed selected_collection_members successor scope.'
          : 'Current-page membership is only observed; continuation scope would be NONE.',
        'No Core snapshot, download, Coverage or COMPLETE terminal has been created.',
      ].join(' ');
    } catch (error) {
      s5PreviewResult.textContent = `S5 preview failed without any acquisition: ${String(error)}`;
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
          'Only the first 20 page links were scanned; complete S5 current-page membership is unavailable.';
      }
      setState(
        'RUNNING',
        'Select an S2 attachment to Download, or preview an S5 page group without acquisition.',
      );
      const s6SectionEl = document.getElementById('s6-collection');
      if (s6SectionEl !== null) {
        s6SectionEl.hidden = false;
      }
    } catch (error) {
      setState('FAILED', `page scan failed: ${String(error)}`);
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
    s6BatchResult.textContent = text;
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
          ` [p${String(member.page)}] ${member.text || '(untitled)'} — ${member.href}`,
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
        `S6 page ${String(pageNumber)} scan produced no member anchors; the declared walk stopped truthfully (nothing was widened).`,
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
        `S6 page ${String(pageNumber)} carries ${String(observed.observedCount)} member anchors and the shipped scan admits only ${String(observed.links.length)}; recording a truncated page could fabricate coverage, so the declared walk stopped truthfully before Core froze anything from this page.`,
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
      )} members. Uncheck any member you do not want; then walk the next declared page or confirm.`,
    );
    return true;
  }

  s6PrepareButton.addEventListener('click', async () => {
    s6PrepareButton.disabled = true;
    try {
      const identity = s6IdentityInput.value.trim();
      const fromPage = Number(s6FromInput.value.trim());
      const toPage = Number(s6ToInput.value.trim());
      if (!/^[A-Za-z0-9_./:-]{1,256}$/u.test(identity) || identity.includes('//')) {
        s6PrepareResult.textContent =
          'S6 refused: the collection identity must be a bounded identity path (e.g. playlist/my-list).';
        return;
      }
      if (
        !Number.isSafeInteger(fromPage) ||
        !Number.isSafeInteger(toPage) ||
        fromPage < 1 ||
        toPage < fromPage ||
        toPage > 10000
      ) {
        s6PrepareResult.textContent =
          'S6 refused: the page range must be a bounded 1-based inclusive range with fromPage <= toPage.';
        return;
      }
      // R1 P2-01: the shipped v0.1 installed lane binds declared-range page 1
      // to the CURRENTLY OPEN collection page (the prepare freezes this exact
      // URL). A range starting later has no executable, provably-current
      // first page here — refuse truthfully instead of admitting an
      // unreachable selection.
      if (fromPage !== 1) {
        s6PrepareResult.textContent =
          'S6 refused: the shipped v0.1 lane starts a declared range only at the currently open page (fromPage must be 1). Open the page you want to start from and declare the range from there; a later start requires opening that page first.';
        return;
      }
      const currentTab = await activeTab();
      if (!currentTab || currentTab.id === undefined) {
        s6PrepareResult.textContent = 'S6 refused: no active tab; reopen the popup.';
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
          scopedNote =
            'S6: the scoped collection-origin permission was not granted; only already-scannable pages can be walked.';
        }
      } catch (error) {
        scopedNote = `S6: the scoped permission request could not run (${String(error)}); walking proceeds only on already-scannable pages.`;
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
        s6PrepareResult.textContent = `S6 admission refused without navigating: ${
          (response && response.error) || 'UNKNOWN'
        } (verbatim response: ${JSON.stringify(response)})`;
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
      s6PrepareResult.textContent = `${scopedNote ? `${scopedNote} ` : ''}Core froze the collection admission for ${identity} pages ${String(
        fromPage,
      )}..${String(toPage)} (digest ${String(
        (response.facts && response.facts.observedTupleDigest) || '',
      ).slice(0, 16)}…). The declared range is now the only navigation bound.`;
      // Page 1 is the already-open current page: record it (no navigation).
      const recorded = await s6RecordPage(1);
      if (recorded && s6Prepared.toPage === 1) {
        setS6State(
          'RUNNING',
          'Declared range fully walked (single page). Uncheck members you do not want and confirm.',
        );
      }
    } catch (error) {
      s6PrepareResult.textContent = `S6 preparation failed without navigating: ${String(error)}`;
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

  function pollS6Terminal() {
    const started = Date.now();
    const timer = setInterval(async () => {
      let payload = null;
      try {
        payload = await chrome.runtime.sendMessage({
          kind: 'S6_COLLECTION_JOURNEY_STATUS',
          contractId: s6Confirmed.contractId,
        });
      } catch (error) {
        clearInterval(timer);
        setS6State('UNKNOWN', `journey status unreadable: ${String(error)}`);
        return;
      }
      const facts = payload && payload.facts;
      if (payload && payload.ok === true && payload.status === 'TERMINAL') {
        clearInterval(timer);
        renderS6Terminal(facts || {});
        return;
      }
      if (payload && payload.ok !== true) {
        clearInterval(timer);
        setS6State('FAILED', `collection failed: ${payload.error || 'unknown failure'}`);
        return;
      }
      setS6State(
        'RUNNING',
        `Core is downloading the collection (${Math.round((Date.now() - started) / 1000)}s)… per-member status so far:\n${JSON.stringify(
          (facts && facts.members) || [],
          null,
          2,
        )}`,
      );
    }, 700);
  }

  s6ExecuteButton.addEventListener('click', async () => {
    if (!s6Confirmed) {
      setS6State('FAILED', 'Confirm the collection with Core before downloading.');
      return;
    }
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
    s6PrepareResult.textContent = `Restored the active S6 journey ${String(
      journey.contractId,
    )} from Core (admission ${s6Prepared.prepareId}; ${String(s6MemberAccum.size)} frozen members across ${String(
      pages.length,
    )} walked page(s)). The declared range ${String(s6Prepared.fromPage)}..${String(
      s6Prepared.toPage,
    )} stays the only navigation bound.`;
    setS6State(
      'RUNNING',
      `Restored from Core: ${String(s6MemberAccum.size)} frozen members on ${String(pages.length)} declared page(s) walked so far. ${
        s6Confirmed
          ? 'The subset is already confirmed — you can start the collection download.'
          : 'Uncheck any member you do not want, then confirm; or continue the declared walk.'
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
  let v02PollTimer = null;

  function setV02State(kind, text) {
    v02ResultBox.className = `state ${kind}`;
    v02ResultBox.textContent = text;
  }

  function stopV02Polling() {
    if (v02PollTimer !== null) {
      clearInterval(v02PollTimer);
      v02PollTimer = null;
    }
  }

  function renderV02Projection(projection) {
    const status = String(projection.status || 'UNKNOWN');
    const owner = String(projection.owner || '');
    let text = `Core-owned status: ${status} (owner: ${owner}).`;
    const error = projection.error;
    if (error && error.code) {
      text += ` Error: ${String(error.code)} — ${String(error.message || error.code)}.`;
    }
    // Truthful progress only: rendered when Core reported a byte sample; the
    // total size stays UNKNOWN unless Core says otherwise (never fabricated).
    const progress = projection.progress;
    if (progress && typeof progress.transferredBytes === 'number') {
      text += ` Transferred: ${String(progress.transferredBytes)} bytes (total: UNKNOWN).`;
    }
    setV02State(status, text);
    if (status !== 'RUNNING') {
      stopV02Polling();
    }
  }

  async function pollV02Status() {
    if (v02Lineage === null) return;
    let answer;
    try {
      answer = await chrome.runtime.sendMessage({ kind: 'V02_JOB_STATUS', lineageId: v02Lineage });
    } catch {
      setV02State('UNKNOWN', 'The service worker could not answer the status poll.');
      return;
    }
    if (!answer || answer.outcome !== 'PROJECTION') {
      const code = answer && answer.code ? String(answer.code) : 'UNKNOWN';
      const detail = answer && answer.detail ? String(answer.detail) : '';
      setV02State('FAILED', `Status unavailable (${code}). ${detail}`);
      stopV02Polling();
      return;
    }
    renderV02Projection(answer.projection);
  }

  v02SubmitButton.addEventListener('click', async () => {
    const targetRef = String(v02TargetRefInput.value || '').trim();
    const outputRoot = String(v02OutputRootInput.value || '').trim();
    if (targetRef === '' || outputRoot === '') {
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
      const detail = answer && answer.detail ? String(answer.detail) : 'the submission was refused';
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
    stopV02Polling();
    v02PollTimer = setInterval(() => {
      void pollV02Status();
    }, 1000);
    void pollV02Status();
  });

  void s6RestoreActiveJourney();
})();
