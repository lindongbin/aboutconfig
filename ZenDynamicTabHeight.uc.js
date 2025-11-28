// Only for Zen compact mode

(function() {
  'use strict';

  const abortController = new AbortController();
  const { signal } = abortController;
  let tabBox, tabContainer, tabCount, hoverZone, styleEl;
  let updateScheduled = false;

  function initializeUI() {
    Services.prefs.setBoolPref('zen.mediacontrols.enabled', false);
    Services.prefs.setBoolPref('zen.view.use-single-toolbar', false);
    tabBox = document.getElementById('navigator-toolbox');
    tabContainer = gBrowser.tabContainer;
    tabCount = Array.from(tabContainer.allTabs).length;
    if (Services.prefs.getBoolPref('zen.tabs.show-newtab-vertical', true)) tabCount++;
    styleEl = document.createElement('style');
    styleEl.textContent = `
      zen-workspace { min-height: 100vh !important; padding-bottom: 15vh !important; }
      .zen-current-workspace-indicator, #zen-sidebar-foot-buttons, .pinned-tabs-container-separator { display: none !important; }
      #navigator-toolbox { top: 5px !important; height: calc(min(var(--zen-tab-count, 1) * 33px, 90vh) - 20px) !important; }
    `;
    document.head.appendChild(styleEl);
    tabBox.style.setProperty('--zen-tab-count', tabCount);
    hoverZone = document.createElement('div');
    hoverZone.id = 'zen-extended-hover-zone';
    hoverZone.style.cssText = `
      position: fixed;
      top: 0;
      ${gZenCompactModeManager.sidebarIsOnRight ? 'right' : 'left'}: 0;
      width: 1px;
      height: 100vh;
      z-index: 9999;
      pointer-events: auto;
    `;
    document.documentElement.appendChild(hoverZone);
    tabContainer.addEventListener('TabOpen', (event) => {
      const tab = event.target;
      requestAnimationFrame(() => {
        if (tab.hasAttribute('zen-glance-tab')) {
          tab._isGlanceTab = true;
        } else {
          tabCount++;
          updateHeight();
        }
      });
    }, { signal });
    tabContainer.addEventListener('TabClose', (event) => {
      requestAnimationFrame(() => {
        if (!event.target._isGlanceTab) {
          tabCount--;
          updateHeight();
        }
      });
    }, { signal });
    hoverZone.addEventListener('mouseenter', () => {
      tabBox.setAttribute('zen-has-hover', 'true');
    }, { signal });
  }

  function updateHeight() {
    if (updateScheduled) return;
    updateScheduled = true;
    window.requestAnimationFrame(() => {
      updateScheduled = false;
      tabBox.style.setProperty('--zen-tab-count', tabCount);
    });
  }

  function cleanup() {
    abortController.abort();
    hoverZone.remove();
    styleEl.remove();
    tabBox.style.removeProperty('--zen-tab-count');
    tabBox = null;
    tabContainer = null;
    hoverZone = null;
    styleEl = null;
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeUI, { once: true });
    } else {
      initializeUI();
    }
    window.addEventListener('unload', cleanup, { once: true });
  }

  init();
  return cleanup;
})();
