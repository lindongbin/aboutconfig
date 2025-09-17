(function() {
  'use strict';

  const PREF_NAME = 'browser.newtab.url';
  const DEFAULT_URL = 'about:home';

  const { AboutNewTab } = ChromeUtils.importESModule(
    'resource:///modules/AboutNewTab.sys.mjs'
  );

  function setNewTabURL() {
    let url = Services.prefs.getStringPref(PREF_NAME, '').trim();
    if (!url) {
      url = DEFAULT_URL;
      Services.prefs.setStringPref(PREF_NAME, url);
    }
    AboutNewTab.newTabURL = url;
  }

  Services.prefs.addObserver(PREF_NAME, setNewTabURL);
  setNewTabURL();

  window.addEventListener('unload', () => {
    Services.prefs.removeObserver(PREF_NAME, setNewTabURL);
  });
})();
