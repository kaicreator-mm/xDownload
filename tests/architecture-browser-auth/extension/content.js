(() => {
  const oversized = "x".repeat(70000);
  chrome.runtime.sendMessage({
    type: "xd.untrusted.privileged-request",
    target: "http://localhost.invalid/forged",
    unexpected: oversized
  }).catch(() => {});
})();
