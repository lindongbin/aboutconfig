(function() {
    'use strict';

    const abortController = new AbortController();
    const { signal } = abortController;

    const originalWhereToOpenLink = BrowserUtils.whereToOpenLink;
    BrowserUtils.whereToOpenLink = function(event, ignoreButton, ignoreAlt) {
        if (event?.target?.closest('#historyMenuPopup, #PanelUI-history')) {
            return gBrowser.selectedTab.isEmpty ? "current" : "tab";
        }
        return originalWhereToOpenLink.call(this, event, ignoreButton, ignoreAlt);
    };

    function bindHistoryHandlers(container, selector, panelView = false) {
        const handler = event => {
            if (!event.ctrlKey) return;
            const item = event.target.closest(selector);
            if (!item || !item._placesNode?.uri) return;

            if (event.type === 'mousedown') {
                const el = panelView ? event.target.closest('panelview') : item;
                if (el && !el.hasAttribute('closemenu')) el.setAttribute('closemenu', 'none');
            } else if (event.type === 'click') {
                event.preventDefault();
                event.stopPropagation();
                if (event._handledByCtrlClick) return;
                event._handledByCtrlClick = true;

                openLinkIn(item._placesNode.uri, 'tabshifted', {
                    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
                });

                if (!panelView) item.removeAttribute('closemenu');
            }
        };

        ['mousedown', 'click'].forEach(type => container.addEventListener(type, handler, { capture: true, signal }));
    }

    const popup = document.getElementById('historyMenuPopup');
    if (popup) bindHistoryHandlers(popup, 'menuitem');

    const historyPanelView = document.getElementById('PanelUI-history');
    if (historyPanelView) {
        bindHistoryHandlers(historyPanelView, 'menuitem, toolbarbutton', true);
    } else {
        const observer = new MutationObserver(muts => {
            for (const mut of muts) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.id === 'PanelUI-history') {
                        bindHistoryHandlers(node, 'menuitem, toolbarbutton', true);
                        observer.disconnect();
                        return;
                    }
                }
            }
        });
    
        const mainPopupSet = document.getElementById('mainPopupSet');
        if (mainPopupSet) observer.observe(mainPopupSet, { childList: true, subtree: true });

        signal.addEventListener('abort', () => observer.disconnect());
    }

    return {
        cleanup: () => {
            abortController.abort();
            BrowserUtils.whereToOpenLink = originalWhereToOpenLink;
        }
    };
})();
