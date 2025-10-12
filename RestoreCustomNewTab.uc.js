(function() {
  'use strict';

  const PREF_NAME = 'browser.newtab.url';
  const NEWTAB_MODE_PREF = 'browser.newtab.mode';
  const DEFAULT_URL = 'about:newtab';
  const NEWTAB_MODE_CUSTOM = "2";

  const { AboutNewTab } = ChromeUtils.importESModule(
    'resource:///modules/AboutNewTab.sys.mjs'
  );

  const windowControllers = new Map();

  function updateNewTabURL() {
    const mode = Services.prefs.getIntPref(NEWTAB_MODE_PREF, -1);
    if (mode === 2) {
      const url = Services.prefs.getStringPref(PREF_NAME, '').trim() || DEFAULT_URL;
      AboutNewTab.newTabURL = url;
      AboutNewTab.willNotifyUser = true;
    } else {
      AboutNewTab.resetNewTabURL();
      AboutNewTab.willNotifyUser = false;
    }
  }

  function createCustomUI(doc) {
    const customItem = doc.createXULElement('menuitem');
    customItem.setAttribute('value', NEWTAB_MODE_CUSTOM);
    customItem.setAttribute('label', '自定义网址…');

    const customSettings = doc.createXULElement('hbox');
    customSettings.id = 'newTabCustomSettings';
    customSettings.setAttribute('align', 'center');
    customSettings.hidden = true;
    customSettings.style.marginTop = '8px';

    const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input');
    input.id = 'newTabPageUrl';
    input.type = 'text';
    input.className = 'homepage-input';
    input.placeholder = '输入自定义网址';
    input.style.flex = '1';

    customSettings.appendChild(input);

    return { customItem, customSettings, input };
  }

  function initPreferencesPage(doc, win, signal) {
    const newTabMode = doc.getElementById('newTabMode');
    if (!newTabMode || newTabMode.dataset.customModified) {
      return;
    }

    newTabMode.dataset.customModified = 'true';

    const menupopup = newTabMode.querySelector('menupopup');
    if (!menupopup) return;

    const { customItem, customSettings, input } = createCustomUI(doc);

    const blankItem = menupopup.querySelector('[value="1"]');
    if (blankItem) {
      menupopup.insertBefore(customItem, blankItem);
    } else {
      menupopup.appendChild(customItem);
    }
    newTabMode.parentNode.insertBefore(customSettings, newTabMode.nextSibling);

    newTabMode.addEventListener('command', (e) => {
      const isCustom = e.target.value === NEWTAB_MODE_CUSTOM;
      customSettings.hidden = !isCustom;

      if (isCustom) {
        const savedUrl = Services.prefs.getStringPref(PREF_NAME, '').trim();
        if (savedUrl) input.value = savedUrl;
        Services.prefs.setIntPref(NEWTAB_MODE_PREF, 2);
        const url = input.value || DEFAULT_URL;
        Services.prefs.setStringPref(PREF_NAME, url);
      } else {
        Services.prefs.clearUserPref(NEWTAB_MODE_PREF);
      }
      updateNewTabURL();
    }, { signal });

    input.addEventListener('change', (e) => {
      const url = e.target.value.trim() || DEFAULT_URL;
      Services.prefs.setStringPref(PREF_NAME, url);
      updateNewTabURL();
    }, { signal });

    const mode = Services.prefs.getIntPref(NEWTAB_MODE_PREF, -1);
    if (mode === 2) {
      newTabMode.value = NEWTAB_MODE_CUSTOM;
      customSettings.hidden = false;
      input.value = Services.prefs.getStringPref(PREF_NAME, DEFAULT_URL);
    }
  }

  function handlePreferencesPage(win) {
    if (!win.location.href.startsWith('about:preferences')) {
      return;
    }

    const doc = win.document;
    const controller = new AbortController();
    const { signal } = controller;
    windowControllers.set(win, controller);

    let observerAdded = false;
    if (doc.readyState === 'complete') {
      initPreferencesPage(doc, win, signal);
    } else {
      const observer = (subject) => {
        if (subject === win) {
          Services.obs.removeObserver(observer, 'home-pane-loaded');
          observerAdded = false;
          initPreferencesPage(doc, win, signal);
        }
      };
      Services.obs.addObserver(observer, 'home-pane-loaded');
      observerAdded = true;

      signal.addEventListener('abort', () => {
        if (observerAdded) {
          try {
            Services.obs.removeObserver(observer, 'home-pane-loaded');
          } catch (e) {}
        }
      }, { once: true });
    }

    win.addEventListener('unload', () => {
      const ctrl = windowControllers.get(win);
      if (ctrl) {
        ctrl.abort();
        windowControllers.delete(win);
      }
    }, { once: true });
  }

  const prefObserver = () => updateNewTabURL();
  Services.prefs.addObserver(PREF_NAME, prefObserver);
  Services.prefs.addObserver(NEWTAB_MODE_PREF, prefObserver);

  const chromeObserver = (subject) => handlePreferencesPage(subject);
  Services.obs.addObserver(chromeObserver, 'chrome-document-global-created');

  updateNewTabURL();
  handlePreferencesPage(window);

  return function cleanup() {
    for (const [win, controller] of windowControllers) {
      controller.abort();
    }
    windowControllers.clear();

    Services.prefs.removeObserver(PREF_NAME, prefObserver);
    Services.prefs.removeObserver(NEWTAB_MODE_PREF, prefObserver);
    Services.obs.removeObserver(chromeObserver, 'chrome-document-global-created');

    AboutNewTab.resetNewTabURL();
  };
})();
