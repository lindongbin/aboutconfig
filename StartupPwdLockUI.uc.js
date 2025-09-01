(async function () {
    'use strict';

    const CUSTOM_PASSWORD = "123456";

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

    function showPasswordPrompt() {
        return new Promise((resolve) => {
            const dialog = createElement('dialog', {}, styles.dialog);
            const container = createElement('div', {}, styles.container);
            
            const title = createElement('h3', {
                textContent: 'Firefox 密码验证'
            }, { margin: '0', color: 'var(--arrowpanel-color, black)' });

            const message = createElement('p', {
                textContent: '请输入密码以继续使用Firefox:'
            }, { margin: '0', textAlign: 'center' });

            const input = createElement('input', {
                type: 'password',
                placeholder: '输入密码'
            }, styles.input);

            const exitBtn = createElement('button', {
                textContent: '退出'
            }, styles.button);
            
            const handlers = {
                cleanup() {
                    document.removeEventListener('keydown', handlers.keyHandler, true);
                    const urlbar = document.getElementById('urlbar-container');
                    if (urlbar) urlbar.style.visibility = 'visible';
                    dialog.remove();
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
                    if (focused && e.key === 'Enter') {
                        e.preventDefault();
                        handlers.verify();
                    } else if (focused && (e.ctrlKey || e.altKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                    } else if (!focused) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            };

            container.append(title, message, input, exitBtn);
            dialog.appendChild(container);
            document.documentElement.appendChild(dialog);

            const urlbar = document.getElementById('urlbar-container');
            if (urlbar) urlbar.style.visibility = 'hidden';

            document.addEventListener('keydown', handlers.keyHandler, true);
            exitBtn.addEventListener('click', () => {
                handlers.cleanup();
                Services.startup.quit(Services.startup.eForceQuit);
            });
            dialog.addEventListener('cancel', e => e.preventDefault());

            dialog.showModal();
            input.focus();
        });
    }

    try {
        const success = await showPasswordPrompt();
        if (success) console.log('密码验证成功，Firefox已启动');
    } catch {
        Services.startup.quit(Services.startup.eForceQuit);
    }
})();
