const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const storage = () => {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
};
let options;
const context = {
  window: {MORLYN_BACKEND: {url: 'https://test.supabase.co', publishableKey: 'sb_publishable_test'}, supabase: {createClient: (_, __, settings) => { options = settings; return {}; }}},
  URL, localStorage: storage(), sessionStorage: storage(), location: {hostname: 'localhost', port: '4173', protocol: 'http:', origin: 'http://localhost:4173'},
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8'), context);
test('YouTube normalizes supported links without accepting another host or script', () => {
  const parser = context.window.morlynYouTube.id;
  for (const url of ['https://youtu.be/dQw4w9WgXcQ?t=3', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) assert.equal(parser(url), 'dQw4w9WgXcQ');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.attacker.test/watch?v=dQw4w9WgXcQ', 'https://attacker.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/playlist?list=x', 'https://youtube.com/watch?v=bad', 'https://user@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:444/watch?v=dQw4w9WgXcQ']) assert.throws(() => parser(url));
  assert.throws(() => context.window.morlynYouTube.embed('<script>'));
  assert.match(context.window.morlynYouTube.embed('dQw4w9WgXcQ'), /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
});
test('remember me selects one storage and signout clears both', () => {
  const auth = options.auth.storage;
  auth.setItem('token', 'tab'); assert.equal(context.sessionStorage.getItem('token'), 'tab'); assert.equal(context.localStorage.getItem('token'), null);
  context.window.morlynRememberSession(true);
  auth.setItem('token', 'remembered'); assert.equal(context.localStorage.getItem('token'), 'remembered'); assert.equal(context.sessionStorage.getItem('token'), null);
  assert.equal(auth.getItem('token'), 'remembered');
  auth.removeItem('token'); assert.equal(context.localStorage.getItem('token'), null); assert.equal(context.sessionStorage.getItem('token'), null);
});
