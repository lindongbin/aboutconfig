(function() {
  'use strict';

  let menuItem = null;
  let floatingPanel = null;
  let refreshTimer = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  const processExpandState = new Map();
  const cleanupFunctions = new Set();

  const nodeKeyMap = new Map();
  const nodeCache = new WeakMap();

  function getNodeKey(pid, tab) {
    const keyStr = `${pid}-${tab ? tab.linkedBrowser.outerWindowID : 'unknown'}`;
    if (!nodeKeyMap.has(keyStr)) {
      nodeKeyMap.set(keyStr, {});
    }
    return nodeKeyMap.get(keyStr);
  }

  const handleKeydown = (event) => {
    if (event.ctrlKey && event.shiftKey && event.key === 'M') {
      event.preventDefault();
      if (floatingPanel) {
        hideFloatingPanel();
      } else {
        showFloatingPanel();
      }
    }
  };

  function addCleanup(func) {
    cleanupFunctions.add(func);
  }

  function runAndClearCleanup() {
    cleanupFunctions.forEach(func => func());
    cleanupFunctions.clear();
  }

  async function getAllTabsProcessInfo() {
    try {
      const procInfo = await ChromeUtils.requestProcInfo();
      const processMap = new Map();

      for (const tab of gBrowser.tabs) {
        const outerWindowId = tab.linkedBrowser.outerWindowID;
        let found = false;

        for (const childProc of procInfo.children) {
          if (childProc.windows) {
            for (const win of childProc.windows) {
              if (win.outerWindowId === outerWindowId) {
                const pid = childProc.pid || 'N/A';
                if (!processMap.has(pid)) {
                  processMap.set(pid, {
                    pid,
                    type: childProc.type || 'unknown',
                    memory: 0,
                    tabs: []
                  });
                }
                processMap.get(pid).tabs.push({
                  tab,
                  title: tab.getAttribute('label') || 'Untitled'
                });
                found = true;
                break;
              }
            }
          }
          if (found) break;
        }

        if (!found) {
          const pid = 'N/A';
          if (!processMap.has(pid)) {
            processMap.set(pid, {
              pid,
              type: 'unknown',
              memory: 0,
              tabs: []
            });
          }
          processMap.get(pid).tabs.push({
            tab,
            title: tab.getAttribute('label') || 'Untitled'
          });
        }
      }

      for (const childProc of procInfo.children) {
        const pid = childProc.pid || 'N/A';
        const procData = processMap.get(pid);
        if (procData) {
          procData.memory += Math.round(childProc.memory / (1024 * 1024));
        }
      }

      return Array.from(processMap.values());
    } catch (e) {
      console.error('获取所有标签页进程信息失败:', e);
      return [];
    }
  }

  function createOrUpdateProcessTreeNode(tabInfo, showMemory = true, isChild = false) {
    const keyObj = getNodeKey(tabInfo.pid, tabInfo.tab);
    let node = nodeCache.get(keyObj);

    if (!node) {
      node = document.createElement('div');
      nodeCache.set(keyObj, node);

      const handleMouseEnter = () => node.style.backgroundColor = 'var(--toolbar-field-focus-background-color, #f0f0f0)';
      const handleMouseLeave = () => node.style.backgroundColor = 'var(--arrowpanel-background, -moz-Dialog)';
      const handleClick = () => { if (tabInfo.tab) gBrowser.selectedTab = tabInfo.tab; };

      node.addEventListener('mouseenter', handleMouseEnter);
      node.addEventListener('mouseleave', handleMouseLeave);
      node.addEventListener('click', handleClick);

      addCleanup(() => {
        node.removeEventListener('mouseenter', handleMouseEnter);
        node.removeEventListener('mouseleave', handleMouseLeave);
        node.removeEventListener('click', handleClick);
        node.tabReference = null;
      });
    }

    node.tabReference = tabInfo.tab || null;
    node.style.cssText = `
      padding: 6px ${isChild ? '24px' : '8px'};
      border-bottom: 1px solid var(--chrome-content-separator-color, #e1e1e2);
      cursor: pointer;
      transition: background-color 0.2s;
      background-color: var(--arrowpanel-background, -moz-Dialog);
      color: var(--arrowpanel-color, -moz-DialogText);
    `;

    let title = node.querySelector('.memory-monitor-node-title');
    if (!title) {
      title = document.createElement('div');
      title.className = 'memory-monitor-node-title';
      node.appendChild(title);
    }
    title.style.cssText = `
      font-weight: ${isChild ? 'normal' : '500'};
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--arrowpanel-color, -moz-DialogText);
    `;
    title.textContent = tabInfo.title;

    let details = node.querySelector('.memory-monitor-node-details');
    if (!details) {
      details = document.createElement('div');
      details.className = 'memory-monitor-node-details';
      node.appendChild(details);
    }
    details.style.cssText = `
      color: var(--arrowpanel-color, -moz-DialogText);
      font-size: 11px;
      display: flex;
      justify-content: space-between;
    `;
    details.innerHTML = '';

    if (showMemory) {
      const memoryText = document.createElement('span');
      memoryText.textContent = `${tabInfo.memory}MB`;
      memoryText.style.fontWeight = '600';
      details.appendChild(memoryText);
    } else {
      details.appendChild(document.createElement('span'));
    }

    if (!isChild) {
      const processText = document.createElement('span');
      processText.textContent = `PID: ${tabInfo.pid || ''} ${tabInfo.type || ''}`;
      details.appendChild(processText);
    } else {
      details.appendChild(document.createElement('span'));
    }

    return node;
  }

  function createOrUpdateProcessGroupNode(proc) {
    const keyObj = getNodeKey(`group-${proc.pid}`, null);
    let processHeader = nodeCache.get(keyObj);
    let childrenContainer = null;

    if (!processHeader) {
      processHeader = document.createElement('div');
      nodeCache.set(keyObj, processHeader);

      childrenContainer = document.createElement('div');
      nodeCache.set(getNodeKey(`group-${proc.pid}-children`, null), childrenContainer);
    } else {
      childrenContainer = nodeCache.get(getNodeKey(`group-${proc.pid}-children`, null));
    }

    processHeader.style.cssText = `
      padding: 8px;
      background: var(--arrowpanel-background, -moz-Dialog);
      color: var(--arrowpanel-color, -moz-DialogText);
      font-weight: 600;
      border-bottom: 1px solid var(--chrome-content-separator-color, #e1e1e2);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    let processTitle = processHeader.querySelector('.process-title');
    if (!processTitle) {
      processTitle = document.createElement('span');
      processTitle.className = 'process-title';
      processHeader.appendChild(processTitle);
    }
    processTitle.textContent = `进程 ${proc.pid} (${proc.type})`;

    let memorySpan = processHeader.querySelector('.memory-span');
    if (!memorySpan) {
      memorySpan = document.createElement('span');
      memorySpan.className = 'memory-span';
      processHeader.appendChild(memorySpan);
    }
    memorySpan.style.fontWeight = '600';
    memorySpan.textContent = `总计: ${proc.memory}MB`;

    let expandIcon = processHeader.querySelector('.expand-icon');
    if (!expandIcon) {
      expandIcon = document.createElement('span');
      expandIcon.className = 'expand-icon';
      expandIcon.textContent = '▼';
      expandIcon.style.cssText = 'font-size: 10px; transition: transform 0.2s;';
      processHeader.appendChild(expandIcon);

      const handleHeaderClick = () => {
        const currentExpandedState = processExpandState.has(proc.pid) ? processExpandState.get(proc.pid) : true;
        const newExpandedState = !currentExpandedState;

        childrenContainer.style.display = newExpandedState ? 'block' : 'none';
        expandIcon.style.transform = newExpandedState ? 'rotate(0deg)' : 'rotate(-90deg)';
        processExpandState.set(proc.pid, newExpandedState);
      };
      processHeader.addEventListener('click', handleHeaderClick);
      addCleanup(() => processHeader.removeEventListener('click', handleHeaderClick));
    }

    const isExpanded = processExpandState.has(proc.pid) ? processExpandState.get(proc.pid) : true;
    childrenContainer.style.display = isExpanded ? 'block' : 'none';
    expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';

    childrenContainer.innerHTML = '';
    const isChild = proc.tabs.length > 1;
    proc.tabs.forEach(t => {
      childrenContainer.appendChild(createOrUpdateProcessTreeNode({
        tab: t.tab,
        title: t.title,
        pid: proc.pid,
        type: proc.type
      }, false, isChild));
    });

    return [processHeader, childrenContainer];
  }

  async function updateFloatingPanel() {
    if (!floatingPanel) return;
    const content = document.getElementById('memory-panel-content');
    if (!content) return;

    try {
      const processList = await getAllTabsProcessInfo();
      const newPids = new Set(processList.map(p => p.pid));
      const oldPids = new Set(processExpandState.keys());

      for (const pid of oldPids) {
        if (!newPids.has(pid)) {
          processExpandState.delete(pid);
        }
      }

      const topProcesses = processList
        .sort((a, b) => b.memory - a.memory)
        .slice(0, 10);

      const fragment = document.createDocumentFragment();

      if (topProcesses.length === 0) {
        runAndClearCleanup();
        const noDataNode = document.createElement('div');
        noDataNode.style.cssText = 'padding: 20px; text-align: center;';
        noDataNode.textContent = '暂无数据';
        fragment.appendChild(noDataNode);
        content.innerHTML = '';
        content.appendChild(fragment);
      } else {
        topProcesses.forEach(proc => {
          if (proc.tabs.length === 1) {
            fragment.appendChild(createOrUpdateProcessTreeNode({
              tab: proc.tabs[0].tab,
              title: proc.tabs[0].title,
              memory: proc.memory,
              pid: proc.pid,
              type: proc.type
            }, true, false));
          } else {
            const [header, children] = createOrUpdateProcessGroupNode(proc);
            fragment.appendChild(header);
            fragment.appendChild(children);
          }
        });

        content.innerHTML = '';
        content.appendChild(fragment);
      }
    } catch (e) {
      console.error('更新悬浮面板失败:', e);
      content.innerHTML = '<div style="padding: 20px; text-align: center;">更新失败</div>';
    }
  }

  function createFloatingPanel() {
    if (floatingPanel) return;

    floatingPanel = document.createElement('div');
    floatingPanel.id = 'memory-monitor-panel';
    floatingPanel.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      width: 400px;
      max-height: 500px;
      background: var(--arrowpanel-background, -moz-Dialog);
      border: 1px solid var(--arrowpanel-border-color, ThreeDShadow);
      border-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
      z-index: 10000;
      font: message-box;
      font-size: 12px;
      overflow: hidden;
      user-select: none;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 12px;
      border-bottom: 1px solid var(--chrome-content-separator-color, #e1e1e2);
      cursor: move;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--arrowpanel-color, -moz-DialogText);
    `;
    header.textContent = '标签页内存监控';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      color: var(--arrowpanel-color, -moz-DialogText);
    `;
    closeBtn.onclick = hideFloatingPanel;
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    content.id = 'memory-panel-content';
    content.style.cssText = `max-height: 400px; overflow-y: auto; padding: 8px;`;

    floatingPanel.appendChild(header);
    floatingPanel.appendChild(content);
    document.documentElement.appendChild(floatingPanel);

    header.addEventListener('mousedown', startDrag);
    addCleanup(() => header.removeEventListener('mousedown', startDrag));
  }

  function startDrag(e) {
    if (!floatingPanel) return;

    isDragging = true;
    const rect = floatingPanel.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    floatingPanel.style.cursor = 'grabbing';

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const x = ev.clientX - dragOffset.x;
      const y = ev.clientY - dragOffset.y;
      const maxX = window.innerWidth - floatingPanel.offsetWidth;
      const maxY = window.innerHeight - floatingPanel.offsetHeight;
      floatingPanel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      floatingPanel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      floatingPanel.style.right = 'auto';
    };

    const onMouseUp = () => {
      isDragging = false;
      if (floatingPanel) floatingPanel.style.cursor = 'default';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      cleanupFunctions.delete(onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    addCleanup(onMouseUp);
  }

  function updateMenuLabel() {
    if (!menuItem) return;
    menuItem.setAttribute('label', floatingPanel ? '隐藏内存监控面板' : '显示内存监控面板');
  }

  function safeClearNodeCache() {
    nodeKeyMap.clear();
  }

  function showFloatingPanel() {
    createFloatingPanel();
    updateFloatingPanel();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(updateFloatingPanel, 5000);
    updateMenuLabel();
  }

  function hideFloatingPanel() {
    runAndClearCleanup();
    safeClearNodeCache();
    if (floatingPanel) {
      floatingPanel.remove();
      floatingPanel = null;
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    updateMenuLabel();
  }

  function init() {
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeunload', () => {
      document.removeEventListener('keydown', handleKeydown);
      hideFloatingPanel();
    });

    const contextMenu = document.getElementById('tabContextMenu');
    if (contextMenu) {
      const separator = document.createXULElement('menuseparator');
      menuItem = document.createXULElement('menuitem');
      menuItem.setAttribute('label', '显示内存监控面板');
      const handleMenuItemCommand = () => {
        if (floatingPanel) {
          hideFloatingPanel();
        } else {
          showFloatingPanel();
        }
      };
      menuItem.addEventListener('command', handleMenuItemCommand);
      contextMenu.appendChild(separator);
      contextMenu.appendChild(menuItem);
    }
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }

})();
