// https://github.com/Endor8/userChrome.js/blob/master/Firefox-57/SearchEngineWheelScroll.uc.js
// Firefox 142+

(function () {
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

            enableSearchbarWheelSwitch: false,  // 搜索框滚轮切换开关
            enableUrlbarWheelSwitch: true,      // 地址栏滚轮切换开关

            debounceContextMenuUpdate: 50,      // 右键菜单防抖间隔（毫秒）
            throttleScrollSwitch: 100           // 滚轮切换节流间隔（毫秒）
        };

        let searchbar = document.getElementById('searchbar');
        let textbox = searchbar?.querySelector('.searchbar-textbox') || null;
        let urlbar = document.getElementById('urlbar');
        let ctxMenu = document.getElementById('context-searchselect');
        let goBtn = document.querySelector('.search-go-button');
        let searchIcon = searchbar?.querySelector('.searchbar-search-icon') || null;
        const searchSvc = Services.search;

        let cachedEngines = null;
        let lastEngineUpdate = 0;
        const CACHE_DURATION = 5000;
        let updateMenuTimer = null;
        let switchEngineTimer = null;

        const iconCache = new WeakMap();
        let lastIconURI = null;
        let lastEngineName = null;
        let currentStyleNode = null;

        function clearAllCache() {
            cachedEngines = null;
            lastEngineUpdate = 0;
        }

        async function getCachedEngines() {
            const now = Date.now();
            if (!cachedEngines || now - lastEngineUpdate > CACHE_DURATION) {
                cachedEngines = await searchSvc.getVisibleEngines();
                lastEngineUpdate = now;
            }
            return cachedEngines;
        }

        function isUrlbarHasContent() {
            if (!gURLBar) return false;
            const value = gURLBar.value;
            return value && value.trim() !== '' && gURLBar.getAttribute('pageproxystate') === 'valid';
        }

        async function resetEngine() {
            if (goBtn) goBtn.removeAttribute("hidden");
            if (!cfg.lockEngineMode) {
                const engines = await getCachedEngines();
                let targetEngine = cfg.forceFirstEngineOnReset || cfg.defaultEngineName === ''
                    ? engines[0]
                    : searchSvc.getEngineByName(cfg.defaultEngineName);
                if (targetEngine) {
                    await searchSvc.setDefault(targetEngine, Ci.nsISearchService.CHANGE_REASON_USER);
                }
            }
            if ((cfg.clearSearchboxOnReset || cfg.lockEngineMode) && textbox) textbox.value = '';
        }

        function dblclickHandler(e) {
            if (e.currentTarget.id === "urlbar" && isUrlbarHasContent()) return;
            resetEngine();
        }

        async function showEngine() {
            const engine = searchSvc.defaultEngine;
            if (!engine) return;

            if (cfg.showEngineNameInPlaceholder && textbox) {
                textbox.setAttribute('placeholder', engine.name);
            }

            if (cfg.showEngineIconInSearchbar && searchIcon) {
                if (lastEngineName === engine.name && iconCache.has(engine)) return;
                try {
                    let iconURL = iconCache.get(engine);
                    if (!iconURL) {
                        iconURL = await engine.getIconURL();
                        if (!iconURL) {
                            iconURL = 'chrome://global/skin/icons/search-glass.svg';
                        }
                        iconCache.set(engine, iconURL);
                    }
                    if (iconURL) {
                        Object.assign(searchIcon.style, {
                            listStyleImage: `url("${iconURL}")`,
                            width: '16px',
                            height: '16px',
                            background: ''
                        });
                        lastEngineName = engine.name;
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
            if (event.currentTarget.id === "urlbar" && isUrlbarHasContent()) return;
            if (switchEngineTimer) return;

            switchEngineTimer = setTimeout(() => { switchEngineTimer = null; }, cfg.throttleScrollSwitch);

            const dir = (cfg.scrollDirectionNormal ? 1 : -1) * Math.sign(event.deltaY);
            const engines = await getCachedEngines();
            if (!engines?.length) return;

            const cur = searchSvc.defaultEngine;
            if (!cur) return;

            const idx = engines.findIndex(e => e.name === cur.name);
            if (idx === -1) return;

            const newIdx = (idx + dir + engines.length) % engines.length;
            await searchSvc.setDefault(engines[newIdx], Ci.nsISearchService.CHANGE_REASON_USER);
            clearAllCache();

            if (event.currentTarget.id === "urlbar" && gURLBar && gURLBar.value) {
                gURLBar.search?.(gURLBar.value);
            }
        }

        let FormHistory = null;
        async function getFormHistory() {
            if (!FormHistory) {
                FormHistory = (await ChromeUtils.importESModule(
                    "resource://gre/modules/FormHistory.sys.mjs"
                )).FormHistory;
            }
            return FormHistory;
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

        if (cfg.resetEngineAfterSearch) {
            if (gURLBar && gURLBar._recordSearch) {
                const original_recordSearch = gURLBar._recordSearch;
                gURLBar._recordSearch = function(...args) {
                    const result = original_recordSearch.apply(this, args);
                    onSearchSubmit();
                    return result;
                };
            }

            if (searchbar && searchbar.handleSearchCommandWhere) {
                const originalHandleSearchCommandWhere = searchbar.handleSearchCommandWhere;
                searchbar.handleSearchCommandWhere = function(aEvent, aEngine, aWhere, aParams) {
                    const result = originalHandleSearchCommandWhere.call(this, aEvent, aEngine, aWhere, aParams);
                    onSearchSubmit();
                    return result;
                };
            }
        }

        if (cfg.enableUrlbarWheelSwitch && gURLBar && gURLBar._updatePlaceholder) {
            gURLBar._updatePlaceholder = function(engineName) {
                if (engineName && !this.searchMode) {
                    this._setPlaceholder(engineName);
                }
            };
        }

        function contextClick() {
            if (cfg.syncSearchOnContextClick && textbox) textbox.value = this.searchTerms || textbox.value;
            if (cfg.saveSearchHistoryOnContextClick) updateHistory();
            onSearchSubmit();
        }

        async function updateMenuIcon() {
            if (!ctxMenu || !searchSvc.defaultEngine || !cfg.showContextMenuIcon) return;
            try {
                const engine = searchSvc.defaultEngine;
                let iconURL = iconCache.get(engine);
                if (!iconURL) {
                    iconURL = await engine.getIconURL();
                    iconCache.set(engine, iconURL);
                }
                if (!iconURL) return;
                if (iconURL === lastIconURI && currentStyleNode) return;

                if (currentStyleNode) currentStyleNode.remove();

                const styleText = `@namespace url(http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul);
                    #context-searchselect:before{
                        margin-inline-end: 8px;
                        content:"";
                        display:inline-block;
                        width:16px;
                        height:16px;
                        background:url(${iconURL});
                        background-size:contain!important
                    }`;

                const sspi = document.createProcessingInstruction(
                    'xml-stylesheet',
                    `type="text/css" href="data:text/css,${encodeURIComponent(styleText)}"`
                );
                document.insertBefore(sspi, document.documentElement);
                currentStyleNode = sspi;
                lastIconURI = iconURL;
            } catch (e) {
                console.error("更新右键菜单图标失败:", e);
            }
        }

        function updateContextMenu() {
            if (!ctxMenu || !searchSvc.defaultEngine) return;
            if (updateMenuTimer) clearTimeout(updateMenuTimer);

            updateMenuTimer = setTimeout(async () => {
                let text = ctxMenu.searchTerms || window.getSelection().toString();
                if (text.length > 15) {
                    let cutLen = 15;
                    let code = text.charCodeAt(15);
                    if (code >= 0xDC00 && code <= 0xDFFF) cutLen++;
                    text = text.substr(0, cutLen) + '\u2026';
                }

                const label = gNavigatorBundle.getFormattedString('contextMenuSearch', [searchSvc.defaultEngine.name, text]);
                ctxMenu.setAttribute('label', label);

                if (cfg.enableContextMenuSwitch) await updateMenuIcon();
                updateMenuTimer = null;
            }, cfg.debounceContextMenuUpdate);
        }

        const eventListeners = [
            { element: searchbar, config: cfg.enableSearchbarWheelSwitch, event: 'wheel', handler: switchEngine },
            { element: searchbar, config: cfg.enableDoubleClickReset, event: 'dblclick', handler: dblclickHandler },
            { element: urlbar, config: cfg.enableUrlbarWheelSwitch, event: 'wheel', handler: switchEngine },
            { element: urlbar, config: cfg.enableDoubleClickReset, event: 'dblclick', handler: dblclickHandler },
            { element: ctxMenu, config: cfg.enableContextMenuSwitch, event: 'wheel', handler: switchEngine },
            { element: ctxMenu, config: cfg.enableContextMenuSwitch && cfg.syncSearchOnContextClick, event: 'click', handler: contextClick }
        ];

        function handleAfterCustomization() {
            searchbar = document.getElementById('searchbar');
            textbox = searchbar?.querySelector('.searchbar-textbox');
            searchIcon = searchbar?.querySelector('.searchbar-search-icon');
            goBtn = searchbar?.querySelector('.search-go-button');
            setTimeout(() => {
                lastEngineName = null;
                lastIconURI = null;
                if (goBtn) goBtn.removeAttribute("hidden");
                showEngine();
            }, 100);
        }

        function bindEvents() {
            eventListeners.forEach(({ element, config, event, handler }) => {
                if (element && config) element.addEventListener(event, handler, false);
            });
            window.addEventListener('aftercustomization', handleAfterCustomization, false);
            window.addEventListener('unload', cleanup, false);
        }

        function cleanup() {
            if (updateMenuTimer) clearTimeout(updateMenuTimer);
            if (switchEngineTimer) clearTimeout(switchEngineTimer);
            eventListeners.forEach(({ element, config, event, handler }) => {
                if (element && config) element.removeEventListener(event, handler, false);
            });
            window.removeEventListener('aftercustomization', handleAfterCustomization, false);
            Services.obs.removeObserver(obsSearchChange, "browser-search-engine-modified");
            Services.obs.removeObserver(obsInit, "browser-search-service");
            if (currentStyleNode) {
                currentStyleNode.remove();
                currentStyleNode = null;
            }
        }

        function obsSearchChange(engine, topic, verb) {
            if (topic !== "browser-search-engine-modified") return;
            if (verb !== "engine-current" && verb !== 'engine-default') return;
            clearAllCache();
            const task = () => showEngine().then(updateContextMenu);
            window.requestIdleCallback ? requestIdleCallback(task) : setTimeout(task, 0);
        }

        function obsInit(subject, topic, data) {
            if (data !== "init-complete" || topic !== "browser-search-service") return;
            const tasks = [];
            if (cfg.resetEngineOnStartup) tasks.push(resetEngine());
            tasks.push(showEngine());
            Promise.all(tasks).then(updateContextMenu);
        }

        Services.obs.addObserver(obsSearchChange, "browser-search-engine-modified");
        Services.obs.addObserver(obsInit, "browser-search-service");
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
})();



