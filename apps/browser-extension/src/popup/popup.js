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

  // This is only a browser-observed gesture; Core #151 will independently
  // validate the durable current-page snapshot before any group effect.
  // The installed worker currently refuses this typed message, rather than
  // quietly running N independent S2 downloads or fabricating coverage.
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
      const selected = s5ObservedRows.filter((row) => row.checkbox.checked);
      if (selected.length !== s5ObservedRows.length || selected.length === 0) {
        s5PreviewResult.textContent =
          'S5 current-page scope requires confirmation of every observed member; a subset needs a separately approved scope.';
        return;
      }
      if (new Set(selected.map((item) => item.href)).size !== selected.length) {
        s5PreviewResult.textContent =
          'S5 refused: duplicate resource locators require trusted distinct member identities.';
        return;
      }
      const response = await chrome.runtime.sendMessage({
        kind: 'S5_PREPARE_CURRENT_PAGE_GROUP',
        tabId: currentTab.id,
        pageUrl: currentTab.url,
        observedMemberCount: selected.length,
        members: selected.map((item) => ({ href: item.href, text: item.text })),
      });
      // A typed Core transport and durable snapshot are not yet installed.
      // Even an unexpected future positive response must not be interpreted
      // as an accepted member or a completed download in this UI.
      s5PreviewResult.textContent =
        response && response.ok === false
          ? `S5 admission refused without downloading: ${String(response.error || 'UNKNOWN')}`
          : 'S5 admission response is not an installed Core terminal; no group download can be claimed.';
    } catch (error) {
      s5PreviewResult.textContent = `S5 admission failed without downloading: ${String(error)}`;
    } finally {
      s5PrepareButton.disabled = false;
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
    } catch (error) {
      setState('FAILED', `page scan failed: ${String(error)}`);
    }
  })();
})();
