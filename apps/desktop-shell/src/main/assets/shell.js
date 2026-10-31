/*
 * T07 shell status page script — the minimal renderer bootstrap.
 *
 * It reads ONLY the typed contextBridge API (`window.xdownloadShell.status`)
 * and writes with `textContent` (no HTML evaluation). There is no fetch, no
 * navigation, no storage use; the CSP forbids everything else.
 */
/* global window, document */

(function () {
  'use strict';
  var statusEl = document.getElementById('status');
  var bridgeMissing = document.getElementById('bridge-missing');
  var bridge = window.xdownloadShell;
  if (bridge === undefined || bridge === null || typeof bridge.status !== 'function') {
    statusEl.textContent = '';
    bridgeMissing.hidden = false;
    return;
  }
  bridge
    .status()
    .then(function (doc) {
      var text = JSON.stringify(doc, null, 2);
      if (doc !== undefined && doc !== null && doc.ok === false) {
        statusEl.textContent = 'shell refused: ' + String(doc.code) + ' — ' + String(doc.detail);
        return;
      }
      statusEl.textContent = text;
    })
    .catch(function () {
      statusEl.textContent = 'shell bridge refused the status call (typed refusal expected)';
    });
})();
