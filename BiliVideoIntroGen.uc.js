(function() {
  if (location.href !== "chrome://browser/content/browser.xhtml") return;

  const delayMs = 100;
  const fontFamily = "sans-serif";

  const titleFontSize = 28;
  const titleFontWeight = "bold";
  const titleColor = "#5F6DE8";

  const textFontSize = 22;
  const textFontWeight = "normal";
  const textColor = "#7D7D7D";

  const infoFontSize = 21;
  const infoFontWeight = "normal";
  const infoColor = "#FB7299";

  const userNameFontSize = 25;
  const userNameFontWeight = "normal";
  const userNameColor = "#141414";

  const lineHeightFactor = 1.5;
  const lhTitle = Math.ceil(titleFontSize * lineHeightFactor);
  const lhText = Math.ceil(textFontSize * lineHeightFactor);

  const measureCtx = new OffscreenCanvas(1, 1).getContext("2d");

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const formatNum = v => v > 10000 ? (v / 10000).toFixed(1) + 'w' : v;
  const formatDate = ts => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16);

  const md5 = s => {
    const enc = new TextEncoder(), data = enc.encode(s);
    const ch = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
    ch.init(ch.MD5);
    ch.update(data, data.length);
    return Array.from(ch.finish(false)).map(b => b.charCodeAt(0).toString(16).padStart(2, '0')).join("");
  };

  const getWbiUrl = async (params, imgKey, subKey) => {
    const table = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
    const rawKey = imgKey + subKey;
    const mixinKey = table.map(n => rawKey[n]).join("").slice(0, 32);
    const query = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
    return `https://api.bilibili.com/x/web-interface/view/conclusion/get?${query}&w_rid=${md5(query + mixinKey)}`;
  };

  const wrapText = (text, fontSize, maxWidth) => {
    measureCtx.font = `${fontSize}px ${fontFamily}`;
    const lead = ".,!?;:)]}。，、！？；：”’）】》」』";
    const trail = "([{“‘（【《「『";
    const lines = [];
    text.split('\n').forEach(p => {
      if (!p) { lines.push(""); return; }
      let start = 0;
      while (start < p.length) {
        let l = start, r = p.length, best = start;
        while (l <= r) {
          const m = Math.floor((l + r) / 2);
          if (measureCtx.measureText(p.slice(start, m)).width <= maxWidth) { best = m; l = m + 1; } 
          else r = m - 1;
        }
        let line = p.slice(start, best + (best < p.length && lead.includes(p[best]) ? 1 : 0));
        if (lines.length) {
          if (lead.includes(line[0])) { lines[lines.length - 1] += line[0]; line = line.slice(1); }
          if (trail.includes(lines[lines.length - 1].slice(-1))) {
            line = lines[lines.length - 1].slice(-1) + line;
            lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
          }
        }
        lines.push(line);
        start = best + (best < p.length && lead.includes(p[best]) ? 1 : 0);
      }
    });
    return lines;
  };

  const draw = async data => {
    const dpiScale = window.devicePixelRatio || 1;
    const baseWidth = 600;
    const p = 35;
    const bgColor = "#FAFAFA";
    const avatarSize = 80;

    const loadImg = async url => createImageBitmap(await (await fetch(url.startsWith('//') ? 'https:' + url : url)).blob());
    const [cover, face] = await Promise.all([loadImg(data.pic), loadImg(data.owner.face)]);

    const maxWidth = baseWidth - p * 2;
    const coverHeight = maxWidth * (cover.height / cover.width);

    const duration = data.duration > 3600 ?
      `${Math.floor(data.duration / 3600)}小时${Math.floor((data.duration % 3600) / 60)}分钟` :
      `${Math.floor(data.duration / 60)}分${data.duration % 60}秒`;

    let summaryText = `【视频信息】\nBVID：${data.bvid}\n时长：${duration}`;
    if (data.summary?.trim()) summaryText += `\n\n【摘要】\n${data.summary}`;
    if (data.desc && data.desc !== '-') summaryText += `\n\n【简介】\n${data.desc}`;

    const titleLines = wrapText(data.title, titleFontSize, maxWidth);
    const summaryLines = wrapText(summaryText, textFontSize, maxWidth);

    const infoLines = [
      `${formatDate(data.pubdate)} 发布`,
      `${formatNum(data.stat.view)}播放・${formatNum(data.stat.reply)}评论・${formatNum(data.stat.danmaku)}弹幕`,
      `${formatNum(data.stat.like)}点赞・${formatNum(data.stat.coin)}投币・${formatNum(data.stat.favorite)}收藏・${formatNum(data.stat.share)}分享`
    ];

    const totalHeight = p + coverHeight + p + avatarSize + p + infoLines.length * lhText + p + titleLines.length * lhTitle + p + summaryLines.length * lhText + p;
    const offscreen = new OffscreenCanvas(baseWidth * dpiScale, totalHeight * dpiScale);
    const ctx = offscreen.getContext("2d", { alpha: false });

    ctx.scale(dpiScale, dpiScale);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, baseWidth, totalHeight);
    ctx.textBaseline = "top";

    let y = p;
    ctx.drawImage(cover, p, y, maxWidth, coverHeight);
    y += coverHeight + p;

    const centerX = p + avatarSize / 2;
    const centerY = y + avatarSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, avatarSize / 2, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(face, p, y, avatarSize, avatarSize);
    ctx.restore();

    ctx.fillStyle = userNameColor;
    ctx.font = `${userNameFontWeight} ${userNameFontSize}px ${fontFamily}`;
    const maxNameWidth = baseWidth - p - (avatarSize + 0.25 * avatarSize) - p;
    let username = data.owner.name;
    while (ctx.measureText(username).width > maxNameWidth && username.length > 0) {
      username = username.slice(0, -1);
    }
    if (username !== data.owner.name) username = username.slice(0, -1) + '…';
    ctx.fillText(username, p + avatarSize + 0.25 * avatarSize, y + 0.125 * avatarSize);
    ctx.fillText(data.follower, p + avatarSize + 0.25 * avatarSize, y + 0.55 * avatarSize);
    y += avatarSize + p;

    ctx.fillStyle = infoColor;
    ctx.font = `${infoFontWeight} ${infoFontSize}px ${fontFamily}`;
    infoLines.forEach((line, i) => ctx.fillText(line, p, y + i * lhText));
    y += infoLines.length * lhText + p;

    ctx.font = `${titleFontWeight} ${titleFontSize}px ${fontFamily}`;
    ctx.fillStyle = titleColor;
    titleLines.forEach(line => { ctx.fillText(line, p, y); y += lhTitle; });
    y += p;

    ctx.font = `${textFontWeight} ${textFontSize}px ${fontFamily}`;
    ctx.fillStyle = textColor;
    summaryLines.forEach(line => { ctx.fillText(line, p, y); y += lhText; });

    const blob = await offscreen.convertToBlob({ type: "image/png" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      openTrustedLinkIn(url, 'tab', { relatedToCurrent: true });
      URL.revokeObjectURL(url);
      cover.close();
      face.close();
    };
    img.src = url;
  };

  const startProcess = async () => {
    const bv = gBrowser.selectedBrowser.currentURI.spec.match(/BV[a-zA-Z0-9]+/)?.[0];
    if (!bv) return;

    try {
      const navRes = await fetch(`https://api.bilibili.com/x/web-interface/nav`).then(r => r.json());
      const { img_url, sub_url } = navRes.data.wbi_img;
      await sleep(delayMs);

      const vRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`).then(r => r.json());
      const info = vRes.data;
      await sleep(delayMs);

      const wbiUrl = await getWbiUrl(
        { bvid: bv, cid: info.cid, up_mid: info.owner.mid, wts: Math.floor(Date.now() / 1000) },
        img_url.split('/').pop().split('.')[0],
        sub_url.split('/').pop().split('.')[0]
      );
      const summaryRes = await fetch(wbiUrl, { credentials: 'include' }).then(r => r.json());
      await sleep(delayMs);

      const relRes = await fetch(`https://api.bilibili.com/x/relation/stat?vmid=${info.owner.mid}`).then(r => r.json());

      draw({
        ...info,
        follower: formatNum(relRes.data.follower) + '粉丝',
        summary: summaryRes.data?.model_result?.summary
      });
    } catch (e) {}
  };

  CustomizableUI.createWidget({
    id: "bili-intro-gen-btn",
    label: "生成B站视频简介",
    tooltiptext: "获取当前视频信息并生成长图",
    defaultArea: CustomizableUI.AREA_NAVBAR,
    onCommand: () => startProcess(),
    onCreated: node => {
      node.style.listStyleImage = "url('https://www.bilibili.com/favicon.ico')";
      node.classList.add("toolbarbutton-1", "chromeclass-toolbar-additional");
    }
  });

  return () => CustomizableUI.destroyWidget("bili-intro-gen-btn");
})();
