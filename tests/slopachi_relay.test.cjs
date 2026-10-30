// スロパチ中継（api/slopachi.js）の許可リスト・合言葉・取得成功・403の扱い。
const assert = require('node:assert/strict');
const handler = require('../api/slopachi.js');

const realFetch = global.fetch;
const TOKEN = 'test-relay-token';
process.env.SLOPACHI_RELAY_TOKEN = TOKEN;

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
}

async function call(query, options) {
  const res = response();
  await handler({method:(options && options.method) || 'GET', query}, res);
  return {res, json:res.body ? JSON.parse(res.body) : null};
}

let fetched = [];
function mockFetch(impl) {
  fetched = [];
  global.fetch = async (url, options) => {
    fetched.push({url, options});
    return impl(url, options);
  };
}

(async () => {
  // 許可リスト外は取得しない
  mockFetch(async () => ({status:200, text:async () => 'x'}));
  let result = await call({page:'https://evil.example/', token:TOKEN});
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.json.error, 'invalid_page');
  assert.equal(fetched.length, 0);

  // 合言葉違い
  result = await call({page:'kansai', token:'wrong'});
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.json.error, 'unauthorized');
  assert.equal(fetched.length, 0);

  // 正常: 許可されたURLだけを取り、HTMLを返す
  mockFetch(async () => ({status:200, text:async () => '<html>OK</html>'}));
  result = await call({page:'kansai', token:TOKEN});
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.json.status, 200);
  assert.equal(result.json.page, 'kansai');
  assert.equal(result.json.html, '<html>OK</html>');
  assert.ok(result.json.fetchedAt);
  assert.equal(fetched[0].url, 'https://777.slopachi-station.com/report_schedule/kansai/');
  assert.ok(fetched[0].options.headers['User-Agent'].includes('Chrome/136'));
  assert.equal(fetched[0].options.redirect, 'follow');
  assert.ok(result.res.headers['cache-control'].includes('s-maxage=3600'));

  // 取得元403: 中継は200で、JSONのstatusに403を入れる
  mockFetch(async () => ({status:403, text:async () => '<html>403</html>'}));
  result = await call({page:'renjiro', token:TOKEN});
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.json.status, 403);
  assert.equal(result.json.html, '');
  assert.equal(fetched[0].url, 'https://777.slopachi-station.com/renjiro_schedule/');

  // 取得元500もstatusにそのまま入れる
  mockFetch(async () => ({status:500, text:async () => 'error'}));
  result = await call({page:'janjan', token:TOKEN});
  assert.equal(result.json.status, 500);

  // 通信失敗は502
  mockFetch(async () => { throw new Error('boom'); });
  result = await call({page:'ruibee', token:TOKEN});
  assert.equal(result.res.statusCode, 502);
  assert.equal(result.json.error, 'fetch_failed');

  // GET以外は405
  result = await call({page:'kansai', token:TOKEN}, {method:'POST'});
  assert.equal(result.res.statusCode, 405);

  // 環境変数が無いときは設定ミスとして500
  delete process.env.SLOPACHI_RELAY_TOKEN;
  result = await call({page:'kansai', token:TOKEN});
  assert.equal(result.res.statusCode, 500);
  assert.equal(result.json.error, 'relay_not_configured');

  global.fetch = realFetch;
  console.log('PASS: スロパチ中継（許可リスト・合言葉・正常・403・通信失敗）');
})().catch(error => {
  global.fetch = realFetch;
  throw error;
});
