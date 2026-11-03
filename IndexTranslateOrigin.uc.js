(function () {
  const TARGET = "index-translate.bilibili.com";
  const obs = {
    observe(subject) {
      try {
        const chan = subject.QueryInterface(Ci.nsIHttpChannel);
        if (chan.URI?.host === TARGET && chan.getRequestHeader("Origin").startsWith("moz-extension://")) {
          chan.setRequestHeader("Origin", `https://${TARGET}`, false);
        }
      } catch {}
    }
  };
  Services.obs.addObserver(obs, "http-on-modify-request");
  return () => Services.obs.removeObserver(obs, "http-on-modify-request");
})();
