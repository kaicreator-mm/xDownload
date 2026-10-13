/**
 * xDownload S2 action popup — the explicit attachment-selection surface
 * (#95). This page is part of the shipped extension artifact; it runs in
 * the extension origin and holds no privilege beyond what the privileged
 * service worker grants it (the internal message boundary checks
 * sender.id, and ONLY this page's explicit Download click starts a
 * journey).
 *
 * Flow: scrape the current page's anchor links (activeTab scripting) →
 * render one row per http(s) attachment link with a declared-digest field
 * → Download click = the explicit user decision → the service worker runs
 * the installed S2 journey → this page polls the truthful journey state
 * and renders the verbatim Core terminal result.
 */
(() => {
  'use strict';

  const list = document.getElementById('attachments');
  const stateBox = document.getElementById('state');

  function setState(kind, text) {
    stateBox.className = `state ${kind}`;
    stateBox.textContent = text;
  }

  /** Injected into the page (self-contained; returns plain data only). */
  function scrapeAttachmentLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map((anchor) => ({ href: anchor.href, text: (anchor.textContent || '').trim() }))
      .filter((item) => /^https?:\/\//i.test(item.href))
      .slice(0, 20);
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
      linkUrl: row.dataset.href,
      linkText: row.dataset.text || '',
      expectedSha256: digest,
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

    const link = document.createElement('div');
    link.className = 'link';
    link.textContent = `${item.text || '(untitled link)'} — ${item.href}`;
    li.appendChild(link);

    const digest = document.createElement('input');
    digest.type = 'text';
    digest.placeholder = 'expected SHA-256 (hex, required — frozen target anchor)';
    li.appendChild(digest);

    const contentType = document.createElement('input');
    contentType.type = 'text';
    contentType.placeholder =
      'expected content-type prefix (optional, e.g. application/octet-stream)';
    li.appendChild(contentType);

    const button = document.createElement('button');
    button.textContent = 'Download with xDownload';
    button.addEventListener('click', () => {
      const value = digest.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(value)) {
        setState(
          'FAILED',
          'the declared SHA-256 must be 64 hex chars (frozen validation contract)',
        );
        return;
      }
      void startDownload(li, value, contentType.value.trim() || undefined);
    });
    li.appendChild(button);
    list.appendChild(li);
  }

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
      const links = results && results[0] && results[0].result ? results[0].result : [];
      if (links.length === 0) {
        setState('UNKNOWN', 'no http(s) attachment links found on the current page');
        return;
      }
      list.textContent = '';
      for (const item of links) {
        renderRow(tab, item);
      }
      setState('RUNNING', 'Select an attachment, declare its digest, then Download.');
    } catch (error) {
      setState('FAILED', `page scan failed: ${String(error)}`);
    }
  })();
})();
