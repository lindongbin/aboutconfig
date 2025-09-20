// Only for Zen

(function() {
  'use strict';

  const { AboutNewTab } = ChromeUtils.importESModule(
    "resource:///modules/AboutNewTab.sys.mjs"
  );

  gBrowser.tabContainer.addEventListener('TabClose', function() {
    if (gBrowser.tabs.length === 2) {
      const newTab = gBrowser.addTab(AboutNewTab.newTabURL, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      gBrowser.selectedTab = newTab;
    }
  });
})();
