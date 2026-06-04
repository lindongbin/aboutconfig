(function() {
  'use strict';

  const PREF_NAME = 'browser.newtab.url';
  const NEWTAB_MODE_PREF = 'browser.newtab.mode';

  const { AboutNewTab } = ChromeUtils.importESModule(
    'resource:///modules/AboutNewTab.sys.mjs'
  );

  const windowControllers = new Map();

  function updateNewTabURL() {
    const mode = Services.prefs.getIntPref(NEWTAB_MODE_PREF, -1);
    if (mode === 2) {
      const url = Services.prefs.getStringPref(PREF_NAME, '').trim();
      if (!url) return;
      AboutNewTab.newTabURL = url;
      AboutNewTab.willNotifyUser = true;
    } else {
      AboutNewTab.resetNewTabURL();
      AboutNewTab.willNotifyUser = false;
    }
  }

  function createCustomUI(doc) {
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

    return { customSettings, input };
  }

  function initPreferencesPage(doc, win, signal, select) {
    if (!select) {
      select = doc.getElementById('homepageNewTabs');
    }
    if (!select) {
      const mo = new MutationObserver(() => {
        const s = doc.getElementById('homepageNewTabs');
        if (s) {
          mo.disconnect();
          initPreferencesPage(doc, win, signal, s);
        }
      });
      mo.observe(doc.documentElement, { childList: true, subtree: true });
      signal.addEventListener('abort', () => mo.disconnect(), { once: true });
      return;
    }

    if (select.dataset.customModified) return;
    select.dataset.customModified = 'true';

    const setting = win.Preferences?.getSetting?.('homepageNewTabs');
    if (!setting) return;

    const { customSettings, input } = createCustomUI(doc);
    select.parentElement.insertAdjacentElement('afterend', customSettings);

    const origGetCC = setting.config.getControlConfig;
    setting.config.getControlConfig = function(config) {
      const result = origGetCC.call(this, config);
      return {
        ...result,
        options: [...result.options, { value: 'custom', label: '自定义网址…' }],
      };
    };

    const origGet = setting.config.get;
    setting.config.get = function(prefVal) {
      if (Services.prefs.getIntPref(NEWTAB_MODE_PREF, -1) === 2) return 'custom';
      return origGet.call(this, prefVal);
    };

    const origSet = setting.config.set;
    setting.config.set = function(inputVal) {
      if (inputVal === 'custom') {
        Services.prefs.setIntPref(NEWTAB_MODE_PREF, 2);
        return true;
      }
      Services.prefs.clearUserPref(NEWTAB_MODE_PREF);
      return origSet.call(this, inputVal);
    };

    setting.emit('change');

    requestAnimationFrame(() => {
      const customOpt = select.querySelector('moz-option[value="custom"]');
      if (customOpt) {
        customOpt.removeAttribute('data-l10n-attrs');
        customOpt.removeAttribute('data-l10n-id');
        customOpt.label = '自定义网址…';
      }

      if (Services.prefs.getIntPref(NEWTAB_MODE_PREF, -1) === 2) {
        select.value = 'custom';
        customSettings.hidden = false;
        input.value = Services.prefs.getStringPref(PREF_NAME, '');
      }
    });

    select.addEventListener('change', () => {
      if (select.value === 'custom') {
        customSettings.hidden = false;
        input.value = Services.prefs.getStringPref(PREF_NAME, '');
      } else {
        customSettings.hidden = true;
      }
    }, { signal });

    input.addEventListener('change', () => {
      Services.prefs.setStringPref(PREF_NAME, input.value.trim());
    }, { signal });
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
