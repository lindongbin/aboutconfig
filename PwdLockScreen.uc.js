(async function () {
    'use strict';

    const CUSTOM_PASSWORD = "123456";
    const LOCK_STATE_PREF = "browser.lock.isLocked";
    
    let isLocked = Services.prefs.getBoolPref(LOCK_STATE_PREF, false);
    let originalTitle = document.title;

    function createElement(tag, props = {}, styles = {}) {
        const element = document.createElement(tag);
        Object.assign(element, props);
        Object.assign(element.style, styles);
        return element;
    }

    const styles = {
        dialog: {
            position: 'fixed', inset: '0', width: '100vw', height: '100vh',
            margin: '0', padding: '20px', border: 'none',
            background: 'var(--arrowpanel-background, white)',
            color: 'var(--arrowpanel-color, black)',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        },
        container: {
            display: 'flex', flexDirection: 'column', gap: '15px',
            alignItems: 'center', maxWidth: '400px', width: '100%'
        },
        input: {
            width: '100%', padding: '8px 12px', border: '1px solid #ccc',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box'
        },
        button: {
            padding: '8px 20px', background: '#d70022', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px'
        }
    };

    function setLockState(locked) {
        isLocked = locked;
        Services.prefs.setBoolPref(LOCK_STATE_PREF, locked);
        
        if (locked) {
            originalTitle = document.title;
            document.title = "Firefox";
        } else {
            if (window.gBrowser) {
                window.gBrowser.updateTitlebar();
            } else {
                document.title = originalTitle;
            }
        }
    }

    function showPasswordPrompt() {
        return new Promise((resolve) => {
            const dialog = createElement('dialog', {}, styles.dialog);
            const container = createElement('div', {}, styles.container);
            
            const title = createElement('h3', {
                textContent: 'Firefox 已锁定'
            }, { margin: '0', color: 'var(--arrowpanel-color, black)' });

            const message = createElement('p', {
                textContent: '请输入密码以解锁Firefox:'
            }, { margin: '0', textAlign: 'center' });

            const input = createElement('input', {
                type: 'password',
                placeholder: '输入密码'
            }, styles.input);

            const unlockBtn = createElement('button', {
                textContent: '解锁'
            }, styles.button);
            
            const handlers = {
                cleanup() {
                    document.removeEventListener('keydown', handlers.keyHandler, true);
                    const urlbar = document.getElementById('urlbar-container');
                    if (urlbar) urlbar.style.visibility = 'visible';
                    dialog.remove();
                    setLockState(false);
                },

                verify() {
                    if (input.value === CUSTOM_PASSWORD) {
                        handlers.cleanup();
                        resolve(true);
                    } else {
                        input.value = '';
                        Object.assign(input.style, { borderColor: 'red' });
                        input.placeholder = '密码错误，请重试';
                    }
                },

                keyHandler(e) {
                    const focused = document.activeElement === input;
                    if (focused) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handlers.verify();
                        } else if (e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    } else {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            };

            container.append(title, message, input, unlockBtn);
            dialog.appendChild(container);
            document.documentElement.appendChild(dialog);

            const urlbar = document.getElementById('urlbar-container');
            if (urlbar) urlbar.style.visibility = 'hidden';

            document.addEventListener('keydown', handlers.keyHandler, true);
            unlockBtn.addEventListener('click', handlers.verify);
            dialog.addEventListener('cancel', e => e.preventDefault());

            dialog.showModal();
            input.focus();
        });
    }

    const titleObserver = new MutationObserver(() => {
        if (isLocked && document.title !== "Firefox") {
            document.title = "Firefox";
        }
    });
    
    titleObserver.observe(document.querySelector('title') || document.head, {
        childList: true,
        characterData: true,
        subtree: true
    });

    document.addEventListener('keydown', async (e) => {
        if (e.ctrlKey && e.key === 'l' && !isLocked) {
            e.preventDefault();
            setLockState(true);
            try {
                const success = await showPasswordPrompt();
                if (success) console.log('Firefox已解锁');
            } catch {
                console.log('解锁失败');
            }
        }
    });

    if (isLocked) {
        document.title = "Firefox";
        try {
            const success = await showPasswordPrompt();
            if (success) console.log('Firefox启动后已解锁');
        } catch {
            console.log('解锁失败');
        }
    }

    console.log('Firefox锁定脚本已加载，按Ctrl+L锁定浏览器');
})();