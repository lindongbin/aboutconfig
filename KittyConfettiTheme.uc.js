// Only for UserChromeRules.uc.js

(function() {
  const CANVAS_ID = 'ucm-confetti-canvas';
  const style = document.createElement('style');
  style.textContent = `
    #${CANVAS_ID} { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; pointer-events: none !important; z-index: -1 !important; }
    #ucm-main-dialog, #ucm-edit-dialog, #ucm-confirm-dialog { background-color: #fff0f5 !important; background-image: radial-gradient(#ffb7c5 20%, transparent 20%), radial-gradient(#ffb7c5 20%, transparent 20%) !important; background-size: 20px 20px !important; background-position: 0 0, 10px 10px !important; border: 1px solid #ff69b4 !important; border-radius: 24px !important; box-shadow: 0 10px 30px rgba(255, 105, 180, 0.5) !important; color: #5e4950 !important; }
    #ucm-main-dialog .ucm-form { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 12px !important; align-content: start !important; }
    #ucm-main-dialog .ucm-form > div[style*="display: flex"] { grid-column: 1 / -1 !important; order: 9999 !important; margin-top: 5px !important; padding-top: 10px !important; border-top: 1px dashed #ffb7c5 !important; }
    #ucm-main-dialog .ucm-item { background: rgba(255, 255, 255, 0.7) !important; border: 1px solid #ffc0cb !important; border-radius: 16px !important; padding: 6px 10px !important; min-width: 0 !important; transition: transform 0.2s ease !important; }
    #ucm-main-dialog .ucm-item:hover { border-color: #ff69b4 !important; transform: scale(1.02) !important; }
    #ucm-main-dialog .ucm-label { flex: 1 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; padding-top: 2px !important; padding-bottom: 2px !important; pointer-events: none !important; cursor: default !important; }
    #ucm-main-dialog button, #ucm-edit-dialog button, #ucm-confirm-dialog button { background: rgba(255, 240, 245, 0.9) !important; border: 1px dotted #ffb7c5 !important; box-shadow: 0 2px 0 #db4c97 !important; color: #5e4950 !important; border-radius: 20px !important; padding: 5px 12px !important; font-weight: bold !important; transition: all 0.2s ease !important; cursor: pointer; }
    #ucm-main-dialog button:hover, #ucm-edit-dialog button:hover, #ucm-confirm-dialog button:hover { transform: translateY(-2px) !important; box-shadow: 0 5px 0 #db4c97 !important; }
    #ucm-main-dialog button:active, #ucm-edit-dialog button:active, #ucm-confirm-dialog button:active { transform: translateY(2px) !important; box-shadow: 0 2px 0 #db4c97 !important; }
    #ucm-main-dialog .ucm-edit-btn, #ucm-main-dialog .ucm-delete-btn { font-size: 0 !important; width: 28px !important; height: 28px !important; padding: 0 !important; min-width: 28px !important; margin-left: 5px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
    #ucm-main-dialog .ucm-edit-btn::before, #ucm-main-dialog .ucm-delete-btn::before { content: ""; display: block; width: 16px; height: 16px; background-color: #5e4950 !important; mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
    #ucm-main-dialog .ucm-edit-btn::before { mask-image: url("chrome://global/skin/icons/edit.svg"); }
    #ucm-main-dialog .ucm-delete-btn::before { mask-image: url("chrome://global/skin/icons/delete.svg"); }
    #ucm-edit-dialog input[type=text], #ucm-edit-dialog textarea { background: #fff !important; border: 1px solid #ffb7c5 !important; border-radius: 12px !important; padding: 8px !important; color: #5e4950 !important; }
    #ucm-edit-dialog input[type=text]:focus, #ucm-edit-dialog textarea:focus { border: 1px solid #ff69b4 !important; outline: none !important; }
    #ucm-main-dialog input[type="checkbox"], #ucm-main-dialog input[type="radio"], #ucm-edit-dialog input[type="checkbox"], #ucm-edit-dialog input[type="radio"] { accent-color: #ff69b4 !important; cursor: pointer !important; }
  `;
  document.head.appendChild(style);

  let animId, canvas, ctx, pieces = [], observers = [];
  let isActive = false;

  const initCanvas = (dialog) => {
    if (!canvas) canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    if (canvas.parentNode !== dialog) dialog.prepend(canvas);
    
    const dpr = window.devicePixelRatio || 1;
    const w = dialog.offsetWidth, h = dialog.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx = canvas.getContext("2d", { alpha: true });
    ctx.scale(dpr, dpr);

    if (pieces.length === 0) {
      for (let i = 0; i < 50; i++) {
        pieces.push({
          x: Math.random() * w, y: Math.random() * h,
          s: Math.random() * 5 + 3, vx: Math.random() * 2 - 1,
          vy: Math.random() * 1.5 + 0.5, c: `hsl(${Math.random() * 360}, 70%, 70%)`,
          f: Math.random() * Math.PI, fs: Math.random() * 0.1
        });
      }
    }
  };

  const render = (w, h) => {
    if (!isActive) return;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0, len = pieces.length; i < len; i++) {
      const p = pieces[i];
      p.y += p.vy; p.x += p.vx; p.f += p.fs;
      if (p.y > h) p.y = -10;
      if (p.x > w) p.x = 0; else if (p.x < 0) p.x = w;

      ctx.fillStyle = p.c;
      const sw = p.s * Math.sin(p.f);
      ctx.fillRect(p.x - sw / 2, p.y - p.s / 2, sw, p.s);
    }
    animId = requestAnimationFrame(() => render(w, h));
  };

  const toggle = (target) => {
    isActive = target.hasAttribute('open');
    if (isActive) {
      initCanvas(target);
      render(target.offsetWidth, target.offsetHeight);
    } else {
      cancelAnimationFrame(animId);
    }
  };

  const clearObs = () => { observers.forEach(o => o.disconnect()); observers = []; };

  const start = () => {
    const el = document.getElementById('ucm-main-dialog');
    if (el) {
      const mo = new MutationObserver(() => toggle(el));
      mo.observe(el, { attributes: true, attributeFilter: ['open'] });
      observers.push(mo);
      if (el.hasAttribute('open')) toggle(el);
    } else {
      const bo = new MutationObserver(() => {
        if (document.getElementById('ucm-main-dialog')) { clearObs(); start(); }
      });
      bo.observe(document.body, { childList: true, subtree: true });
      observers.push(bo);
    }
  };

  start();

  return () => {
    isActive = false;
    cancelAnimationFrame(animId);
    clearObs();
    style.remove();
    canvas?.remove();
  };
})();
