(function () {
  'use strict';

  const itemElements = new Map();
  const sandboxMap = new Map();
  const scriptMap = new Map();
  const styleMap = new Map();
  const keyToIndexMap = new Map();
  const styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
  const chromeDirURI = Services.io.newFileURI(chromeDir);

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
    .ucm-item {
      display: flex; align-items: center; gap: 8px; user-select: none;
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }
    .ucm-item.ucm-dragging { opacity: 0; pointer-events: none; }
    .ucm-item.ucm-fade-in { animation: fadeIn 0.5s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .ucm-label { flex: 1; }
    .ucm-drag-handle { cursor: grab; }
    .ucm-edit-btn, .ucm-delete-btn { margin-left: 4px; }
    #ucm-edit-dialog input[type=text], #ucm-edit-dialog textarea { box-sizing: border-box; font-family: monospace; }
    #ucm-edit-dialog textarea { min-height: 200px; max-height: 80vh; min-width: 400px; max-width: 100%; }
  `;

  function createSnapshot(rules) {
    const snapshotData = rules.map(item => ({
      key: item.key,
      enabled: !!item.rule.enabled
    }));
    return JSON.stringify(snapshotData);
  }

  function getStorageFile() {
    const file = chromeDir.clone();
    file.append("UserChromeRules.json");
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
    } catch (e) {
      console.error("读取规则文件失败:", e);
    }
    return [];
  }

  async function saveRulesToFile() {
    try {
      const file = getStorageFile();
      await IOUtils.writeUTF8(file.path, JSON.stringify(getRulesObj(), null, 2));
    } catch (e) {
      console.error("保存规则文件失败:", e);
    }
  }

  async function exportRules() {
    const dir = await pickFileOrFolder("选择导出文件夹", 'folder');
    if (!dir) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await IOUtils.writeUTF8(PathUtils.join(dir, `UserChromeRules_${timestamp}.json`), JSON.stringify(getRulesObj(), null, 2));
    await Promise.all(rulesInMemory.map(({key, rule}) => {
      const safeName = rule.label.replace(/[<>:"/\\|?*]/g, '_');
      const ext = rule.type;
      const codePath = PathUtils.join(dir, `${safeName}_${timestamp}.${ext}`);
      return IOUtils.writeUTF8(codePath, rule.code);
    }));
  }

  async function importRules() {
    const files = await pickFileOrFolder("选择文件", 'files', ['.json', '.js', '.css']);
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
          const ext = file.leafName.endsWith('.js') ? 'js' : 'css';
          const label = file.leafName.replace(/\.(js|css)$/, '');
          const key = `ucm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          newRules = [{key, rule: {type: ext, label, enabled: true, code: content}}];
        }
        for (const {key, rule} of newRules) {
          if (findIndexByKey(key) === -1) {
            rulesInMemory.push({key, rule});
            await applyUserChrome({ [key]: rule });
            importedCount++;
          }
        }
      } catch (e) {
        console.error(`导入文件 ${file.leafName} 失败:`, e);
      }
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
          fp.appendFilter('文件类型', accept.map(ext => `*${ext}`).join('; '));
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
    const backupFile = chromeDir.clone();
    backupFile.append("UserChromeRules.bak");
    const performBackup = async () => {
      await IOUtils.writeUTF8(backupFile.path, JSON.stringify(getRulesObj(), null, 2));
      await showConfirmDialog("备份成功！", null, true);
    };
    const backupExists = await IOUtils.exists(backupFile.path);
    if (backupExists) {
      await showConfirmDialog("备份文件已存在，是否覆盖？", performBackup);
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
        try { scriptMap.get(key)?.cleanup?.(); } catch(e) { console.error(e); }
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

  function resolveUrl(url, quote, match) {
    if (/^(data:|https?:|file:|chrome:|resource:)/.test(url)) {
      return `url(${quote}${url}${quote})`;
    }
    try {
      const absoluteURI = Services.io.newURI(url, null, chromeDirURI);
      return `url(${quote}${absoluteURI.spec}${quote})`;
    } catch (e) {
      console.error(`无法解析 URL: ${url}`, e);
      return match;
    }
  }

  async function applyUserChrome(targetRules = getRulesObj()) {
    for (const [key, rule] of Object.entries(targetRules)) {
      cleanupRule(key, rule?.type);
      if (!rule?.enabled) continue;
      if (rule.type === 'js') {
        try {
          const sandbox = Cu.Sandbox(window, {
            sandboxPrototype: window,
            wantXrays: false,
            sandboxName: `UserChrome Rule: ${rule.label}`
          });
          sandboxMap.set(key, sandbox);
          const result = Cu.evalInSandbox(rule.code, sandbox);
          let cleanupFn = null;
          if (typeof result === 'function') {
            cleanupFn = result;
          } else if (result && typeof result === 'object') {
            for (const prop in result) {
              if (typeof result[prop] === 'function') {
                cleanupFn = result[prop];
                break;
              }
            }
          }
          if (cleanupFn) {
            scriptMap.set(key, { cleanup: cleanupFn });
          }
        } catch (e) {
          console.error(rule.label, e);
        }
      } else if (rule.type === 'css') {
        let cssCode = rule.code;
        cssCode = cssCode.replace(/@import\s+(?:url\()?(['"]?)([^'")]+)\1\)?/gi, (match, quote, url) => {
          return `@import ${resolveUrl(url, quote, match)}`;
        });
        cssCode = cssCode.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, url) => {
          return resolveUrl(url, quote, match);
        });
        const uri = Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(cssCode)}`);
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
    const editBtn = createButton('修改', null);
    editBtn.className = 'ucm-edit-btn';
    const deleteBtn = createButton('删除', null);
    deleteBtn.className = 'ucm-delete-btn';
    div.append(checkbox, labelEl, editBtn, deleteBtn);
    return { container: div, checkbox, labelEl };
  }

  function setupDragAndDrop(form) {
    if (form.hasAttribute('data-drag-setup')) return;
    form.setAttribute('data-drag-setup', 'true');
    let draggedKey = null;
    let draggedIndex = -1;
    let shiftAmount = 0;
    let cachedItems = [];
    let lastInsertIndex = -1;
    let formRect = null;
    let itemCenters = [];
    let rafId = null;
    let itemsToShift = new Set();
    let isDragging = false;
    form.addEventListener('dragstart', (e) => {
      const target = e.target.closest('.ucm-item');
      if (!target) return;
      target.classList.add('ucm-dragging');
      draggedKey = target.dataset.key;
      draggedIndex = target._sortIndex;
      shiftAmount = target.offsetHeight + 12;
      e.dataTransfer.effectAllowed = 'move';
      cachedItems = Array.from(form.querySelectorAll('.ucm-item:not(.ucm-dragging)'));
      formRect = window.windowUtils.getBoundsWithoutFlushing(form);
      itemCenters = cachedItems.map(item => {
        const itemRect = window.windowUtils.getBoundsWithoutFlushing(item);
        return (itemRect.top + itemRect.height / 2) - formRect.top;
      });
      cachedItems.forEach(item => {
        item.style.willChange = 'transform';
      });
      isDragging = true;
    });
    form.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggedKey || draggedIndex === -1 || !formRect) return;
      if (rafId !== null) return;
      const mouseY = e.clientY - formRect.top;
      let low = 0;
      let high = cachedItems.length - 1;
      let insertIndex = cachedItems.length;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        const item = cachedItems[mid];
        const itemCenter = itemCenters[mid];
        const itemIndex = item._sortIndex;
        let visualOffset = 0;
        if (lastInsertIndex !== -1) {
          if (draggedIndex < lastInsertIndex) {
            if (itemIndex > draggedIndex && itemIndex <= lastInsertIndex) {
              visualOffset = -shiftAmount;
            }
          } else if (draggedIndex > lastInsertIndex) {
            if (itemIndex >= lastInsertIndex && itemIndex < draggedIndex) {
              visualOffset = shiftAmount;
            }
          }
        }
        const effectiveCenter = itemCenter + visualOffset;
        if (mouseY < effectiveCenter) {
          insertIndex = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      if (insertIndex === lastInsertIndex) return;
      lastInsertIndex = insertIndex;
      itemsToShift.clear();
      if (draggedIndex < insertIndex) {
        for (let i = draggedIndex + 1; i <= insertIndex; i++) {
          itemsToShift.add(i);
        }
      } else if (draggedIndex > insertIndex) {
        for (let i = insertIndex; i < draggedIndex; i++) {
          itemsToShift.add(i);
        }
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!isDragging) return;
        cachedItems.forEach(item => {
          const itemIndex = item._sortIndex;
          const shouldShift = itemsToShift.has(itemIndex);
          const translateY = shouldShift ?
            (draggedIndex < insertIndex ? -shiftAmount : shiftAmount) : 0;
          item.style.transform = `translateY(${translateY}px)`;
        });
      });
    });
    form.addEventListener('dragend', async (e) => {
      if (!draggedKey) return;
      const draggedElement = itemElements.get(draggedKey).container;
      const itemsToReset = Array.from(form.querySelectorAll('.ucm-item'));
      itemsToReset.forEach(item => {
        item.style.transition = 'none';
        item.classList.remove('ucm-dragging');
        item.style.transform = '';
        item.style.willChange = '';
      });
      draggedElement.offsetHeight;
      itemsToReset.forEach(item => {
        item.style.transition = '';
      });
      isDragging = false;
      requestAnimationFrame(async () => {
        let rulesInsertIndex;
        let insertIndex = lastInsertIndex;
        if (insertIndex < cachedItems.length) {
          rulesInsertIndex = cachedItems[insertIndex]._sortIndex;
        } else {
          rulesInsertIndex = rulesInMemory.length;
        }
        if (draggedIndex !== -1 && draggedIndex < rulesInsertIndex) {
          rulesInsertIndex--;
        }
        if (draggedIndex !== -1 && draggedIndex !== rulesInsertIndex) {
          const draggedItem = rulesInMemory.splice(draggedIndex, 1)[0];
          rulesInMemory.splice(rulesInsertIndex, 0, draggedItem);
          syncKeyIndexMap();
          let targetElement = mainDialog._btnRow;
          const nextItemIndexInNewArray = rulesInsertIndex + 1;
          if (nextItemIndexInNewArray < rulesInMemory.length) {
            const targetKey = rulesInMemory[nextItemIndexInNewArray].key;
            const nextItem = itemElements.get(targetKey);
            if (nextItem) {
              targetElement = nextItem.container;
            }
          }
          form.insertBefore(draggedElement, targetElement);
          if (draggedElement) {
            draggedElement.classList.add('ucm-fade-in');
            setTimeout(() => {
              draggedElement.classList.remove('ucm-fade-in');
            }, 500);
          }
          rulesInMemory.forEach((item, idx) => {
            const el = itemElements.get(item.key);
            if (el) {
              el.container._sortIndex = idx;
            }
          });
        }
        draggedKey = null;
        draggedIndex = -1;
        cachedItems = [];
        lastInsertIndex = -1;
        formRect = null;
        itemCenters = [];
        rafId = null;
      });
    });
  }

  async function updateDialogDOM() {
    if (!mainDialog) createMainDialog();
    const form = mainDialog._form;
    const newKeys = new Set(rulesInMemory.map(item => item.key));
    for (const oldKey of [...itemElements.keys()]) {
      if (!newKeys.has(oldKey)) {
        itemElements.get(oldKey).container.remove();
        itemElements.delete(oldKey);
      }
    }
    let previousElement = null;
    rulesInMemory.forEach(({ key, rule }, index) => {
      let item = itemElements.get(key) || createItemElement(key, rule);
      if (!itemElements.has(key)) itemElements.set(key, item);
      item.container.style.display = filterType && rule.type !== filterType ? 'none' : '';
      item.labelEl.setAttribute('draggable', filterType ? 'false' : 'true');
      if (item.checkbox.checked !== !!rule.enabled) item.checkbox.checked = !!rule.enabled;
      const newLabel = `[${rule.type.toUpperCase()}] ${rule.label}`;
      if (item.labelEl.textContent !== newLabel) item.labelEl.textContent = newLabel;
      item.container._sortIndex = index;
      const targetPosition = previousElement ? previousElement.nextSibling : form.firstChild;
      if (targetPosition !== item.container) {
        form.insertBefore(item.container, targetPosition);
      }
      previousElement = item.container;
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
      setupDragAndDrop(form);
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
          await showConfirmDialog("此规则需要重启浏览器才能完全禁用。", null, true);
        }
        await applyUserChrome({ [key]: rule });
      });
      const addBtn = createButton('新增', () => showEditDialog(null));
      const exportBtn = createButton('导出', exportRules);
      const importBtn = createButton('导入', importRules);
      const backupBtn = createButton('备份', backupRules);
      const openDirBtn = createButton('目录', () => chromeDir.launch());
      const restartBtn = createButton('重启', async () => {
        await showConfirmDialog('确定要重启 Firefox 吗？', restartBrowser);
      });
      const exitBtn = createButton('退出', () => dialog.close());
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
      labelInput.placeholder = '规则名称';
      container.appendChild(labelInput);
      const textarea = document.createElement('textarea');
      textarea.value = oldCode;
      container.appendChild(textarea);
      const okBtn = createButton('确定', async () => {
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
      const cancelBtn = createButton('取消', () => dialog.close());
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
        const okBtn = createButton('确定', async () => {
          if (typeof onConfirm === 'function') await onConfirm();
          dlg.close();
          resolve(true);
        });
        if (onlyOk) {
          dlg.appendChild(okBtn);
        } else {
          const cancelBtn = createButton('取消', () => {
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
      `确定删除 ${rulesInMemory[index].rule.type.toUpperCase()} 项 "${rulesInMemory[index].rule.label}" 吗？`,
      async () => {
        const rule = rulesInMemory[index].rule;
        cleanupRule(key, rule.type);
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
        btn.setAttribute('label', 'UC 管理器');
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
})();
