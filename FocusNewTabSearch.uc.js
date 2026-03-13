(function() {
  if (location != 'chrome://browser/content/browser.xhtml') return;

  Services.prefs.setBoolPref("browser.newtabpage.activity-stream.improvesearch.handoffToAwesomebar", false);

  const abortController = new AbortController();
  const { signal } = abortController;

  const FRAME_SCRIPT = 'data:,addMessageListener("focusNewTabSearch", () => {' +
    'content.document.querySelector("content-search-handoff-ui")?.shadowRoot?.getElementById("newtab-search-text")?.focus();' +
    '});';
  window.messageManager.loadFrameScript(FRAME_SCRIPT, true);

  const focusNewTabSearch = (browser) => {
    if (!browser) return;
    const url = browser.currentURI.spec;
    if (url === 'about:newtab' || url === 'about:home') {
      gURLBar.blur();
      browser.focus();
      browser.messageManager.sendAsyncMessage("focusNewTabSearch");
    }
  }

  gBrowser.tabContainer.addEventListener('TabOpen', e => {
    requestAnimationFrame(() => focusNewTabSearch(e.target.linkedBrowser));
  }, { signal });

  setTimeout(() => focusNewTabSearch(gBrowser.selectedBrowser), 500);

  const cleanup = () => {
    abortController.abort();
    window.messageManager.removeDelayedFrameScript(FRAME_SCRIPT);
  };

  window.addEventListener('unload', cleanup, { signal });

  return cleanup;
})();
