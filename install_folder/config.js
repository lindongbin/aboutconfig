// Only for UserChromeRules.uc.js

try {
  Services.obs.addObserver((win) => {
    win.addEventListener("load", () => {
      if (win.document.documentElement.getAttribute("windowtype") !== "navigator:browser") {
        return;
      }
      const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
      if (!chromeDir.exists()) chromeDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
      const entries = chromeDir.directoryEntries;
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      while (entries.hasMoreElements()) {
        const file = entries.nextFile;
        if (file.isFile() && file.leafName.endsWith(".uc.js")) {
          try {
            Services.scriptloader.loadSubScriptWithOptions(
              Services.io.newFileURI(file).spec,
              { target: win, ignoreCache: file.lastModifiedTime > oneHourAgo }
            );
          } catch (e) { Cu.reportError(e); }
        }
      }
    }, { once: true });
  }, "domwindowopened");
} catch (e) { Cu.reportError(e); }
