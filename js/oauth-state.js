const loginLink = document.getElementById('login-link');

function getLoginState() {
    const savedState = localStorage.getItem('oauth_state');

    if (savedState) {
        return savedState;
    }

    const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
    localStorage.setItem('oauth_state', state);
    return state;
}

function prepareLogin() {
    try {
        const url = new URL(loginLink.href);
        url.searchParams.set('state', getLoginState());
        loginLink.href = url.href;
    } catch (error) {
        console.error('Could not prepare login:', error);
    }
}

prepareLogin();

for (const eventName of ['click', 'auxclick', 'contextmenu']) {
    loginLink.addEventListener(eventName, prepareLogin);
}
