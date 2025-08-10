(function () {
  'use strict';

  const SETTINGS = [
    ['userChrome.enableRightClickCloseTab', '右键关闭标签页(CTRL+右键弹出菜单)'],
    ['userChrome.enableRightClickUndoTab', '右键标签栏撤销关闭(CTRL+右键弹出菜单)'],
    ['browser.tabs.closeTabByDblclick', '双击关闭标签页'],
    ['browser.tabs.closeWindowWithLastTab', '关闭最后一个标签页时关闭窗口'],
    ['browser.tabs.insertAfterCurrent', '在当前标签页右侧打开新标签页'],
    ['browser.urlbar.openintab', '地址栏在新标签页打开'],
    ['browser.tabs.loadBookmarksInTabs', '书签栏在新标签页打开'],
    ['browser.search.openintab', '搜索框在新标签页打开'],
    ['userChrome.historyInTab', '历史在新标签页打开'],
    ['userChrome.disableTabAnimations', '禁用标签页动画'],
    ['browser.urlbar.trimURLs', '地址栏隐藏http/https'],
    ['userChrome.ctrlClickUrlbarMultiOpen', '地址栏下拉列表可多次点击'],
    ['browser.urlbar.scotchBonnet.enableOverride', '启用下拉选择搜索引擎'],
    ['browser.newtabpage.activity-stream.improvesearch.handoffToAwesomebar', '主页搜索框输入时跳转到地址栏'],
    ['browser.bookmarks.openInTabClosesMenu', '禁用书签菜单CTRL+多次点击打开多个书签'],
    ['browser.chrome.toolbar_tips', '鼠标悬停小提示'],
    ['browser.tabs.hoverPreview.enabled', '启用标签页缩略图'],
    ['browser.compactmode.show', '定制密度增加紧凑模式'],
    ['userChrome.hideWindowControls', '隐藏窗口控制按钮'],
    ['userChrome.useSerifFont', '界面使用衬线字体'],
    ['userChrome.overrideNewTabUrl', '自定义新标签页网址']
  ];

  const DEFAULT_NEWTAB_URL = 'about:blank';
  const NEWTAB_URL_PREF = 'browser.newtab.url';

  const cleanupFunctions = new Set();
  const prefCache = new Map();
  const prefObservers = new Map();
  let styleEl = null;
  let dialogEl = null;
  let newTabUrlDialog = null;

  const domCache = {};
  const getDomCache = (key, fetcher) => {
    if (!domCache[key]) {
      domCache[key] = fetcher();
    }
    return domCache[key];
  };

  const getPref = (k, d = false) => {
    if (prefCache.has(k)) {
      return prefCache.get(k);
    }
    try {
      let value;
      const prefType = Services.prefs.getPrefType(k);
      if (prefType === Services.prefs.PREF_BOOL) {
        value = Services.prefs.getBoolPref(k, d);
      } else if (prefType === Services.prefs.PREF_STRING) {
        value = Services.prefs.getCharPref(k, d);
      } else {
        value = d;
      }
      prefCache.set(k, value);
      return value;
    } catch (e) {
      return d;
    }
  };

  const setPref = (k, v) => {
    try {
      if (typeof v === 'boolean') Services.prefs.setBoolPref(k, v);
      else if (typeof v === 'string') Services.prefs.setCharPref(k, v);
      prefCache.set(k, v);
    } catch (e) {
      console.error(`Failed to set preference ${k}:`, e);
    }
  };

  const PREF_HANDLERS = {
    'userChrome.disableTabAnimations': setupTabAnimations,
    'userChrome.enableRightClickCloseTab': setupRightClickHandler,
    'userChrome.enableRightClickUndoTab': setupRightClickHandler,
    'userChrome.hideWindowControls': applyStyle,
    'userChrome.useSerifFont': applyStyle,
    'userChrome.historyInTab': setupHistoryInTab,
    'userChrome.ctrlClickUrlbarMultiOpen': setupUrlbarMultiClick,
    'userChrome.overrideNewTabUrl': setupOverrideNewTabUrl
  };

  const baseCSS = `
    #adv-settings-dialog {
      padding: 15px;
      border: 1px solid var(--arrowpanel-border-color, ThreeDShadow);
      border-radius: 4px;
      background: var(--arrowpanel-background, -moz-Dialog);
      color: var(--arrowpanel-color, -moz-DialogText);
      min-width: 400px; max-width: 600px; z-index: 10000;
      font: message-box; font-size: 14px; line-height: 14px;
      box-shadow: 0 1px 4px color-mix(in srgb, currentColor 20%, transparent);
    }
    #adv-settings-dialog::backdrop {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .adv-settings-form { display: flex; flex-direction: column; gap: 12px; }
    .setting-item { display: flex; align-items: center; gap: 8px; }
    .setting-label { flex: 1; cursor: pointer; }
    .url-setting-button { margin-left: auto; }
    #newtab-url-dialog {
      padding: 15px;
      border: 1px solid var(--arrowpanel-border-color, ThreeDShadow);
      border-radius: 4px;
      background: var(--arrowpanel-background, -moz-Dialog);
      color: var(--arrowpanel-color, -moz-DialogText);
      min-width: 280px; font: message-box;
      max-width: 90vw;
    }
    #newtab-url-dialog::backdrop {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .url-setting-button:disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  `;

  function applyStyle() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'adv-settings-style';
      document.head.appendChild(styleEl);
      cleanupFunctions.add(() => styleEl?.remove());
    }

    const rules = [];
    if (getPref('userChrome.hideWindowControls')) {
      rules.push(`.titlebar-buttonbox-container { display: none !important; }`);
    }
    if (getPref('userChrome.useSerifFont')) {
      rules.push(`*:not(.titlebar-buttonbox-container *) { font-family: serif !important; }`);
    }
    styleEl.textContent = baseCSS + rules.join('\n');
  }

  function setupTabAnimations() {
    const d = !!getPref('userChrome.disableTabAnimations');
    window.gReduceMotionOverride = d;
    d ? (window.gReduceMotion = true) : Reflect.deleteProperty(window, 'gReduceMotion');
  }

  function handleTabContainerRightClick(e) {
    if (e.button !== 2 || e.ctrlKey) return;
    const tab = e.target.closest('.tabbrowser-tab');
    if (getPref('userChrome.enableRightClickCloseTab') && tab) {
      e.preventDefault(); e.stopPropagation();
      const shouldAnimate = !getPref('userChrome.disableTabAnimations', true);
      gBrowser[tab.multiselected ? 'removeMultiSelectedTabs' : 'removeTab'](tab, { animate: shouldAnimate, triggeringEvent: e });
    } else if (getPref('userChrome.enableRightClickUndoTab') && !tab) {
      if (SessionStore.getClosedTabCount(window) > 0) {
        e.preventDefault(); e.stopPropagation();
        SessionStore.undoCloseTab(window, 0);
      }
    }
  }

  function setupRightClickHandler() {
    const container = getDomCache('tabContainer', () => gBrowser?.tabContainer);
    if (!container) return;

    const enabled = getPref('userChrome.enableRightClickCloseTab') || getPref('userChrome.enableRightClickUndoTab');
    container.removeEventListener('contextmenu', handleTabContainerRightClick, true);
    if (enabled) {
      container.addEventListener('contextmenu', handleTabContainerRightClick, true);
      cleanupFunctions.add(() => container.removeEventListener('contextmenu', handleTabContainerRightClick, true));
    }
  }

  const historyListener = event => {
    const target = event.target;
    if (!target.closest('#historyMenuPopup, #PanelUI-history')) return;
    if (!target.hasAttribute('scheme')) return;
    const classList = target.classList;
    if (!(classList.contains('bookmark-item') || classList.contains('menuitem-iconic'))) return;
    const image = target.getAttribute('image');
    if (!image || !image.startsWith('page-icon:')) return;
    event.preventDefault();
    event.stopPropagation();

    const url = image.slice(10);
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const currentTab = gBrowser.selectedTab;
    const isCurrentTabEmpty = currentTab.isEmpty || isBlankPageURL(currentTab.linkedBrowser.currentURI.spec);

    if (isCurrentTabEmpty) {
      currentTab.linkedBrowser.loadURI(Services.io.newURI(url), {
        triggeringPrincipal: principal,
      });
    } else {
      gBrowser.addTab(url, {
        triggeringPrincipal: principal,
        inBackground: false,
      });
    }
  };

  function setupHistoryInTab() {
    document.removeEventListener('command', historyListener, true);
    if (getPref('userChrome.historyInTab')) {
      document.addEventListener('command', historyListener, true);
      cleanupFunctions.add(() => document.removeEventListener('command', historyListener, true));
    }
  }

  const URLBAR_PATCHED = Symbol('urlbarPatched');
  let originalWhereToOpen = null;

  function setupUrlbarMultiClick() {
    if (!window.gURLBar || !gURLBar._whereToOpen) return;

    if (!getPref('userChrome.ctrlClickUrlbarMultiOpen')) {
      if (gURLBar[URLBAR_PATCHED]) {
        gURLBar._whereToOpen = originalWhereToOpen;
        delete gURLBar[URLBAR_PATCHED];
      }
      return;
    }

    if (gURLBar[URLBAR_PATCHED]) return;

    originalWhereToOpen = gURLBar._whereToOpen;
    gURLBar._whereToOpen = function (event) {
      if (event?.ctrlKey) {
        const closeFn = this.view?.close;
        if (closeFn) {
          this.view.close = () => { };
          setTimeout(() => this.view.close = closeFn, 0);
        }
        return 'tab';
      }
      return originalWhereToOpen.call(this, event);
    };
    gURLBar[URLBAR_PATCHED] = true;
  }

  const NEWTAB_PATCHED = Symbol('newtabPatched');
  let originalOpenTab = null;
  let originalRemoveTab = null;

  function setupOverrideNewTabUrl() {
    const getNewTabUrl = () => Services.prefs.getCharPref(NEWTAB_URL_PREF, DEFAULT_NEWTAB_URL);

    if (!getPref('userChrome.overrideNewTabUrl')) {
      if (BrowserCommands.openTab[NEWTAB_PATCHED]) {
        BrowserCommands.openTab = originalOpenTab;
        gBrowser.removeTab = originalRemoveTab;
        delete BrowserCommands.openTab[NEWTAB_PATCHED];
      }
      return;
    }

    if (BrowserCommands.openTab[NEWTAB_PATCHED]) return;
    if (!window.BrowserCommands?.openTab || !window.gBrowser?.removeTab) return;

    originalOpenTab = BrowserCommands.openTab;
    originalRemoveTab = gBrowser.removeTab;

    BrowserCommands.openTab = function ({ event, url } = {}) {
      originalOpenTab.call(this, { event, url: url || getNewTabUrl() });
    };
    BrowserCommands.openTab[NEWTAB_PATCHED] = true;

    gBrowser.removeTab = function (aTab, aParams = {}) {
      const visibleTabs = this.visibleTabs;
      const shouldKeepOpen = !getPref('browser.tabs.closeWindowWithLastTab');
      if (shouldKeepOpen && visibleTabs.length === 1 && visibleTabs[0] === aTab) {
        this.addTab(getNewTabUrl(), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
      }
      return originalRemoveTab.call(this, aTab, aParams);
    };
  }

  function createAndShowDialog() {
    if (!dialogEl) {
      dialogEl = document.createElement('dialog');
      dialogEl.id = 'adv-settings-dialog';
      cleanupFunctions.add(() => dialogEl?.remove());

      const form = document.createElement('form');
      form.className = 'adv-settings-form';

      SETTINGS.forEach(([pref, label]) => {
        const div = document.createElement('div');
        div.className = 'setting-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `pref-${pref}`;
        const labelEl = document.createElement('label');
        labelEl.htmlFor = checkbox.id;
        labelEl.className = 'setting-label';
        labelEl.textContent = label;

        checkbox.addEventListener('change', (e) => {
          setPref(pref, e.target.checked);
        });

        if (pref === 'userChrome.overrideNewTabUrl') {
          const container = document.createElement('div');
          container.style.display = 'flex';
          container.style.alignItems = 'center';
          container.style.gap = '6px';

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'url-setting-button';
          btn.textContent = '设置';
          btn.addEventListener('click', showNewTabUrlDialog);

          checkbox.addEventListener('change', () => {
            btn.disabled = !checkbox.checked;
          });

          container.append(labelEl, btn);
          div.append(checkbox, container);
        } else {
          div.append(checkbox, labelEl);
        }

        form.appendChild(div);
      });

      dialogEl.appendChild(form);
      document.body.appendChild(dialogEl);

      const onDialogOutsideClick = e => {
        const rect = dialogEl.getBoundingClientRect();
        if (!(rect.top <= e.clientY && e.clientY <= rect.bottom && rect.left <= e.clientX && e.clientX <= rect.right)) {
          dialogEl.close();
        }
      };
      dialogEl.addEventListener('click', onDialogOutsideClick);
      cleanupFunctions.add(() => dialogEl.removeEventListener('click', onDialogOutsideClick));
    }

    dialogEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const pref = cb.id.replace('pref-', '');
      cb.checked = getPref(pref);
    });

    const urlCheckbox = dialogEl.querySelector('#pref-userChrome\\.overrideNewTabUrl');
    const urlButton = urlCheckbox.closest('.setting-item').querySelector('.url-setting-button');
    urlButton.disabled = !urlCheckbox.checked;

    dialogEl.showModal();
  }

  function showNewTabUrlDialog() {
    if (!newTabUrlDialog) {
      newTabUrlDialog = document.createElement('dialog');
      newTabUrlDialog.id = 'newtab-url-dialog';

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '10px';
      container.style.width = '100%';

      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'newtab-url-input';
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';

      const buttonRow = document.createElement('div');
      buttonRow.style.display = 'flex';
      buttonRow.style.justifyContent = 'flex-start';

      const okButton = document.createElement('button');
      okButton.textContent = '确定';
      const onNewTabUrlConfirm = () => {
        const value = input.value.trim();
        setPref(NEWTAB_URL_PREF, value || DEFAULT_NEWTAB_URL);
        newTabUrlDialog.close();
      };
      okButton.addEventListener('click', onNewTabUrlConfirm);
      cleanupFunctions.add(() => okButton.removeEventListener('click', onNewTabUrlConfirm));

      buttonRow.appendChild(okButton);
      container.append(input, buttonRow);
      newTabUrlDialog.append(container);

      document.body.appendChild(newTabUrlDialog);
    }

    const input = newTabUrlDialog.querySelector('#newtab-url-input');
    input.value = getPref(NEWTAB_URL_PREF, DEFAULT_NEWTAB_URL);
    newTabUrlDialog.showModal();
  }

  function addMenuItem() {
    const appMenu = getDomCache('appMenuPopup', () => document.getElementById('appMenu-popup'));
    const settingsBtn = getDomCache('appMenuSettingsBtn', () => document.getElementById('appMenu-settings-button'));
    if (!appMenu || !settingsBtn || document.getElementById('appMenu-advanced-settings-button')) return false;

    const btn = document.createXULElement('toolbarbutton');
    btn.id = 'appMenu-advanced-settings-button';
    btn.className = 'subviewbutton';
    btn.setAttribute('label', '高级设置');
    btn.addEventListener('command', e => {
      e.stopPropagation();
      appMenu.hidePopup();
      createAndShowDialog();
    });
    cleanupFunctions.add(() => btn.remove());
    settingsBtn.insertAdjacentElement('afterend', btn);
    return true;
  }

  function addMenuItemOnFirstOpen() {
    const appMenuPopup = getDomCache('appMenuPopup', () => document.getElementById('appMenu-popup'));
    if (!appMenuPopup) return;
    const onMenuShowing = () => {
      if (addMenuItem()) {
        appMenuPopup.removeEventListener('popupshowing', onMenuShowing);
      }
    };
    appMenuPopup.addEventListener('popupshowing', onMenuShowing);
    cleanupFunctions.add(() => appMenuPopup.removeEventListener('popupshowing', onMenuShowing));
  }

  function cleanup() {
    for (const [pref, observer] of prefObservers) {
      try {
        Services.prefs.removeObserver(pref, observer);
      } catch (e) {
        console.error(`Failed to remove observer for ${pref}:`, e);
      }
    }
    prefObservers.clear();

    if (BrowserCommands.openTab && originalOpenTab) BrowserCommands.openTab = originalOpenTab;
    if (gBrowser.removeTab && originalRemoveTab) gBrowser.removeTab = originalRemoveTab;
    if (gURLBar?._whereToOpen && originalWhereToOpen) gURLBar._whereToOpen = originalWhereToOpen;

    cleanupFunctions.forEach(fn => {
      try { fn(); } catch (e) { console.error('Cleanup function failed:', e); }
    });
    cleanupFunctions.clear();
  }

  function init() {
    for (const [pref, handler] of Object.entries(PREF_HANDLERS)) {
      try {
        const observer = () => {
          prefCache.delete(pref);
          handler();
        };
        Services.prefs.addObserver(pref, observer);
        prefObservers.set(pref, observer);
        handler();
      } catch (e) {
        console.error(`Failed to initialize pref ${pref}`, e);
      }
    }
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addMenuItemOnFirstOpen, { once: true });
    } else {
      addMenuItemOnFirstOpen();
    }
    window.addEventListener('unload', cleanup, { once: true });
  }

  init();
})();