// Only for Zen

(async function() {
  const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
  const zenThemesDir = PathUtils.join(chromeDir.path, "zen-themes");
  const zenThemesCss = PathUtils.join(chromeDir.path, "zen-themes.css");
  const dirExists = await IOUtils.exists(zenThemesDir);
  if (!dirExists || (dirExists && (await IOUtils.getChildren(zenThemesDir)).length === 0)) {
    await IOUtils.remove(zenThemesDir, { recursive: true }).catch(() => {});
    await IOUtils.remove(zenThemesCss).catch(() => {});
  }
})();
