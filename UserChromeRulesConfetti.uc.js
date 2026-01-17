// Only for UserChromeRules.uc.js

(function() {
  const CANVAS_ID = 'ucm-confetti-canvas';
  const el = document.getElementById('ucm-main-dialog');

  let animId, canvas, ctx, pieces = [];
  let isActive = false;
  let dpr = 1, cw = 0, ch = 0;

  const updateSize = () => {
    if (!canvas) return;
    const newDpr = window.devicePixelRatio || 1;
    const newCw = el.offsetWidth;
    const newCh = el.offsetHeight;
    if (newDpr === dpr && newCw === cw && newCh === ch) return;
    dpr = newDpr;
    cw = newCw;
    ch = newCh;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);
  };

  const initCanvas = () => {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1;');
      ctx = canvas.getContext("2d", { alpha: true });
      el.prepend(canvas);
    }
    updateSize();
    if (pieces.length === 0) {
      pieces = Array.from({ length: 50 }, () => ({
        x: Math.random() * cw,
        y: Math.random() * ch,
        s: Math.random() * 5 + 3,
        vx: Math.random() * 2 - 1,
        vy: Math.random() * 1.5 + 0.5,
        c: `hsl(${Math.random() * 360}, 70%, 70%)`,
        f: Math.random() * Math.PI,
        fs: Math.random() * 0.1
      }));
    }
  };

  const render = () => {
    if (!isActive) return;
    ctx.clearRect(0, 0, cw, ch);
    for (const p of pieces) {
      p.y = p.y > ch ? -10 : p.y + p.vy;
      p.x = (p.x + p.vx + cw) % cw;
      p.f += p.fs;
      ctx.fillStyle = p.c;
      const sw = p.s * Math.sin(p.f);
      ctx.fillRect(p.x - sw / 2, p.y - p.s / 2, sw, p.s);
    }
    animId = requestAnimationFrame(render);
  };

  const toggleEffect = (open) => {
    isActive = open;
    if (isActive) {
      initCanvas();
      render();
    } else {
      cancelAnimationFrame(animId);
    }
  };

  const mo = new MutationObserver(() => toggleEffect(el.hasAttribute('open')));
  mo.observe(el, { attributes: true, attributeFilter: ['open'] });

  const ro = new ResizeObserver(() => isActive && updateSize());
  ro.observe(el);

  if (el.hasAttribute('open')) toggleEffect(true);

  const cleanup = () => {
    isActive = false;
    cancelAnimationFrame(animId);
    mo.disconnect();
    ro.disconnect();
    canvas?.remove();
    canvas = null;
    pieces = [];
  };

  window.addEventListener('unload', cleanup);
  return cleanup;
})();
