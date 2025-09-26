(function () {
  'use strict';

  const styleMap = new Map();
  const itemElements = new Map();
  const styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

  let mainDialog, editDialog, deleteDialog;
  let editController, deleteController;
  let rulesInMemory = null;

  const baseCSS = `
    #ucss-main-dialog, #ucss-edit-dialog, #ucss-delete-dialog {
      padding: 15px; border: 1px solid var(--arrowpanel-border-color, ThreeDShadow);
      border-radius: 4px; background: var(--arrowpanel-background, -moz-Dialog);
      color: var(--arrowpanel-color, -moz-DialogText);
      min-width: 400px; max-width: 600px; z-index: 10000;
      font: message-box; font-size: 14px; line-height: 14px;
      box-shadow: 0 1px 4px color-mix(in srgb, currentColor 20%, transparent);
    }
    #ucss-main-dialog::backdrop, #ucss-edit-dialog::backdrop, #ucss-delete-dialog::backdrop {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .ucss-form { display: flex; flex-direction: column; gap: 12px; }
    .ucss-item { display: flex; align-items: center; gap: 8px; }
    .ucss-label { flex: 1; cursor: pointer; }
    .ucss-edit-btn, .ucss-delete-btn { margin-left: 4px; }
    #ucss-edit-dialog input[type=text], #ucss-edit-dialog textarea { width: 100%; box-sizing: border-box; font-family: monospace; }
    #ucss-edit-dialog textarea { min-height: 200px; }
    .ucss-add-btn { margin-top: 10px; align-self: flex-start; }
  `;

  function getStorageFile() {
    const { classes: Cc, interfaces: Ci } = Components;
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    const profileDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
    file.initWithPath(profileDir.path);
    file.append("chrome");
    if (!file.exists()) file.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    file.append("CustomCSSRules.json");
    return file;
  }

  async function getRulesFromFile() {
    try {
      const file = getStorageFile();
      if (file.exists()) {
        const data = await IOUtils.readUTF8(file.path);
        return JSON.parse(data);
      }
    } catch (e) {
      console.error("读取CSS规则文件失败:", e);
    }
    return {};
  }

  async function saveRulesToFile(rules) {
    try {
      const file = getStorageFile();
      await IOUtils.writeUTF8(file.path, JSON.stringify(rules, null, 2));
    } catch (e) {
      console.error("保存CSS规则文件失败:", e);
    }
  }

  async function applyCSS(rules) {
    if (!rulesInMemory && !rules) return;
    const target = rules || rulesInMemory;
    for (const [key, rule] of Object.entries(target)) {
      if (styleMap.has(key)) {  
        styleSheetService.unregisterSheet(styleMap.get(key), styleSheetService.USER_SHEET);  
        styleMap.delete(key);  
      }
      if (!rule || !rule.enabled) continue;
      const uri = Services.io.newURI(`data:text/css;charset=utf-8,${encodeURIComponent(rule.css)}`);
      styleSheetService.loadAndRegisterSheet(uri, styleSheetService.USER_SHEET);
      styleMap.set(key, uri);
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

  function setupDialogController(prevController, { okBtn, cancelBtn, onOk, onDispose } = {}) {
    if (prevController) prevController.abort();
    const controller = new AbortController();
    const { signal } = controller;
    okBtn.addEventListener('click', onOk, { signal });
    cancelBtn.addEventListener('click', () => okBtn.closest('dialog').close(), { signal });
    const dialog = okBtn.closest('dialog');
    if (dialog) {
      dialog.addEventListener('close', () => {
        controller.abort();
        if (typeof onDispose === 'function') onDispose();
      }, { once: true });
    }
    return controller;
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

  function createItemElement(key, rule) {
    const div = document.createElement('div');
    div.className = 'ucss-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled;
    const labelEl = document.createElement('label');
    labelEl.className = 'ucss-label';
    labelEl.textContent = rule.label;
    const editBtn = createButton('修改', () => showEditDialog(key));
    editBtn.className = 'ucss-edit-btn';
    const deleteBtn = createButton('删除', () => showDeleteConfirm(key));
    deleteBtn.className = 'ucss-delete-btn';
    checkbox.addEventListener('change', async () => {
      rulesInMemory[key].enabled = checkbox.checked;
      await applyCSS({ [key]: rulesInMemory[key] });
    });
    div.append(checkbox, labelEl, editBtn, deleteBtn);
    return { container: div, checkbox, labelEl };
  }

  async function updateDialogDOM() {
    if (!mainDialog) createMainDialog();
    const form = mainDialog._form;
    const newKeys = new Set(Object.keys(rulesInMemory));
    for (const oldKey of [...itemElements.keys()]) {
      if (!newKeys.has(oldKey)) {
        itemElements.get(oldKey).container.remove();
        itemElements.delete(oldKey);
      }
    }
    const fragment = document.createDocumentFragment();
    for (const [key, rule] of Object.entries(rulesInMemory)) {
      if (itemElements.has(key)) {
        const item = itemElements.get(key);
        if (item.checkbox.checked !== !!rule.enabled) item.checkbox.checked = !!rule.enabled;
        if (item.labelEl.textContent !== rule.label) item.labelEl.textContent = rule.label;
      } else {
        const item = createItemElement(key, rule);
        itemElements.set(key, item);
        fragment.appendChild(item.container);
      }
    }
    form.insertBefore(fragment, mainDialog._btnRow);
  }

  function createMainDialog() {
    mainDialog = createDialog('ucss-main-dialog', dialog => {
      const form = document.createElement('form');
      form.className = 'ucss-form';
      dialog.appendChild(form);
      const addBtn = createButton('新增', () => showEditDialog(null));
      const exportBtn = createButton('导出', exportRules);
      const importBtn = createButton('导入', importRules);
      const exitBtn = createButton('退出', () => dialog.close());
      const btnRow = createButtonRow([addBtn, exportBtn, importBtn, exitBtn]);
      form.appendChild(btnRow);
      dialog._btnRow = btnRow;
      dialog._form = form;
    });
    mainDialog.addEventListener('close', async () => {
      if (rulesInMemory) await saveRulesToFile(rulesInMemory);
    });
  }

  async function showMainDialog() {
    rulesInMemory = await getRulesFromFile();
    await updateDialogDOM();
    mainDialog.showModal();
  }

  async function showEditDialog(key) {
    if (!key) key = `ucss_${Date.now()}`;
    editDialog = createDialog('ucss-edit-dialog', dialog => {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '10px';
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = rulesInMemory[key]?.label || '';
      container.appendChild(labelInput);
      const textarea = document.createElement('textarea');
      textarea.value = rulesInMemory[key]?.css || '';
      container.appendChild(textarea);
      const okBtn = createButton('确定', async () => {
        const label = labelInput.value.trim();
        if (!label) return;
        rulesInMemory[key] = { label, enabled: true, css: textarea.value };
        await applyCSS({ [key]: rulesInMemory[key] });
        dialog.close();
        await updateDialogDOM();
      });
      const cancelBtn = createButton('取消', () => dialog.close());
      container.appendChild(createButtonRow([okBtn, cancelBtn]));
      dialog.appendChild(container);
      editController = setupDialogController(editController, { okBtn, cancelBtn, onDispose: () => { editController = null; } });
    });
    editDialog.showModal();
  }

  async function showDeleteConfirm(key) {
    deleteDialog = createDialog('ucss-delete-dialog', dialog => {
      const msg = document.createElement('div');
      msg.textContent = `确定删除 CSS 项 "${rulesInMemory[key].label}" 吗？`;
      msg.style.marginBottom = '10px';
      dialog.appendChild(msg);
      const okBtn = createButton('确定', async () => {
        delete rulesInMemory[key];
        if (styleMap.has(key)) {  
          styleSheetService.unregisterSheet(styleMap.get(key), styleSheetService.USER_SHEET);  
          styleMap.delete(key);  
        }
        dialog.close();
        await updateDialogDOM();
      });
      const cancelBtn = createButton('取消', () => dialog.close());
      dialog.appendChild(createButtonRow([okBtn, cancelBtn]));
      deleteController = setupDialogController(deleteController, { okBtn, cancelBtn, onDispose: () => { deleteController = null; } });
    });
    deleteDialog.showModal();
  }

  function addMenuItemWhenPopupReady() {
    const popup = document.getElementById('appMenu-popup');
    if (!popup) return;
    popup.addEventListener('popupshowing', () => {
      if (!document.getElementById('appMenu-ucss-button')) {
        const btn = document.createXULElement('toolbarbutton');
        btn.id = 'appMenu-ucss-button';
        btn.className = 'subviewbutton';
        btn.setAttribute('label', 'CSS 管理器');
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
    await IOUtils.writeUTF8(PathUtils.join(dir, `customCSSRules_${timestamp}.json`), JSON.stringify(rulesInMemory, null, 2));
    await Promise.all(Object.values(rulesInMemory).map(rule => {
      const safeName = rule.label.replace(/[<>:"/\\|?*]/g, '_');
      const cssPath = PathUtils.join(dir, `${safeName}_${timestamp}.css`);
      return IOUtils.writeUTF8(cssPath, rule.css);
    }));
  }

  async function importRules() {
    const files = await pickFiles(['.json', '.css']);
    if (!files?.length) return;
    for (const file of files) {
      try {
        const content = await file.text();
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          for (const [key, value] of Object.entries(data)) {
            if (value && typeof value.label === 'string' && typeof value.css === 'string' && typeof value.enabled === 'boolean') {
              rulesInMemory[key] = value;
            }
          }
        } else if (file.name.endsWith('.css')) {
          const label = file.name.replace('.css', '');
          const key = `ucss_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          rulesInMemory[key] = { label, enabled: true, css: content };
        }
      } catch (e) {
        console.error(`导入文件 ${file.name} 失败:`, e);
      }
    }
    await applyCSS();
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

  async function init() {
    rulesInMemory = await getRulesFromFile();
    await applyCSS({ '__BASE_CSS__': { enabled: true, css: baseCSS } });
    await applyCSS();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addMenuItemWhenPopupReady, { once: true });
    } else {
      addMenuItemWhenPopupReady();
    }
  }

  init();

  window.addEventListener('unload', () => {
    for (const uri of styleMap.values()) {
      styleSheetService.unregisterSheet(uri, styleSheetService.USER_SHEET);
    }
    styleMap.clear();
    mainDialog?.remove();
    editDialog?.remove();
    deleteDialog?.remove();
    document.getElementById('appMenu-ucss-button')?.remove();
    itemElements.clear();
  }, { once: true });
})();
