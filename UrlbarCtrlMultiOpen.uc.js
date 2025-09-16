(function () {
    'use strict';

    const originalWhereToOpen = gURLBar._whereToOpen;

    gURLBar._whereToOpen = function (event) {
        if (event?.ctrlKey) {
            const view = this.view;
            if (view?.close) {
                const { close } = view;
                view.close = () => {};
                queueMicrotask(() => view.close = close);
            }
            return gBrowser.selectedTab.isEmpty ? "current" : "tab";
        }
        return originalWhereToOpen.call(this, event);
    };
})();
