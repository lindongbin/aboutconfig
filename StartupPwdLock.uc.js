(function () {
  'use strict';

  const CUSTOM_PASSWORD = "123456";

  try {
    const password = { value: "" };
    const result = Services.prompt.promptPassword(
      null,
      "Firefox 密码验证",
      "请输入密码以继续使用 Firefox:",
      password
    );

    if (!result || password.value !== CUSTOM_PASSWORD) {
      Services.startup.quit(Services.startup.eForceQuit);
    }
  } catch {
    Services.startup.quit(Services.startup.eForceQuit);
  }
})();
