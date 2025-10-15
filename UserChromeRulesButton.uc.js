// Only for UserChromeRules.uc.js

(() => {
  'use strict';

  CustomizableUI.createWidget({
    id: "userchrome-rules-button",
    label: "打开 UC 管理器",
    tooltiptext: "点击打开 UC 管理器",
    defaultArea: CustomizableUI.AREA_NAVBAR,
    onCommand: function(event) {
      window.showUserChromeRules();
    },
    onCreated: function(node) {
      node.setAttribute("image", "chrome://global/skin/icons/plugin.svg");
      node.classList.add("toolbarbutton-1");
      node.classList.add("chromeclass-toolbar-additional");
    }
  });

  return () => CustomizableUI.destroyWidget("userchrome-rules-button");
})();
