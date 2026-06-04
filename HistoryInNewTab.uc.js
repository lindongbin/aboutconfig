(function() {
    'use strict';

    const originalWhereToOpenLink = BrowserUtils.whereToOpenLink;

    BrowserUtils.whereToOpenLink = function(event, ignoreButton, ignoreAlt) {
        if (event?.target?.closest('#historyMenuPopup, #PanelUI-history, #historyTree') || event?.target?.ownerDocument?.URL === 'chrome://browser/content/sidebar/sidebar-history.html') {
            if (gBrowser.selectedTab.isEmpty) {
                return "current";
            }
            return "tab";
        }
        return originalWhereToOpenLink.call(this, event, ignoreButton, ignoreAlt);
    };
    return { cleanup: () => { BrowserUtils.whereToOpenLink = originalWhereToOpenLink; } };
})();
