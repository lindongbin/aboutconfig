// Only for UserChromeRules.uc.js

try {
  Services.obs.addObserver((window) => {
    if (window.location.href !== "chrome://browser/content/browser.xhtml") {
      return;
    }
    try {
      const scriptFile = Services.dirsvc.get("UChrm", Ci.nsIFile);
      scriptFile.append("UserChromeRules.uc.js");
      if (scriptFile.exists()) {
        Services.scriptloader.loadSubScript(
          Services.io.newFileURI(scriptFile).spec,
          window
        );
      }
    } catch (e) {
      Cu.reportError(e);
    }
  }, "browser-delayed-startup-finished");
} catch (e) {
  Cu.reportError(e);
}
