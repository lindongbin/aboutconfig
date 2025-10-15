// Only for UserChromeRules.uc.js

(() => {
  'use strict';

  const abortController = new AbortController();
  const { signal } = abortController;

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.key === 'u') {
      e.preventDefault();
      window.showUserChromeRules();
    }
  }, { signal });

  return () => abortController.abort();
})();
