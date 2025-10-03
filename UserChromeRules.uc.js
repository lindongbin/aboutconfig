(function () {
  'use strict';

  const itemElements = new Map();
  const sandboxMap = new Map();
  const scriptMap = new Map();
  const styleMap = new Map();
  const styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

  let mainDialog, editDialog;
  let rulesInMemory = [];
  let originalRules = null;

  const baseCSS = `
    #ucm-main-dialog, #ucm-edit-dialog, #ucm-confirm-dialog {
      padding: 15px; border: 1px solid var(--arrowpanel-border-color);
      border-radius: 4px; background: var(--arrowpanel-background);
      color: var(--arrowpanel-color);
      min-width: 400px; max-width: 600px; z-index: 10000;
      font: message-box; font-size: 14px; line-height: 14px;
      box-shadow: 0 1px 4px color-mix(in srgb, currentColor 20%, transparent);
    }
    #ucm-main-dialog::backdrop, #ucm-edit-dialog::backdrop, #ucm-confirm-dialog::backdrop {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .ucm-form { display: flex; flex-direction: column; gap: 12px; }
    .ucm-item { 
      display: flex; align-items: center; gap: 8px; cursor: grab;
      transition: transform 0.2s ease;
    }
    .ucm-item:active { cursor: grabbing; }
    .ucm-item.ucm-dragging {
      transform: scale(0.95);
      opacity: 0.8;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    .ucm-item.ucm-drag-over { 
      transform: scale(1.02) translateY(-2px);
      border: 2px dashed var(--focus-outline-color);
      background: rgba(0,123,255,0.1);
    }
    .ucm-item.ucm-insert-after { 
      transform: translateY(10px);
      transition: transform 0.3s ease; 
    }
    .ucm-drag-shadow {
      position: absolute !important;
      pointer-events: none;
      opacity: 0.5;
      z-index: 10001;
      transform: scale(0.95);
    }
    .ucm-label { flex: 1; cursor: pointer; }
    .ucm-edit-btn, .ucm-delete-btn { margin-left: 4px; }
    #ucm-edit-dialog input[type=text], #ucm-edit-dialog textarea { width: 100%; box-sizing: border-box; font-family: monospace; }
    #ucm-edit-dialog textarea { min-height: 200px; }
    .ucm-add-btn { margin-top: 10px; align-self: flex-start; }
    .ucm-type-group { display: flex; gap: 10px; }
    .ucm-type-group label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  `;

  function getStorageFile() {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    const profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
    file.initWithPath(profileDir.path);
    file.append("chrome");
    if (!file.exists()) file.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    file.append("UserChromeRules.json");
    return file;
  }

  function toObject(rulesArray) {
    const obj = {};
    rulesArray.forEach(({key, rule}) => { obj[key] = rule; });
    return obj;
  }
  function toArray(rulesObj) {
    return Object.entries(rulesObj).map(([key, rule]) => ({key, rule}));
  }

  async function getRulesFromFile() {
    try {
      const file = getStorageFile();
      if (file.exists()) {
        const data = await IOUtils.readUTF8(file.path);
        return toArray(JSON.parse(data));
      }
    } catch (e) {
      console.error("读取规则文件失败:", e);
    }
    return [];
  }

  async function saveRulesToFile(rules) {
    try {
      const file = getStorageFile();
      await IOUtils.writeUTF8(file.path, JSON.stringify(toObject(rules), null, 2));
    } catch (e) {
      console.error("保存规则文件失败:", e);
    }
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

  async function applyUserChrome(rules) {
    const target = rules || toObject(rulesInMemory);
    for (const [key, rule] of Object.entries(target)) {
      cleanupRule(key, rule.type);
      if (!rule || !rule.enabled) continue;
      if (rule.type === 'js') {
        try {
          const sandbox = Cu.Sandbox(window, {
            sandboxPrototype: window,
            wantXrays: false,
            sandboxName: `UserChrome Rule: ${rule.label}`
          });
          sandboxMap.set(key, sandbox);
          const result = Cu.evalInSandbox(rule.code, sandbox);
          if (result?.cleanup && typeof result.cleanup === "function") {
            scriptMap.set(key, result);
          }
        } catch (e) {
          console.error(rule.label, e);
        }
      } else if (rule.type === 'css') {
        const uri = Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(rule.code)}`);
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
    while (dialog.firstChild) dialog.firstChild.remove();
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
    row.style.display = 'flex';
    row.style.gap = '6px';
    buttons.forEach(b => row.appendChild(b));
    return row;
  }

  function findIndexByKey(key) {
    return rulesInMemory.findIndex(item => item.key === key);
  }

  function createItemElement(key, rule) {
    const div = document.createElement('div');
    div.className = 'ucm-item';
    div.setAttribute('draggable', 'true');
    div.dataset.key = key;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled;
    const labelEl = document.createElement('label');
    labelEl.className = 'ucm-label';
    labelEl.textContent = `[${rule.type.toUpperCase()}] ${rule.label}`;
    const editBtn = createButton('修改', () => showEditDialog(key));
    editBtn.className = 'ucm-edit-btn';
    const deleteBtn = createButton('删除', () => showDeleteConfirm(key));
    deleteBtn.className = 'ucm-delete-btn';

    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', key);
      div.classList.add('ucm-dragging');
      const shadow = div.cloneNode(true);
      shadow.classList.add('ucm-drag-shadow');
      document.body.appendChild(shadow);
      e.dataTransfer.setDragImage(shadow, e.offsetX || 0, e.offsetY || 0);
    });
    div.addEventListener('dragend', (e) => {
      div.classList.remove('ucm-dragging');
      document.querySelectorAll('.ucm-drag-shadow').forEach(el => el.remove());
    });

    checkbox.addEventListener('change', async () => {
      const index = findIndexByKey(key);
      if (index !== -1) {
        rulesInMemory[index].rule.enabled = checkbox.checked;
        await applyUserChrome({ [key]: rulesInMemory[index].rule });
      }
    });

    div.append(checkbox, labelEl, editBtn, deleteBtn);
    return { container: div, checkbox, labelEl };
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

    const existingItems = form.querySelectorAll('.ucm-item');
    existingItems.forEach(item => item.remove());

    const fragment = document.createDocumentFragment();
    for (const {key, rule} of rulesInMemory) {
      if (itemElements.has(key)) {
        const item = itemElements.get(key);
        if (item.checkbox.checked !== !!rule.enabled) item.checkbox.checked = !!rule.enabled;
        const newLabel = `[${rule.type.toUpperCase()}] ${rule.label}`;
        if (item.labelEl.textContent !== newLabel) item.labelEl.textContent = newLabel;
        fragment.appendChild(item.container);
      } else {
        const item = createItemElement(key, rule);
        itemElements.set(key, item);
        fragment.appendChild(item.container);
      }
    }
    form.insertBefore(fragment, mainDialog._btnRow);

    if (!form.hasAttribute('data-drag-setup')) {
      form.setAttribute('data-drag-setup', 'true');
      form.addEventListener('dragover', (e) => {
        e.preventDefault();
        const target = e.target.closest('.ucm-item');
        if (target) {
          target.classList.add('ucm-drag-over');
        }
      });
      form.addEventListener('dragleave', (e) => {
        const target = e.target.closest('.ucm-item');
        if (target) {
          target.classList.remove('ucm-drag-over');
        }
      });
      form.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedKey = e.dataTransfer.getData('text/plain');
        const targetKey = e.target.closest('.ucm-item')?.dataset.key;
        if (draggedKey && targetKey && draggedKey !== targetKey) {
          const draggedIndex = findIndexByKey(draggedKey);
          let targetIndex = findIndexByKey(targetKey);
          if (draggedIndex !== -1 && targetIndex !== -1) {
            const draggedItem = rulesInMemory.splice(draggedIndex, 1)[0];
            if (draggedIndex < targetIndex) {
              targetIndex--;
            }
            rulesInMemory.splice(targetIndex, 0, draggedItem);
            await updateDialogDOM();
            requestAnimationFrame(() => {
              const newEl = form.querySelector(`[data-key="${draggedKey}"]`);
              if (newEl) {
                newEl.classList.add('ucm-insert-after');
                setTimeout(() => {
                  newEl.classList.remove('ucm-insert-after');
                }, 150);
              }
            });
          }
        }
        document.querySelectorAll('.ucm-drag-over').forEach(el => el.classList.remove('ucm-drag-over'));
      });
    }
  }

  function createMainDialog() {
    mainDialog = createDialog('ucm-main-dialog', dialog => {
      const form = document.createElement('form');
      form.className = 'ucm-form';
      dialog.appendChild(form);
      const addBtn = createButton('新增', () => showEditDialog(null));
      const exportBtn = createButton('导出', exportRules);
      const importBtn = createButton('导入', importRules);
      const backupBtn = createButton('备份', backupRules);
      const openDirBtn = createButton('目录', openChromeDirectory);
      const exitBtn = createButton('退出', () => dialog.close());
      const btnRow = createButtonRow([addBtn, exportBtn, importBtn, backupBtn, openDirBtn, exitBtn]);
      form.appendChild(btnRow);
      dialog._btnRow = btnRow;
      dialog._form = form;
    });
    mainDialog.addEventListener('close', async () => {
      if (JSON.stringify(toObject(rulesInMemory)) !== originalRules) {
        await saveRulesToFile(rulesInMemory);
        originalRules = JSON.stringify(toObject(rulesInMemory));
      }
    });
  }

  async function showMainDialog() {
    await updateDialogDOM();
    mainDialog.showModal();
  }

  async function showEditDialog(key) {
    if (!key) key = `ucm_${Date.now()}`;
    const index = findIndexByKey(key);
    const existingRule = index !== -1 ? rulesInMemory[index].rule : null;
    const isNew = !existingRule;
    const defaultType = isNew ? 'css' : existingRule.type;
    const oldEnabled = existingRule?.enabled ?? true;
    const oldLabel = existingRule?.label || '';
    const oldCode = existingRule?.code || '';
    editDialog = createDialog('ucm-edit-dialog', dialog => {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '10px';
      const typeGroup = document.createElement('div');
      typeGroup.className = 'ucm-type-group';
      const cssRadio = document.createElement('input');
      cssRadio.type = 'radio';
      cssRadio.name = 'type';
      cssRadio.value = 'css';
      cssRadio.id = 'type-css';
      cssRadio.checked = defaultType === 'css';
      const cssLabel = document.createElement('label');
      cssLabel.htmlFor = 'type-css';
      cssLabel.textContent = 'CSS';
      typeGroup.append(cssRadio, cssLabel);
      const jsRadio = document.createElement('input');
      jsRadio.type = 'radio';
      jsRadio.name = 'type';
      jsRadio.value = 'js';
      jsRadio.id = 'type-js';
      jsRadio.checked = defaultType === 'js';
      const jsLabel = document.createElement('label');
      jsLabel.htmlFor = 'type-js';
      jsLabel.textContent = 'JS';
      typeGroup.append(jsRadio, jsLabel);
      if (!isNew) jsRadio.disabled = cssRadio.disabled = true;
      container.appendChild(typeGroup);
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = existingRule?.label || '';
      labelInput.placeholder = '规则名称';
      container.appendChild(labelInput);
      const textarea = document.createElement('textarea');
      textarea.value = existingRule?.code || '';
      container.appendChild(textarea);
      const okBtn = createButton('确定', async () => {
        const newLabel = labelInput.value.trim();
        if (!newLabel) return;
        const newCode = textarea.value;
        const type = isNew ? (jsRadio.checked ? 'js' : 'css') : existingRule.type;
        if (newLabel === oldLabel && newCode === oldCode) {
          dialog.close();
          return;
        }
        const newRule = { type, label: newLabel, enabled: oldEnabled, code: newCode };
        if (isNew) {
          rulesInMemory.push({key, rule: newRule});
        } else {
          rulesInMemory[index].rule = newRule;
        }
        if (newCode !== oldCode) {
          await applyUserChrome({ [key]: newRule });
        }
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
        itemElements.delete(key);
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

  async function exportRules() {
    const dir = await pickFolder("选择导出文件夹");
    if (!dir) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await IOUtils.writeUTF8(PathUtils.join(dir, `UserChromeRules_${timestamp}.json`), JSON.stringify(toObject(rulesInMemory), null, 2));
    await Promise.all(rulesInMemory.map(({key, rule}) => {
      const safeName = rule.label.replace(/[<>:"/\\|?*]/g, '_');
      const ext = rule.type;
      const codePath = PathUtils.join(dir, `${safeName}_${timestamp}.${ext}`);
      return IOUtils.writeUTF8(codePath, rule.code);
    }));
  }

  async function importRules() {
    const files = await pickFiles(['.json', '.js', '.css']);
    if (!files?.length) return;
    for (const file of files) {
      try {
        const content = await file.text();
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          for (const [k, value] of Object.entries(data)) {
            if (value && typeof value.type === 'string' && ['js', 'css'].includes(value.type) &&
                typeof value.label === 'string' && typeof value.code === 'string' && typeof value.enabled === 'boolean') {
              const existingIndex = findIndexByKey(k);
              if (existingIndex === -1) {
                rulesInMemory.push({key: k, rule: value});
                await applyUserChrome({ [k]: value });
              }
            }
          }
        } else if (file.name.endsWith('.js') || file.name.endsWith('.css')) {
          const ext = file.name.endsWith('.js') ? '.js' : '.css';
          const label = file.name.replace(ext, '');
          const key = `ucm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const type = ext === '.js' ? 'js' : 'css';
          const newRule = { type, label, enabled: true, code: content };
          rulesInMemory.push({key, rule: newRule});
          await applyUserChrome({ [key]: newRule });
        }
      } catch (e) {
        console.error(`导入文件 ${file.name} 失败:`, e);
      }
    }
    await updateDialogDOM();
  }

  function pickFolder(title) {
    return new Promise(resolve => {
      const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
      fp.init(window.browsingContext, title, Components.interfaces.nsIFilePicker.modeGetFolder);
      fp.open(result => resolve(result === Components.interfaces.nsIFilePicker.returnOK ? fp.file.path : null));
    });
  }

  function pickFiles(accept = []) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = accept.join(',');
      input.addEventListener('change', e => resolve(Array.from(e.target.files)), { once: true });
      input.click();
    });
  }

  async function backupRules() {
    const file = getStorageFile();
    const backupFile = file.parent.clone();
    backupFile.append("UserChromeRules.bak");
    const performBackup = async () => {
      await IOUtils.writeUTF8(backupFile.path, JSON.stringify(toObject(rulesInMemory), null, 2));
      await showConfirmDialog("备份成功！", null, true);
    };
    if (backupFile.exists()) {
      await showConfirmDialog("备份文件已存在，是否覆盖？", performBackup);
    } else {
      await performBackup();
    }
  }

  function openChromeDirectory() {
    const file = getStorageFile();
    const chromeDir = file.parent;
    chromeDir.launch();
  }

  async function init() {
    rulesInMemory = await getRulesFromFile();
    originalRules = JSON.stringify(toObject(rulesInMemory));
    const allRules = { '__BASE_CSS__': { type: 'css', enabled: true, label: 'Base CSS', code: baseCSS }, ...toObject(rulesInMemory) };
    await applyUserChrome(allRules);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addMenuItemWhenPopupReady, { once: true });
    } else {
      addMenuItemWhenPopupReady();
    }
  }

  init();

  window.addEventListener('unload', () => {
    for (const key of styleMap.keys()) cleanupRule(key, 'css');
    for (const key of scriptMap.keys()) cleanupRule(key, 'js');
    sandboxMap.clear();
    itemElements.clear();
    mainDialog?.remove();
    document.getElementById('appMenu-ucm-button')?.remove();
  }, { once: true });
})();
