(function() {
    'use strict';

    const abortController = new AbortController();
    const { signal } = abortController;

    gBrowser.tabContainer.addEventListener('contextmenu', function(event) {
        if (event.ctrlKey) return;
        let tab = event.target?.closest('tab');
        if (tab) {
            event.preventDefault();
            event.stopPropagation();

            if (tab.multiselected) {
                gBrowser.removeMultiSelectedTabs();
            } else {
                gBrowser.removeTab(tab, {
                    animate: true,
                    triggeringEvent: event,
                });
            }
        }
    }, { capture: true, signal });

    return { cleanup: () => abortController.abort() };
})();
