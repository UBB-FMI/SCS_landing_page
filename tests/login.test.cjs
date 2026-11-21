const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { after, before, test } = require('node:test');
const vm = require('node:vm');

const phpCheck = spawnSync('php', ['-r', "exit(function_exists('str_ends_with') && function_exists('curl_init') ? 0 : 1);"]);
const skip = phpCheck.status === 0 ? false : 'needs the PHP 8+ CLI with the curl extension';

const graphUsers = {
    'ubb-student': { mail: 'student@stud.ubbcluj.ro', tenant: 'ubb' },
    'ubb-staff': { mail: 'staff@ubbcluj.ro', tenant: 'ubb' },
    'other-tenant': { mail: 'student@stud.ubbcluj.ro', tenant: '00000000-0000-0000-0000-000000000001' },
    'tenant-check-denied': { mail: 'student@stud.ubbcluj.ro', tenant: 'denied' },
    'tenant-check-dropped': { mail: 'student@stud.ubbcluj.ro', tenant: 'dropped' },
    'tenant-check-truncated': { mail: 'student@stud.ubbcluj.ro', tenant: 'truncated' },
    'tenant-empty': { mail: 'student@stud.ubbcluj.ro', tenant: 'empty' },
    'tenant-not-json': { mail: 'student@stud.ubbcluj.ro', tenant: 'not-json' },
    'me-truncated': { mail: 'student@stud.ubbcluj.ro', tenant: 'ubb', truncateMe: true }
};
const graphRequests = [];
let graph;
let php;
let phpLog = '';
let workDir;
let loginUrl;
let ubbTenantId;

function freePort() {
    return new Promise((done, fail) => {
        const server = net.createServer();
        server.once('error', fail);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => done(port));
        });
    });
}

function phpRunning() {
    return php.exitCode === null && php.signalCode === null;
}

async function frontendTenant() {
    const location = { href: '', replace: url => { location.href = url; } };
    const context = vm.createContext({
        crypto,
        URL,
        URLSearchParams,
        Date,
        window: { location },
        sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} }
    });
    const source = readFileSync(resolve(__dirname, '../js/oauth-state.js'), 'utf8');
    await vm.runInContext(`${source}\nscsOAuth.start();`, context, { filename: 'js/oauth-state.js' });
    return new URL(location.href).pathname.split('/')[1].toLowerCase();
}

function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

function sendTruncated(request, response) {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
    response.write('{"value":[', () => request.socket.destroy());
}

function answerGraph(request, response) {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    graphRequests.push(`${request.method} ${request.url} ${token}`);
    const user = graphUsers[token];

    if (!user) return sendJson(response, 401, { error: { code: 'InvalidAuthenticationToken' } });
    if (request.url === '/v1.0/me') {
        if (user.truncateMe) return sendTruncated(request, response);
        return sendJson(response, 200, { displayName: 'Test Student', mail: user.mail });
    }
    if (user.tenant === 'denied') return sendJson(response, 403, { error: { code: 'Authorization_RequestDenied' } });
    if (user.tenant === 'dropped') return request.socket.destroy();
    if (user.tenant === 'truncated') return sendTruncated(request, response);
    if (user.tenant === 'empty') return sendJson(response, 200, { value: [] });
    if (user.tenant === 'not-json') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        return response.end('<html>Service Unavailable</html>');
    }
    return sendJson(response, 200, { value: [{ id: user.tenant === 'ubb' ? ubbTenantId : user.tenant }] });
}

async function login(token) {
    const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token })
    });
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`login.php did not answer with JSON:\n${body}`);
    }
}

before(async () => {
    if (skip) return;

    ubbTenantId = await frontendTenant();
    graph = http.createServer(answerGraph);
    await new Promise(done => graph.listen(0, '127.0.0.1', done));
    const graphUrl = `http://127.0.0.1:${graph.address().port}`;

    workDir = mkdtempSync(join(tmpdir(), 'scs-login-'));
    const source = readFileSync(resolve(__dirname, '../login.php'), 'utf8');
    writeFileSync(join(workDir, 'login.php'), source.replaceAll('https://graph.microsoft.com', graphUrl));
    writeFileSync(join(workDir, 'conturi.csv'), [
        'username,password,c2,c3,c4,c5,c6,c7,email',
        'student1,test-password-1,,,,,,,student@stud.ubbcluj.ro',
        'other1,test-password-2,,,,,,,other@stud.ubbcluj.ro'
    ].join('\n'));

    const port = await freePort();
    loginUrl = `http://127.0.0.1:${port}/login.php`;
    php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', workDir], {
        cwd: workDir,
        env: { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    php.stderr.on('data', chunk => { phpLog += chunk; });

    for (let attempt = 1; ; attempt++) {
        if (!phpRunning()) throw new Error(`php -S stopped before it answered:\n${phpLog}`);
        try {
            const response = await fetch(loginUrl, { method: 'POST' });
            assert.deepEqual(await response.json(), { error: 'No access token provided' });
            break;
        } catch (error) {
            if (attempt === 50) throw error;
            await new Promise(done => setTimeout(done, 100));
        }
    }
});

after(async () => {
    if (php && phpRunning()) {
        const exited = new Promise(done => php.once('exit', done));
        php.kill();
        await exited;
    }
    graph?.closeAllConnections();
    graph?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test('returns the credentials of a UBB student', { skip }, async () => {
    const result = await login('ubb-student');
    if (result.error === 'Invalid student account') assert.fail(`login.php refused tenant ${ubbTenantId}, the one js/oauth-state.js signs in with`);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.usernames, ['student1']);
    assert.deepEqual(result.passwords, ['test-password-1']);
    assert.ok(graphRequests.includes('GET /v1.0/organization?$select=id ubb-student'));
});

test('rejects an account from another tenant that claims a UBB address', { skip }, async () => {
    assert.deepEqual(await login('other-tenant'), { error: 'Invalid student account' });
});

test('rejects a UBB account without a student address', { skip }, async () => {
    assert.deepEqual(await login('ubb-staff'), { error: 'Invalid student account' });
});

test('rejects the login when the tenant check fails', { skip }, async () => {
    assert.deepEqual(await login('tenant-check-denied'), { error: 'Failed to verify organization', status: 403 });
    assert.deepEqual(await login('tenant-check-dropped'), { error: 'Failed to verify organization', status: 0 });
    assert.deepEqual(await login('tenant-check-truncated'), { error: 'Failed to verify organization', status: 0 });
});

test('rejects a tenant answer without a tenant id', { skip }, async () => {
    assert.deepEqual(await login('tenant-empty'), { error: 'Invalid student account' });
    assert.deepEqual(await login('tenant-not-json'), { error: 'Invalid student account' });
});

test('keeps rejecting tokens that Microsoft does not accept', { skip }, async () => {
    assert.deepEqual(await login('invalid-token'), { error: 'Failed to fetch user data', status: 401 });
});

test('reports an interrupted profile answer as a failed request', { skip }, async () => {
    assert.deepEqual(await login('me-truncated'), { error: 'Failed to fetch user data', status: 0 });
    assert.ok(graphRequests.includes('GET /v1.0/me me-truncated'));
    assert.ok(!graphRequests.includes('GET /v1.0/organization?$select=id me-truncated'));
});
