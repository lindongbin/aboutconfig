// Only for Zen

(function() {
  'use strict';

  const abortController = new AbortController();
  const { signal } = abortController;

  const { AboutNewTab } = ChromeUtils.importESModule(
    "resource:///modules/AboutNewTab.sys.mjs"
  );

  gBrowser.tabContainer.addEventListener('TabClose', function() {
    if (gBrowser.visibleTabs.length === 0) {
      const newTab = gBrowser.addTab(AboutNewTab.newTabURL, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      gBrowser.selectedTab = newTab;
    }
  }, { signal });

  return { cleanup: () => abortController.abort() };
})();
