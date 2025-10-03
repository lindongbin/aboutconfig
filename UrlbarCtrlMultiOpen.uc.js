(function () {
    'use strict';

    const originalWhereToOpen = gURLBar._whereToOpen;

    gURLBar._whereToOpen = function (event) {
        if (event?.ctrlKey) {
            const view = this.view;
            if (view?.close) {
                const { close } = view;
                view.close = () => {};
                setTimeout(() => view.close = close, 100);
            }
            return gBrowser.selectedTab.isEmpty ? "current" : "tab";
        }
        return originalWhereToOpen.call(this, event);
    };

    return { cleanup: () => { gURLBar._whereToOpen = originalWhereToOpen; } };
})();
