// UserChromeRules.uc.js

function runUserChromeRules(win = window) {

  const window = win;
  const document = win.document;
  const raf = win.requestAnimationFrame;
  const caf = win.cancelAnimationFrame;
  const wu = win.windowUtils;

  const ucr = "UserChromeRules";

  const itemElements = new Map();
  const sandboxMap = new Map();
  const scriptMap = new Map();
  const styleMap = new Map();
  const keyToIndexMap = new Map();
  const styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
  const chromeDirURI = Services.io.newFileURI(chromeDir);
  const rulesDeps = PathUtils.join(chromeDir.path, ucr);
  const pattern = /@?import\s+.*?(?:"|'|\(["']?)(.+?\.(?:css|js|mjs))["')]/gmi;

  let mainDialog, editDialog;
  let rulesInMemory = [];
  let originalSnapshot = '';
  let isDirty = false;
  let filterType = null;

  const baseCSS = `
    #ucm-main-dialog, #ucm-edit-dialog, #ucm-confirm-dialog {
      padding: 15px; border: 1px solid var(--arrowpanel-border-color);
      border-radius: 4px; background: var(--arrowpanel-background);
      color: var(--arrowpanel-color); font-size: 14px; line-height: 14px;
      box-shadow: 0 1px 4px color-mix(in srgb, currentColor 20%, transparent);
    }
    #ucm-main-dialog::backdrop, #ucm-edit-dialog::backdrop, #ucm-confirm-dialog::backdrop {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .ucm-form { display: flex; flex-direction: column; gap: 12px; }
    .ucm-type-group { display: flex; gap: 10px; }
    .ucm-type-group label { display: flex; align-items: center; user-select: none; cursor: pointer; }
    .ucm-grid {
      display: grid;
      grid-auto-flow: column;
      grid-template-columns: repeat(var(--ucm-grid-columns, 1), 1fr);
      grid-template-rows: repeat(var(--dynamic-rows, 1), var(--ucm-row-height, 24px));
      gap: 10px;
      align-items: start;
    }
    .ucm-item {
      display: flex; align-items: center; gap: 8px; min-width: 0; user-select: none;
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }
    .ucm-item.ucm-dragging { opacity: 0; pointer-events: none; }
    .ucm-item.ucm-fade-in { animation: fadeIn 0.5s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .ucm-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ucm-drag-handle { cursor: grab; }
    .ucm-edit-btn, .ucm-delete-btn { margin-left: 4px; }
    #ucm-edit-dialog input[type=text], #ucm-edit-dialog textarea { box-sizing: border-box; font-family: monospace; }
    #ucm-edit-dialog textarea { min-height: 200px; max-height: 80vh; min-width: 400px; max-width: 100%; }
  `;

  const DEFAULT_LANG = {
    menu_label: "UC Manager",
    btn_add: "Add",
    btn_export: "Export",
    btn_import: "Import",
    btn_backup: "Backup",
    btn_folder: "Folder",
    btn_restart: "Restart",
    btn_exit: "Exit",
    btn_modify: "Modify",
    btn_delete: "Delete",
    btn_ok: "OK",
    btn_cancel: "Cancel",
    placeholder_name: "Rule Name",
    tip_restart_js: "A browser restart is required to completely disable this JS rule.",
    confirm_restart: "Are you sure you want to restart Firefox?",
    confirm_delete: (type, name) => `Delete ${type} rule "${name}"?`,
    confirm_overwrite: "Backup exists. Overwrite?",
    msg_export_ok: (n) => `Successfully exported ${n} rules.`,
    msg_backup_ok: "Backup completed!",
    picker_folder: "Select Export Folder",
    picker_file: "Select Files",
    picker_type: "File Types"
  };

  window.UCM_I18N = {
    lang: { ...DEFAULT_LANG },
    _updateUI() {
      const menuBtn = document.getElementById('appMenu-ucm-button');
      if (menuBtn) menuBtn.setAttribute('label', this.lang.menu_label);
      const oldDialog = document.getElementById('ucm-main-dialog');
      if (oldDialog && oldDialog.open) {
        oldDialog.close();
        oldDialog.remove();
        mainDialog = null;
        itemElements.clear();
        showMainDialog();
      }
    },
    update(newStrings) {
      Object.assign(this.lang, newStrings);
      this._updateUI();
    },
    reset() {
      this.lang = { ...DEFAULT_LANG };
      this._updateUI();
    }
  };

  const _ = (key, ...args) => {
    const entry = window.UCM_I18N.lang[key];
    if (!entry) return key;
    return typeof entry === "function" ? entry(...args) : entry;
  };

  function createSnapshot(rules) {
    const snapshotData = rules.map(item => ({
      key: item.key,
      enabled: !!item.rule.enabled
    }));
    return JSON.stringify(snapshotData);
  }

  function getStorageFile() {
    const file = chromeDir.clone();
    file.append(`${ucr}.json`);
    return file;
  }

  function getRulesObj() {
    return rulesInMemory.reduce((obj, {key, rule}) => { obj[key] = rule; return obj; }, {});
  }
  
  function syncKeyIndexMap() {
    keyToIndexMap.clear();
    rulesInMemory.forEach((item, index) => {
      keyToIndexMap.set(item.key, index);
    });
  }

  async function getRulesFromFile() {
    try {
      const file = getStorageFile();
      const exists = await IOUtils.exists(file.path);
      if (exists) {
        const data = await IOUtils.readUTF8(file.path);
        return Object.entries(JSON.parse(data)).map(([key, rule]) => ({key, rule}));
      }
    } catch (e) { Cu.reportError(e); }
    return [];
  }

  async function saveRulesToFile() {
    try {
      const file = getStorageFile();
      await IOUtils.writeUTF8(file.path, JSON.stringify(getRulesObj(), null, 2));
    } catch (e) { Cu.reportError(e); }
  }

  async function exportRules() {
    const dir = await pickFileOrFolder(_('picker_folder'), 'folder');
    if (!dir) return;
    const exportDir = PathUtils.join(dir, `${ucr}_${Date.now()}`);
    await IOUtils.makeDirectory(exportDir);
    let exported = 0;
    for (const { key, rule } of rulesInMemory) {
      const safeName = `${rule.label.replace(/[<>:"/\\|?*]/g, '_').trim()}_${key}`;
      const ruleDir = PathUtils.join(exportDir, safeName);
      const mainFile = PathUtils.join(ruleDir, `${safeName}.${rule.type}`);
      const depDir = PathUtils.join(rulesDeps, key);
      const hasDeps = await IOUtils.exists(depDir);
      if (hasDeps) {
        await IOUtils.copy(depDir, ruleDir, { recursive: true });
      } else {
        await IOUtils.makeDirectory(ruleDir);
      }
      await IOUtils.writeUTF8(mainFile, rule.code);
      exported++;
    }
    await showConfirmDialog(_('msg_export_ok', exported), null, true);
  }

  async function importRules() {
    const files = await pickFileOrFolder(_('picker_file'), 'files', ['.json', '.js', '.mjs', '.css']);
    if (!files?.length) return;
    let importedCount = 0;
    for (const file of files) {
      try {
        const content = await IOUtils.readUTF8(file.path);
        let newRules = [];
        if (file.leafName.endsWith('.json')) {
          const data = JSON.parse(content);
          newRules = Object.entries(data).filter(([k, value]) =>
            value && typeof value.type === 'string' && ['js', 'css'].includes(value.type) &&
            typeof value.label === 'string' && typeof value.code === 'string' && typeof value.enabled === 'boolean'
          ).map(([k, value]) => ({key: k, rule: value}));
        } else {
          const ext = file.leafName.endsWith('.css') ? 'css' : 'js';
          const label = file.leafName.replace(/\.(js|mjs|css)$/, '');
          const key = `ucm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const matches = [...content.matchAll(pattern)];
          if (matches.length > 0) {
            const keyDir = PathUtils.join(rulesDeps, key);
            await IOUtils.makeDirectory(keyDir);
            const base = PathUtils.parent(file.path);
            const copied = new Set();
            for (const matche of matches) {
              let depPath = matche[1];
              depPath = depPath.startsWith('./') ? depPath.substring(2) : depPath;
              const isFolder = depPath.includes('/');
              const depName = isFolder ? depPath.split('/')[0] : depPath;
              if (copied.has(depName)) continue;
              const sourcePath = PathUtils.join(base, depName);
              const destPath = PathUtils.join(keyDir, depName);
              await IOUtils.copy(sourcePath, destPath, { recursive: isFolder }).catch(() => {});
              copied.add(depName);
            }
          }
          newRules = [{key, rule: {type: ext, label, enabled: true, code: content}}];
        }
        for (const {key, rule} of newRules) {
          if (findIndexByKey(key) === -1) {
            rulesInMemory.push({key, rule});
            await applyUserChrome({ [key]: rule });
            importedCount++;
          }
        }
      } catch (e) { Cu.reportError(e); }
    }
    if (importedCount > 0) {
      syncKeyIndexMap();
      isDirty = true;
    }
    await updateDialogDOM();
  }

  function pickFileOrFolder(title, mode, accept = []) {
    return new Promise(resolve => {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      const pickerModeMap = {
        folder: Ci.nsIFilePicker.modeGetFolder,
        files: Ci.nsIFilePicker.modeOpenMultiple
      };
      let pickerMode = pickerModeMap[mode] || Ci.nsIFilePicker.modeOpen;
      fp.init(window.browsingContext, title, pickerMode);
      if (mode !== 'folder' && accept.length) {
        if (accept.length > 1) {
          fp.appendFilter(_('picker_type'), accept.map(ext => `*${ext}`).join('; '));
        }
        accept.forEach(ext => fp.appendFilter(ext, `*${ext}`));
      }
      fp.open(result => {
        if (result !== Ci.nsIFilePicker.returnOK) return resolve(null);
        if (mode === 'folder') return resolve(fp.file.path);
        if (mode === 'files') {
          const files = [];
          const iter = fp.files;
          while (iter.hasMoreElements()) files.push(iter.getNext().QueryInterface(Ci.nsIFile));
          return resolve(files);
        }
        resolve(fp.file);
      });
    });
  }

  async function backupRules() {
    await saveIfNeeded();
    const backupFile = chromeDir.clone();
    backupFile.append(`${ucr}.zip`);
    const performBackup = async () => {
      try {
        const zipW = Components.Constructor("@mozilla.org/zipwriter;1", "nsIZipWriter")();
        zipW.open(backupFile, 0x04 | 0x08 | 0x20);
        const jsonFile = getStorageFile();
        if (await IOUtils.exists(jsonFile.path)) {
          zipW.addEntryFile(jsonFile.leafName, Ci.nsIZipWriter.COMPRESSION_NONE, jsonFile, false);
        }
        if (await IOUtils.exists(rulesDeps)) {
          const rootNSI = await IOUtils.getDirectory(rulesDeps);
          const addFolder = async (dirPath) => {
            for (const path of await IOUtils.getChildren(dirPath)) {
              const info = await IOUtils.stat(path);
              if (info.type === "directory") {
                await addFolder(path);
              } else {
                const fileNSI = await IOUtils.getFile(path);
                let relPath = fileNSI.getRelativePath(rootNSI).replace(/\\/g, "/");
                zipW.addEntryFile(ucr + "/" + relPath, Ci.nsIZipWriter.COMPRESSION_NONE, fileNSI, false);
              }
            }
          };
          await addFolder(rulesDeps);
        }
        zipW.close();
        await showConfirmDialog(_('msg_backup_ok'), null, true);
      } catch (e) { Cu.reportError(e); }
    };
    if (await IOUtils.exists(backupFile.path)) {
      await showConfirmDialog(_('confirm_overwrite'), performBackup);
    } else {
      await performBackup();
    }
  }

  async function saveIfNeeded() {
    const currentSnapshot = createSnapshot(rulesInMemory);
    const needsSave = isDirty || (currentSnapshot !== originalSnapshot);
    if (needsSave) {
      await saveRulesToFile();
      isDirty = false;
      originalSnapshot = currentSnapshot;
    }
  }

  async function restartBrowser() {
    await saveIfNeeded();
    let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(cancelQuit, "quit-application-requested", "restart");
    if (cancelQuit.data) return;
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
  }

  function cleanupRule(key, type) {
    if (type === 'js') {
      if (scriptMap.has(key)) {
        try { scriptMap.get(key)?.cleanup?.(); } catch (e) { Cu.reportError(e); }
        scriptMap.delete(key);
      }
      if (sandboxMap.has(key)) {
        sandboxMap.delete(key);
      }
    } else if (type === 'css' && styleMap.has(key)) {
      styleSheetService.unregisterSheet(styleMap.get(key), styleSheetService.USER_SHEET);
      styleMap.delete(key);
    }
  }

  async function applyUserChrome(targetRules = getRulesObj()) {
    for (const [key, rule] of Object.entries(targetRules)) {
      cleanupRule(key, rule?.type);
      if (!rule?.enabled) continue;
      let uri, code = rule.code, hasDeps = false;
      code = code.replace(pattern, (match, path) => {
        hasDeps = true;
        const cleanPath = path.startsWith('./') ? path.substring(2) : path;
        return match.replace(path, `resource://${ucr}/${ucr}/${key}/${cleanPath}`);
      });
      if (rule.type === 'js') {
        const sandbox = Cu.Sandbox(window, {
          sandboxPrototype: window,
          wantXrays: false,
          sandboxName: `UserChrome Rule: ${rule.label}`
        });
        if (hasDeps) {
          const tempFile = chromeDir.clone();
          tempFile.append(`_${key}.mjs`);
          await IOUtils.writeUTF8(tempFile.path, code);
          uri = Services.io.newURI(`resource://${ucr}/_${key}.mjs`);
          Cu.evalInSandbox(`ChromeUtils.importESModule("${uri.spec}", {global: "current"});`, sandbox);
          await IOUtils.remove(tempFile.path);
        } else {
          sandboxMap.set(key, sandbox);
          const result = Cu.evalInSandbox(code, sandbox);
          const cleanupFn = typeof result === "function" ? result
            : Object.values(result ?? {}).find(v => typeof v === "function") ?? null;
          if (cleanupFn) {
            scriptMap.set(key, { cleanup: cleanupFn });
          }
        }
      } else if (rule.type === 'css') {
        code = code.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, url) => {
          if (/^(data:|https?:|file:|chrome:|resource:)/.test(url)) return `url(${quote}${url}${quote})`;
          const cleanUrl = url.startsWith('./') ? url.substring(2) : url;
          return `url(${quote}resource://${ucr}/${cleanUrl}${quote})`;
        });
        uri = Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(code)}`);
        styleSheetService.loadAndRegisterSheet(uri, styleSheetService.USER_SHEET);
        styleMap.set(key, uri);
      }
    }
  }

  function createDialog(id, buildContent) {
    let dialog = document.getElementById(id);
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = id;
      document.body.appendChild(dialog);
    }
    dialog.replaceChildren();
    buildContent(dialog);
    return dialog;
  }

  function createButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function createButtonRow(buttons) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px;';
    buttons.forEach(b => row.appendChild(b));
    return row;
  }

  function findIndexByKey(key) {
    return keyToIndexMap.get(key) ?? -1;
  }

  function createItemElement(key, rule) {
    const div = document.createElement('div');
    div.className = 'ucm-item';
    div.dataset.key = key;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled;
    const labelEl = document.createElement('label');
    labelEl.className = 'ucm-label ucm-drag-handle';
    labelEl.textContent = `[${rule.type.toUpperCase()}] ${rule.label}`;
    labelEl.setAttribute('draggable', 'true');
    const editBtn = createButton(_('btn_modify'), null);
    editBtn.className = 'ucm-edit-btn';
    const deleteBtn = createButton(_('btn_delete'), null);
    deleteBtn.className = 'ucm-delete-btn';
    div.append(checkbox, labelEl, editBtn, deleteBtn);
    return { container: div, checkbox, labelEl };
  }

  function setupDragAndDrop(form) {
    if (form.hasAttribute('data-drag-setup')) return;
    form.setAttribute('data-drag-setup', 'true');
    let draggedItem = null;
    let draggedIdx = -1;
    let items = [];
    let rafId = null;
    form.addEventListener('dragstart', (e) => {
      const target = e.target.closest('.ucm-item');
      if (!target) return;
      draggedItem = target;
      items = Array.from(form.querySelectorAll('.ucm-item'));
      draggedIdx = items.indexOf(draggedItem);
      const positions = items.map(item => {
        const r = wu.getBoundsWithoutFlushing(item);
        return {
          left: r.left,
          top: r.top,
          right: r.left + r.width,
          bottom: r.top + r.height
        };
      });
      form._dragConfig = { positions };
      e.dataTransfer.effectAllowed = 'move';
      draggedItem.classList.add('ucm-dragging');
    });
    form.addEventListener('dragover', (e) => {
      e.preventDefault();
      const cfg = form._dragConfig;
      if (!draggedItem || !cfg) return;
      if (rafId) caf(rafId);
      rafId = raf(() => {
        const { positions } = cfg;
        const curX = e.clientX;
        const curY = e.clientY;
        let hoverIdx = -1;
        for (let i = 0; i < positions.length; i++) {
          const pos = positions[i];
          if (curX >= pos.left && curX <= pos.right &&
              curY >= pos.top && curY <= pos.bottom) {
            hoverIdx = i;
            break;
          }
        }
        if (hoverIdx !== -1 && form._lastHoverIdx !== hoverIdx) {
          const isMovingDown = hoverIdx > draggedIdx;
          const affectedMin = Math.min(draggedIdx, hoverIdx);
          const affectedMax = Math.max(draggedIdx, hoverIdx);
          for (let i = 0; i < items.length; i++) {
            if (i === draggedIdx) continue;
            const item = items[i];
            let transform = '';
            if (i >= affectedMin && i <= affectedMax) {
              const targetIdx = isMovingDown ? i - 1 : i + 1;
              const dx = positions[targetIdx].left - positions[i].left;
              const dy = positions[targetIdx].top - positions[i].top;
              transform = `translate(${dx}px, ${dy}px)`;
            }
            if (item.style.transform !== transform) item.style.transform = transform;
          }
          form._lastHoverIdx = hoverIdx;
        }
      });
    });
    form.addEventListener('dragend', () => {
      if (rafId) caf(rafId);
      if (!draggedItem) return;
      const targetIdx = form._lastHoverIdx;
      draggedItem.classList.remove('ucm-dragging');
      items.forEach(item => {
        item.style.transition = 'none';
        item.style.transform = '';
      });
      if (typeof targetIdx === 'number' && targetIdx !== draggedIdx) {
        if (targetIdx >= items.length - 1) {
          form.appendChild(draggedItem);
        } else {
          const ref = items[targetIdx + (targetIdx > draggedIdx ? 1 : 0)];
          form.insertBefore(draggedItem, ref);
        }
        const [moved] = rulesInMemory.splice(draggedIdx, 1);
        rulesInMemory.splice(targetIdx, 0, moved);
        syncKeyIndexMap();
        isDirty = true;
      }
      draggedItem.classList.add('ucm-fade-in');
      draggedItem.addEventListener('animationend', (e) => {
        e.currentTarget.classList.remove('ucm-fade-in');
      }, { once: true });
      form.offsetHeight; 
      items.forEach(item => item.style.transition = '');
      draggedItem = null;
      delete form._dragConfig;
      delete form._lastHoverIdx;
    });
  }

  async function updateDialogDOM() {
    if (!mainDialog) createMainDialog();
    const form = mainDialog._form;
    let grid = form.querySelector('.ucm-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'ucm-grid';
      form.insertBefore(grid, mainDialog._btnRow);
      setupDragAndDrop(grid);
    }
    const visibleRules = filterType ? rulesInMemory.filter(r => r.rule.type === filterType) : rulesInMemory;
    const computedStyle = window.getComputedStyle(grid);
    const targetCols = parseInt(computedStyle.getPropertyValue('--ucm-grid-columns')) || 1;
    const rowCount = Math.ceil(visibleRules.length / targetCols);
    grid.style.setProperty('--dynamic-rows', rowCount || 1);
    const newKeys = new Set(visibleRules.map(item => item.key));
    for (const oldKey of [...itemElements.keys()]) {
      if (!newKeys.has(oldKey)) {
        itemElements.get(oldKey).container.remove();
        itemElements.delete(oldKey);
      }
    }
    visibleRules.forEach(({ key, rule }, index) => {
      let item = itemElements.get(key) || createItemElement(key, rule);
      if (!itemElements.has(key)) itemElements.set(key, item);
      item.labelEl.setAttribute('draggable', filterType ? 'false' : 'true');
      if (item.checkbox.checked !== !!rule.enabled) item.checkbox.checked = !!rule.enabled;
      const newLabel = `[${rule.type.toUpperCase()}] ${rule.label}`;
      if (item.labelEl.textContent !== newLabel) item.labelEl.textContent = newLabel;
      item.container._sortIndex = index;
      grid.appendChild(item.container);
    });
    if (form.lastChild !== mainDialog._btnRow) {
      form.appendChild(mainDialog._btnRow);
    }
  }

  function createMainDialog() {
    mainDialog = createDialog('ucm-main-dialog', dialog => {
      const form = document.createElement('form');
      form.className = 'ucm-form';
      dialog.appendChild(form);
      form.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        const itemRow = target.closest('.ucm-item');
        if (!itemRow) return;
        const key = itemRow.dataset.key;
        if (target.classList.contains('ucm-edit-btn')) {
          showEditDialog(key);
        } else if (target.classList.contains('ucm-delete-btn')) {
          showDeleteConfirm(key);
        }
      });
      form.addEventListener('change', async (e) => {
        const target = e.target;
        if (target.type !== 'checkbox' || !target.closest('.ucm-item')) return;
        const itemRow = target.closest('.ucm-item');
        const key = itemRow.dataset.key;
        const index = findIndexByKey(key);
        const rule = rulesInMemory[index].rule;
        const wasEnabled = rule.enabled;
        rule.enabled = target.checked;
        if (wasEnabled && !target.checked && rule.type === 'js' && !scriptMap.has(key)) {
          await showConfirmDialog(_('tip_restart_js'), null, true);
        }
        await applyUserChrome({ [key]: rule });
        await updateDialogDOM();
      });
      const addBtn = createButton(_('btn_add'), () => showEditDialog(null));
      const exportBtn = createButton(_('btn_export'), exportRules);
      const importBtn = createButton(_('btn_import'), importRules);
      const backupBtn = createButton(_('btn_backup'), backupRules);
      const openDirBtn = createButton(_('btn_folder'), () => chromeDir.launch());
      const restartBtn = createButton(_('btn_restart'), async () => {
        await showConfirmDialog(_('confirm_restart'), restartBrowser);
      });
      const exitBtn = createButton(_('btn_exit'), () => dialog.close());
      const filterGroup = document.createElement('div');
      filterGroup.className = 'ucm-type-group';
      filterGroup.style.marginLeft = 'auto';
      const filterOptions = [
        { id: 'filter-css', label: 'CSS', value: 'css' },
        { id: 'filter-js', label: 'JS', value: 'js' }
      ];
      filterOptions.forEach(({ id, label, value }) => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.checked = filterType === value;
        const lbl = document.createElement('label');
        lbl.appendChild(checkbox);
        lbl.appendChild(document.createTextNode(`${label}`));
        lbl.htmlFor = id;
        checkbox.addEventListener('change', () => {
          filterGroup.querySelectorAll('input[type=checkbox]').forEach(cb => {
            if (cb !== checkbox) cb.checked = false;
          });
          filterType = checkbox.checked ? value : null;
          updateDialogDOM();
        });
        filterGroup.appendChild(lbl);
      });
      const btnRow = createButtonRow([addBtn, exportBtn, importBtn, backupBtn, openDirBtn, restartBtn, exitBtn, filterGroup]);
      form.appendChild(btnRow);
      dialog._btnRow = btnRow;
      dialog._form = form;
    });
    mainDialog.addEventListener('close', async () => {
      await saveIfNeeded();
    });
  }

  async function showMainDialog() {
    await updateDialogDOM();
    mainDialog.showModal();
  }

  async function showEditDialog(key) {
    const index = findIndexByKey(key);
    let isNew = index === -1;
    if (isNew) key = `ucm_${Date.now()}`;
    const existingRule = isNew ? null : rulesInMemory[index].rule;
    const { type: defaultType = 'css', enabled: oldEnabled = true, label: oldLabel = '', code: oldCode = '' } = existingRule || {};
    editDialog = createDialog('ucm-edit-dialog', (dialog) => {
      const container = document.createElement('div');
      container.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
      const typeGroup = document.createElement('div');
      typeGroup.className = 'ucm-type-group';
      const radioTypes = [
        { value: 'css', id: 'type-css', label: 'CSS' },
        { value: 'js', id: 'type-js', label: 'JS' }
      ];
      let currentType = defaultType;
      radioTypes.forEach(({ value, id, label }) => {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'type';
        radio.value = value;
        radio.id = id;
        radio.checked = value === defaultType;
        radio.disabled = !isNew;
        if (isNew) radio.addEventListener('change', () => currentType = value);
        const lbl = document.createElement('label');
        lbl.htmlFor = id;
        lbl.textContent = label;
        typeGroup.append(radio, lbl);
      });
      container.appendChild(typeGroup);
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = oldLabel;
      labelInput.placeholder = _('placeholder_name');
      container.appendChild(labelInput);
      const textarea = document.createElement('textarea');
      textarea.value = oldCode;
      container.appendChild(textarea);
      const okBtn = createButton(_('btn_ok'), async () => {
        const newLabel = labelInput.value.trim();
        if (!newLabel) return;
        const newCode = textarea.value;
        const newType = isNew ? currentType : defaultType;
        const newRule = { type: newType, label: newLabel, enabled: oldEnabled, code: newCode };
        if (newLabel === oldLabel && newCode === oldCode) {
          dialog.close();
          return;
        }
        if (isNew) {
          rulesInMemory.push({ key, rule: newRule });
          syncKeyIndexMap();
        } else {
          rulesInMemory[index].rule = newRule;
        }
        isDirty = true;
        if (newCode !== oldCode) await applyUserChrome({ [key]: newRule });
        await updateDialogDOM();
        dialog.close();
      });
      const cancelBtn = createButton(_('btn_cancel'), () => dialog.close());
      container.appendChild(createButtonRow([okBtn, cancelBtn]));
      dialog.appendChild(container);
    });
    editDialog.addEventListener('close', () => editDialog.remove(), { once: true });
    editDialog.showModal();
  }

  function showConfirmDialog(message, onConfirm, onlyOk = false) {
    return new Promise(resolve => {
      const dialog = createDialog('ucm-confirm-dialog', dlg => {
        const msg = document.createElement('div');
        msg.textContent = message;
        msg.style.marginBottom = '10px';
        dlg.appendChild(msg);
        const okBtn = createButton(_('btn_ok'), async () => {
          if (typeof onConfirm === 'function') await onConfirm();
          dlg.close();
          resolve(true);
        });
        if (onlyOk) {
          dlg.appendChild(okBtn);
        } else {
          const cancelBtn = createButton(_('btn_cancel'), () => {
            dlg.close();
            resolve(false);
          });
          dlg.appendChild(createButtonRow([okBtn, cancelBtn]));
        }
      });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.showModal();
    });
  }

  async function showDeleteConfirm(key) {
    const index = findIndexByKey(key);
    if (index === -1) return;
    await showConfirmDialog(
      _('confirm_delete', rulesInMemory[index].rule.type.toUpperCase(), rulesInMemory[index].rule.label),
      async () => {
        const rule = rulesInMemory[index].rule;
        cleanupRule(key, rule.type);
        await IOUtils.remove(PathUtils.join(rulesDeps, key), { recursive: true }).catch(() => {});
        await IOUtils.remove(rulesDeps).catch(() => {});
        rulesInMemory.splice(index, 1);
        syncKeyIndexMap();
        isDirty = true;
        await updateDialogDOM();
      }
    );
  }

  function addMenuItemWhenPopupReady() {
    const popup = document.getElementById('appMenu-popup');
    if (!popup) return;
    popup.addEventListener('popupshowing', () => {
      if (!document.getElementById('appMenu-ucm-button')) {
        const btn = document.createXULElement('toolbarbutton');
        btn.id = 'appMenu-ucm-button';
        btn.className = 'subviewbutton';
        btn.setAttribute('label', _('menu_label'));
        btn.addEventListener('command', e => {
          e.stopPropagation();
          popup.hidePopup();
          showMainDialog();
        });
        const settingsBtn = document.getElementById('appMenu-settings-button');
        settingsBtn?.insertAdjacentElement('afterend', btn);
      }
    }, { once: true });
  }

  async function init() {
    if (!await IOUtils.exists(chromeDir.path)) await IOUtils.makeDirectory(chromeDir.path);
    document.body.appendChild(document.createElement('dialog')).id = 'ucm-main-dialog';
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(ucr, chromeDirURI);
    rulesInMemory = await getRulesFromFile();
    syncKeyIndexMap();
    originalSnapshot = createSnapshot(rulesInMemory);
    const allRules = { '__BASE_CSS__': { type: 'css', enabled: true, label: 'Base CSS', code: baseCSS }, ...getRulesObj() };
    await applyUserChrome(allRules);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addMenuItemWhenPopupReady, { once: true });
    } else {
      addMenuItemWhenPopupReady();
    }
  }

  init();
  window.showUserChromeRules = showMainDialog;

  window.addEventListener('unload', () => {
    for (const key of styleMap.keys()) cleanupRule(key, 'css');
    for (const key of scriptMap.keys()) cleanupRule(key, 'js');
    sandboxMap.clear();
    itemElements.clear();
    mainDialog?.remove();
    document.getElementById('appMenu-ucm-button')?.remove();
  }, { once: true });
}

try {
  if (typeof window === 'undefined') {
    Services.obs.addObserver(function observer(subject) {
      Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      Cu.importGlobalProperties(['IOUtils', 'PathUtils']);
      runUserChromeRules(subject);
    }, "browser-delayed-startup-finished");
  } else {
    runUserChromeRules();
  }
} catch (e) { Cu.reportError(e); }
