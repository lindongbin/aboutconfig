// https://github.com/Endor8/userChrome.js/blob/master/Firefox-57/SearchEngineWheelScroll.uc.js
// Firefox 142+

(function () {
    let cleanup;
    async function initScript() {
        const cfg = {
            restrictToButtonClick: false,       // 是否仅允许通过点击搜索按钮触发滚轮切换（限制触发区域）
            showEngineNameInPlaceholder: true,  // 是否在搜索框占位符(placeholder)中显示当前搜索引擎名称
            showEngineIconInSearchbar: true,    // 是否在搜索框左侧显示当前搜索引擎的图标
            lockEngineMode: false,              // 锁定模式：是否禁用所有切换功能，固定使用当前搜索引擎
            enableDoubleClickReset: true,       // 是否启用双击搜索栏重置到默认搜索引擎
            forceFirstEngineOnReset: false,     // 重置时是否强制使用可见引擎列表中的第一个（忽略 defaultEngineName 设置）
            defaultEngineName: 'Bing',          // 重置时的目标搜索引擎名称（当 forceFirstEngineOnReset 为 false 时生效）
            clearSearchboxOnReset: false,       // 重置搜索引擎时是否同时清空搜索框内容
            resetEngineAfterSearch: false,      // 执行搜索后是否自动重置回默认搜索引擎

            enableContextMenuSwitch: true,      // 是否启用右键菜单的滚轮切换功能
            showContextMenuIcon: false,         // 是否在右键搜索菜单项前显示搜索引擎图标
            syncSearchOnContextClick: true,     // 右键菜单搜索时触发相关同步操作（内容同步到搜索框、保存搜索历史、重置回默认引擎）
            saveSearchHistoryOnContextClick: false, // 是否将右键菜单搜索添加到搜索历史记录

            resetEngineOnStartup: true,         // Firefox 启动完成时是否自动重置到默认搜索引擎
            scrollDirectionNormal: true,        // 滚轮方向映射：true=向下滚动切换到下一个引擎，false=相反
            allowEngineLoopSwitch: false,       // 是否允许滚轮循环切换搜索引擎（false=到头停）

            enableSearchbarWheelSwitch: false,  // 搜索框滚轮切换开关
            enableUrlbarWheelSwitch: true,      // 地址栏滚轮切换开关

            throttleScrollSwitch: 100           // 滚轮切换节流间隔（毫秒）
        };

        const abortController = new AbortController();
        const { signal } = abortController;
        const searchSvc = Services.search;

        const iconCache = new Map();
        let searchbar = document.getElementById('searchbar');
        let searchIcon = searchbar?.querySelector('.searchbar-search-icon');
        let textbox = searchbar?.querySelector('.searchbar-textbox');
        let goBtn = searchbar?.querySelector('.search-go-button');
        let urlbar = document.getElementById('urlbar');
        let ctxMenu = document.getElementById('context-searchselect');

        let cachedEngines = null;
        let defaultEngine = null;
        let resizeTimer = null;
        let switchEngineTimer = null;
        let currentEngineIndex = -1;
        let currentStyleElement = null;
        let lastEngineName = null;
        let lastMenuLabel = null;
        let FormHistory = null;

        let original_recordSearch = null;
        let originalHandleSearchCommandWhere = null;
        let original_updatePlaceholder = null;

        function isUrlbarHasContent() {
            if (!gURLBar) return false;
            const value = gURLBar.value;
            return value && value.trim() !== '' && gURLBar.getAttribute('pageproxystate') === 'valid';
        }

        async function getFormHistory() {
            if (!FormHistory) {
                FormHistory = (await ChromeUtils.importESModule(
                    "resource://gre/modules/FormHistory.sys.mjs"
                )).FormHistory;
            }
            return FormHistory;
        }

        async function resetEngine() {
            if (goBtn) goBtn.removeAttribute("hidden");
            if (!cfg.lockEngineMode) {
                let targetEngine = cfg.forceFirstEngineOnReset || cfg.defaultEngineName === ''
                    ? cachedEngines[0]
                    : cachedEngines.find(e => e.name === cfg.defaultEngineName);
                if (targetEngine) {
                    await searchSvc.setDefault(targetEngine, Ci.nsISearchService.CHANGE_REASON_USER);
                }
            }
            if ((cfg.clearSearchboxOnReset || cfg.lockEngineMode) && textbox) textbox.value = '';
        }

        async function showEngine() {
            if (lastEngineName === defaultEngine.name && iconCache.has(defaultEngine.name)) return;
            if (cfg.showEngineNameInPlaceholder && textbox) {
                textbox.setAttribute('placeholder', defaultEngine.name);
            }
            if (cfg.showEngineIconInSearchbar && searchIcon) {
                try {
                    let iconURL = iconCache.get(defaultEngine.name);
                    if (!iconURL) {
                        iconURL = await defaultEngine.getIconURL();
                        if (!iconURL) {
                            iconURL = 'chrome://global/skin/icons/search-glass.svg';
                        }
                        iconCache.set(defaultEngine.name, iconURL);
                    }
                    if (iconURL) {
                        Object.assign(searchIcon.style, {
                            listStyleImage: `url("${iconURL}")`,
                            width: '16px',
                            height: '16px',
                            background: ''
                        });
                        lastEngineName = defaultEngine.name;
                    }
                } catch (e) {
                    console.error("获取搜索引擎图标失败:", e);
                }
            }
        }

        async function switchEngine(event) {
            if (cfg.lockEngineMode) return;
            if (cfg.restrictToButtonClick &&
                event.originalTarget.className !== 'searchbar-search-button' &&
                event.originalTarget !== ctxMenu &&
                !event.originalTarget.closest('#urlbar')) return;
            if (event.currentTarget.id === "urlbar" && (isUrlbarHasContent() || gURLBar.searchMode)) return;
            const targetRow = event.target.closest('.urlbarView-row');
            if (targetRow && targetRow.getAttribute('type') !== 'search') return;
            if (switchEngineTimer) return;

            switchEngineTimer = setTimeout(() => { switchEngineTimer = null; }, cfg.throttleScrollSwitch);

            const dir = (cfg.scrollDirectionNormal ? 1 : -1) * Math.sign(event.deltaY);

            if (currentEngineIndex === -1 || 
                cachedEngines[currentEngineIndex]?.name !== defaultEngine.name) {
                currentEngineIndex = cachedEngines.findIndex(e => e.name === defaultEngine.name);
            }

            let newIdx = currentEngineIndex + dir;

            if (cfg.allowEngineLoopSwitch) {
                newIdx = (newIdx + cachedEngines.length) % cachedEngines.length;
            } else {
                if (newIdx < 0 || newIdx >= cachedEngines.length) return;
            }

            currentEngineIndex = newIdx;

            await searchSvc.setDefault(cachedEngines[newIdx], Ci.nsISearchService.CHANGE_REASON_USER);

            if (event.currentTarget.id === "urlbar" && gURLBar && gURLBar.value) {
                gURLBar.search?.(gURLBar.value);
            }
        }

        async function updateHistory() {
            if (!ctxMenu || !cfg.saveSearchHistoryOnContextClick) return;
            const val = ctxMenu.searchTerms;
            if (!val) return;

            try {
                const formHistory = await getFormHistory();
                await Promise.all([
                    formHistory.update({ op: "remove", fieldname: "searchbar-history", value: val }),
                    formHistory.update({ op: "add", fieldname: "searchbar-history", value: val })
                ]);
            } catch (e) {
                console.error("updateHistory 出错:", e);
            }
        }

        function onSearchSubmit() {
            if (cfg.resetEngineAfterSearch) {
                setTimeout(resetEngine, 0);
            }
        }

        function dblclickHandler(e) {
            if (e.currentTarget.id === "urlbar" && isUrlbarHasContent()) return;
            resetEngine();
        }

        function contextClick() {
            if (cfg.syncSearchOnContextClick && textbox) textbox.value = this.searchTerms || textbox.value;
            if (cfg.saveSearchHistoryOnContextClick) updateHistory();
            onSearchSubmit();
        }

        function handleAfterCustomization() {
            searchbar = document.getElementById('searchbar');
            searchIcon = searchbar?.querySelector('.searchbar-search-icon');
            textbox = searchbar?.querySelector('.searchbar-textbox');
            goBtn = searchbar?.querySelector('.search-go-button');
            setTimeout(() => {
                lastEngineName = null;
                if (goBtn) goBtn.removeAttribute("hidden");
                showEngine();
            }, 100);
        }

        function handleWindowResize() {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                handleAfterCustomization();
            }, 200);
        }

        async function updateContextMenu() {
            if (!cfg.enableContextMenuSwitch) return;
            if (!ctxMenu) return;
            let text = ctxMenu.searchTerms || window.getSelection().toString();
            if (text.length > 15) {
                let cutLen = 15;
                let code = text.charCodeAt(15);
                if (code >= 0xDC00 && code <= 0xDFFF) cutLen++;
                text = text.substr(0, cutLen) + '\u2026';
            }
            const newLabel = gNavigatorBundle.getFormattedString(
                'contextMenuSearch',
                [defaultEngine.name, text]
            );
            if (newLabel !== lastMenuLabel) {
                ctxMenu.setAttribute('label', newLabel);
                lastMenuLabel = newLabel;
            }
            if (!cfg.showContextMenuIcon) return;
            let iconURL = iconCache.get(defaultEngine.name);
            if (!iconURL) {
                iconURL = await defaultEngine.getIconURL() || 'chrome://global/skin/icons/search-glass.svg';
                iconCache.set(defaultEngine.name, iconURL);
            }
            if (!currentStyleElement) {
                currentStyleElement = document.createElement('style');
                currentStyleElement.dataset.engineStyle = 'search-engine-icon';
                document.head.appendChild(currentStyleElement);
            }
            currentStyleElement.textContent = `
                #context-searchselect::before {
                    margin-inline-end: 8px;
                    content: "";
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    background: url(${iconURL});
                    background-size: contain !important;
                }
            `;
        }

        async function obsSearchChange(engine, topic, verb) {
            if (topic !== "browser-search-engine-modified") return;
            if (["engine-added", "engine-removed", "engine-changed", "engine-loaded"].includes(verb)) {
                cachedEngines = await searchSvc.getVisibleEngines();
                currentEngineIndex = -1;
            }
            if (verb === "engine-current" || verb === "engine-default") {
                defaultEngine = searchSvc.defaultEngine;
                const task = () => showEngine().then(updateContextMenu);
                window.requestIdleCallback ? requestIdleCallback(task) : setTimeout(task, 0);
            }
        }

        async function obsInit(subject, topic, data) {
            if (data !== "init-complete" || topic !== "browser-search-service") return;
            cachedEngines = await searchSvc.getVisibleEngines();
            defaultEngine = searchSvc.defaultEngine;
            await Promise.allSettled(cachedEngines.map(e => e.getIconURL().then(url => url && iconCache.set(e.name, url))));
            if (cfg.resetEngineOnStartup) await resetEngine();
            await showEngine();
            await updateContextMenu();
        }

        cleanup = function() {
            abortController.abort();
            if (resizeTimer) clearTimeout(resizeTimer);
            if (switchEngineTimer) clearTimeout(switchEngineTimer);
            if (original_recordSearch && gURLBar) {
                gURLBar._recordSearch = original_recordSearch;
            }
            if (originalHandleSearchCommandWhere && searchbar) {
                searchbar.handleSearchCommandWhere = originalHandleSearchCommandWhere;
            }
            if (original_updatePlaceholder && gURLBar) {
                gURLBar._updatePlaceholder = original_updatePlaceholder;
            }
            Services.obs.removeObserver(obsSearchChange, "browser-search-engine-modified");
            Services.obs.removeObserver(obsInit, "browser-search-service");
            if (searchIcon) searchIcon.removeAttribute('style');
            if (textbox) textbox.removeAttribute('placeholder');
            document.querySelectorAll('style[data-engine-style]').forEach(node => node.remove());

            iconCache.clear();
            cachedEngines = null;
            defaultEngine = null;
            currentEngineIndex = -1;
            currentStyleElement = null;
            lastEngineName = null;
            lastMenuLabel = null;
            FormHistory = null;
        }

        function bindEvents() {
            const eventListeners = [
                { element: searchbar, config: cfg.enableSearchbarWheelSwitch, event: 'wheel', handler: switchEngine },
                { element: searchbar, config: cfg.enableDoubleClickReset, event: 'dblclick', handler: dblclickHandler },
                { element: urlbar, config: cfg.enableUrlbarWheelSwitch, event: 'wheel', handler: switchEngine },
                { element: urlbar, config: cfg.enableDoubleClickReset, event: 'dblclick', handler: dblclickHandler },
                { element: ctxMenu, config: cfg.enableContextMenuSwitch, event: 'wheel', handler: switchEngine },
                { element: ctxMenu, config: cfg.enableContextMenuSwitch && cfg.syncSearchOnContextClick, event: 'click', handler: contextClick }
            ];

            eventListeners.forEach(({ element, config, event, handler }) => {
                if (element && config) {
                    element.addEventListener(event, handler, event === 'wheel' ? { passive: true, signal } : { signal });
                }
            });
            window.addEventListener('aftercustomization', handleAfterCustomization, { signal });
            window.addEventListener('resize', handleWindowResize, { signal });
            window.addEventListener('unload', cleanup, { signal });
        }

        if (cfg.resetEngineAfterSearch) {
            if (gURLBar && gURLBar._recordSearch) {
                original_recordSearch = gURLBar._recordSearch;
                gURLBar._recordSearch = function(...args) {
                    const result = original_recordSearch.apply(this, args);
                    onSearchSubmit();
                    return result;
                };
            }

            if (searchbar && searchbar.handleSearchCommandWhere) {
                originalHandleSearchCommandWhere = searchbar.handleSearchCommandWhere;
                searchbar.handleSearchCommandWhere = function(aEvent, aEngine, aWhere, aParams) {
                    const result = originalHandleSearchCommandWhere.call(this, aEvent, aEngine, aWhere, aParams);
                    onSearchSubmit();
                    return result;
                };
            }
        }

        if (cfg.enableUrlbarWheelSwitch && gURLBar && gURLBar._updatePlaceholder) {
            original_updatePlaceholder = gURLBar._updatePlaceholder;
            gURLBar._updatePlaceholder = function(engineName) {
                if (engineName && !this.searchMode) {
                    this._setPlaceholder(engineName);
                }
            };
        }

        Services.obs.addObserver(obsSearchChange, "browser-search-engine-modified");
        Services.obs.addObserver(obsInit, "browser-search-service");
        if (searchSvc.isInitialized) obsInit(null, "browser-search-service", "init-complete");
        bindEvents();
    }

    function runAfterStartup(task) {
        if (gBrowserInit?.delayedStartupFinished) {
            task();
        } else {
            const observer = () => {
                Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
                task();
            };
            Services.obs.addObserver(observer, "browser-delayed-startup-finished");
        }
    }

    runAfterStartup(initScript);
    return cleanup;
})();
