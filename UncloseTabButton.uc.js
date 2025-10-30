(() => {
  'use strict';

  const CONFIG = {
    enableMultiColumn: true,    // 是否启用多列
    itemsPerColumn: 20,         // 每列项目数量
    columnWidth: 250,           // 每列宽度(px)
    maxTabsUndo: 60,            // 最大项目总数
    bindHistoryButton: false    // 绑定历史按钮
  };

  const abortController = new AbortController();
  const { signal } = abortController;

  const createXULElement = (doc, tag, props = {}) => {
    const el = doc.createXULElement(tag);
    Object.assign(el, props);
    return el;
  };

  const createToolbarButton = (doc, { id, label, tooltip, image, rotate = false }) => {
    const btn = createXULElement(doc, 'toolbarbutton', {
      id,
      className: 'toolbarbutton-1 chromeclass-toolbar-additional',
    });
    Object.assign(btn.style, {
      listStyleImage: `url("${image}")`,
      transform: rotate ? 'rotate(180deg)' : '',
    });
    btn.setAttribute('label', label);
    btn.setAttribute('tooltiptext', tooltip);
    btn.setAttribute('removable', 'true');
    return btn;
  };

  class UndoCloseTabPopup {
    #popup;

    constructor(doc) {
      this.doc = doc;
      this.win = doc.defaultView;
      this.#popup = doc.getElementById('undo-close-tab-popup');
      if (!this.#popup) {
        this.#popup = createXULElement(doc, 'menupopup', { id: 'undo-close-tab-popup' });
        doc.getElementById('mainPopupSet').appendChild(this.#popup);
        this.loadGridStyles();
      }
      this.#popup.addEventListener('popupshowing', () => this.updateItems(), { signal });
      this.#popup.addEventListener('command', e => this.onCommand(e), { signal });
      this.#popup.addEventListener('mousedown', e => this.onMouseDown(e), { signal });
    }

    loadGridStyles = () => {
      let css;
      if (CONFIG.enableMultiColumn) {
        css = `
          #undo-close-tab-popup {
            --uc-display: grid;
            --uc-grid-auto-flow: column;
            --uc-grid-template-rows: repeat(${CONFIG.itemsPerColumn}, auto);
            --uc-grid-auto-columns: ${CONFIG.columnWidth}px;
          }
          .menupopup-arrowscrollbox * {
            display: var(--uc-display, revert);
            grid-auto-flow: var(--uc-grid-auto-flow, revert);
            grid-template-rows: var(--uc-grid-template-rows, revert);
            grid-auto-columns: var(--uc-grid-auto-columns, revert);
          }
        `;
      } else {
        css = `#undo-close-tab-popup { width: ${CONFIG.columnWidth}px; }`;
      }
      const uri = Services.io.newURI('data:text/css;charset=utf-8,' + encodeURIComponent(css));
      this.win.windowUtils.loadSheetUsingURIString(uri.spec, this.win.windowUtils.USER_SHEET);
    };

    get popup() { return this.#popup; }

    createMenuItem = (tab) => {
      const label = tab.title ?? tab.state?.entries?.[0]?.title ?? tab.state?.entries?.[0]?.url ?? '未知页面';
      const item = createXULElement(this.doc, 'menuitem', { className: 'menuitem-iconic', label });
      item.dataset.closedId = tab.closedId;
      item.setAttribute('image', tab.image ?? 'chrome://global/skin/icons/defaultFavicon.svg');
      item.setAttribute('tooltiptext', label);
      return item;
    };

    updateItems = () => {
      this.doc.defaultView.requestAnimationFrame(() => {
        const fragment = this.doc.createDocumentFragment();
        const tabs = SessionStore.getClosedTabData(this.win);
        if (!tabs.length) {
          fragment.appendChild(createXULElement(this.doc, 'menuitem', { label: '没有最近关闭的标签页', disabled: true }));
        } else {
          tabs.forEach(tab => fragment.appendChild(this.createMenuItem(tab)));
        }
        this.#popup.replaceChildren(fragment);
      });
    };

    onMouseDown = e => {
      const item = e.target.closest('menuitem');
      if (!item?.dataset.closedId) return;
      e.ctrlKey ? item.setAttribute('closemenu', 'none') : item.removeAttribute('closemenu');
    };

    onCommand = e => {
      const item = e.target.closest('menuitem');
      if (!item?.dataset.closedId) return;
      SessionStore.undoCloseById(+item.dataset.closedId, true, this.win);
      if (item.hasAttribute('closemenu')) item.remove();
    };
  }

  class UndoCloseTabButton {
    constructor(doc) {
      this.doc = doc;
      this.popupHandler = new UndoCloseTabPopup(doc);
      Services.prefs.setIntPref('browser.sessionstore.max_tabs_undo', CONFIG.maxTabsUndo);
    }

    build = () => {
      let btn;
      if (CONFIG.bindHistoryButton) {
        btn = this.doc.getElementById('history-panelmenu');
        if (!btn) return null;
      } else {
        btn = createToolbarButton(this.doc, {
          id: 'undo-close-tab-button',
          label: '恢复标签页',
          tooltip: '恢复最近关闭的标签页',
          image: 'chrome://global/skin/icons/reload.svg',
          rotate: true,
        });
        btn.addEventListener('click', e => {
          if (e.button === 0) SessionStore.undoCloseTab(this.doc.defaultView, 0);
        }, { signal });
      }
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.popupHandler.popup.openPopupAtScreen(e.screenX, e.screenY, true);
      }, { signal });
      return btn;
    };
  }

  const buildBtn = (doc) => new UndoCloseTabButton(doc).build();

  if (CONFIG.bindHistoryButton) {
    if (document.readyState === 'complete') {
      buildBtn(document);
    } else {
      window.addEventListener('load', () => buildBtn(document), { once: true });
    }
  } else {
    CustomizableUI.createWidget({
      id: 'undo-close-tab-button',
      type: 'custom',
      defaultArea: CustomizableUI.AREA_NAVBAR,
      onBuild: buildBtn,
    });
  }

  return {
    cleanup: () => {
      abortController.abort();
      if (!CONFIG.bindHistoryButton) {
        CustomizableUI.destroyWidget('undo-close-tab-button');
      }
    }
  };
})();
