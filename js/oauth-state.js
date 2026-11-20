const scsOAuth = (() => {
    const storageKey = 'scs-oauth-attempt';
    const lifetimeMs = 15 * 60 * 1000;

    function start() {
        const random = crypto.getRandomValues(new Uint8Array(16));
        const state = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem(storageKey, JSON.stringify({ state, startedAt: Date.now() }));

        const url = new URL('https://login.microsoftonline.com/5a4863ed-40c8-4fd5-8298-fbfdb7f13095/oauth2/v2.0/authorize');
        url.search = new URLSearchParams({
            client_id: '7e1568df-899e-4e5f-bbfa-774409e96793',
            redirect_uri: 'https://www.scs.ubbcluj.ro/landing/credentials.html',
            response_type: 'token',
            scope: 'https://graph.microsoft.com/User.Read',
            state
        });
        window.location.replace(url.href);
    }

    function readCallback() {
        const { hash, pathname, search } = window.location;
        if (!hash) return null;

        const params = new URLSearchParams(hash.slice(1));
        history.replaceState(null, '', pathname + search);
        const state = params.get('state');
        if (!state) return null;

        try {
            const attempt = JSON.parse(sessionStorage.getItem(storageKey));
            if (!attempt || attempt.state !== state) return null;

            sessionStorage.removeItem(storageKey);
            const age = Date.now() - attempt.startedAt;
            if (!Number.isFinite(age) || age < 0 || age > lifetimeMs) return null;

            return params.get('access_token');
        } catch {
            return null;
        }
    }

    return { start, readCallback };
})();
