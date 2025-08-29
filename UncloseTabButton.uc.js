(() => {
  'use strict';

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

  const restoreClosedTab = (doc, index = 0) => {
    try { SessionStore.undoCloseTab(doc.defaultView, index); } catch {}
  };

  class UndoCloseTabPopup {
    #popup;

    constructor(doc) {
      this.doc = doc;
      this.win = doc.defaultView;
      this.#popup = doc.getElementById('undo-close-tab-popup') ?? createXULElement(doc, 'menupopup', { id: 'undo-close-tab-popup', style: 'max-width:300px;' });
      doc.documentElement.appendChild(this.#popup);
      this.#popup.addEventListener('popupshowing', () => this.updateItems());
      this.#popup.addEventListener('command', e => this.onCommand(e));
      this.#popup.addEventListener('mousedown', e => this.onMouseDown(e));
    }

    get popup() { return this.#popup; }

    createMenuItem = (tab, index) => {
      const label = tab.title ?? tab.state?.entries?.[0]?.title ?? tab.state?.entries?.[0]?.url ?? '未知页面';
      const item = createXULElement(this.doc, 'menuitem', { className: 'menuitem-iconic', label });
      item.dataset.index = index;
      item.setAttribute('image', tab.image ?? 'chrome://global/skin/icons/defaultFavicon.svg');
      return item;
    };

    updateItems = () => {
      const fragment = this.doc.createDocumentFragment();
      const count = SessionStore.getClosedTabCount(this.win);
      if (!count) {
        fragment.appendChild(createXULElement(this.doc, 'menuitem', { label: '没有最近关闭的标签页', disabled: true }));
      } else {
        const tabs = SessionStore.getClosedTabDataForWindow(this.win)
          .slice(0, Services.prefs.getIntPref('browser.sessionstore.max_tabs_undo'));
        tabs.forEach((tab, i) => fragment.appendChild(this.createMenuItem(tab, i)));
      }
      this.#popup.replaceChildren(fragment);
    };

    onMouseDown = e => {
      const item = e.target.closest('menuitem');
      if (!item?.dataset.index) return;
      e.ctrlKey ? item.setAttribute('closemenu', 'none') : item.removeAttribute('closemenu');
    };

    onCommand = e => {
      const item = e.target.closest('menuitem');
      if (!item?.dataset.index) return;
      restoreClosedTab(this.doc, +item.dataset.index);
      if (item.hasAttribute('closemenu')) this.updateItems();
    };
  }

  class UndoCloseTabButton {
    constructor(doc) {
      this.doc = doc;
      this.popupHandler = new UndoCloseTabPopup(doc);
    }

    build = () => {
      const btn = createToolbarButton(this.doc, {
        id: 'undo-close-tab-button',
        label: '恢复标签页',
        tooltip: '恢复最近关闭的标签页',
        image: 'chrome://global/skin/icons/reload.svg',
        rotate: true,
      });
      btn.addEventListener('click', e => e.button === 0 && restoreClosedTab(this.doc));
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.popupHandler.popup.openPopupAtScreen(e.screenX, e.screenY, true);
      });
      return btn;
    };
  }

  CustomizableUI.createWidget({
    id: 'undo-close-tab-button',
    type: 'custom',
    defaultArea: CustomizableUI.AREA_NAVBAR,
    onBuild: doc => new UndoCloseTabButton(doc).build(),
  });
})();
