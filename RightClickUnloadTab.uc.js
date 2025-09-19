(function() {
    'use strict';

    gBrowser.tabContainer.addEventListener('contextmenu', function(event) {
        if (event.ctrlKey) return;
        let tab = event.target?.closest('tab');
        if (tab) {
            event.preventDefault();
            event.stopPropagation();

            if (tab.multiselected) {
                gBrowser.explicitUnloadTabs(gBrowser.selectedTabs);
            } else {
                gBrowser.explicitUnloadTabs([tab]);
            }
        }
    }, true);
})();
