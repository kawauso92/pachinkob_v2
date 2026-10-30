// スロパチ公式のページを日本（東京リージョン）から取ってくる中継。
// GAS の UrlFetchApp は海外のGoogle網から出るため、スロパチ側の CloudFront に
// 403 で拒否される。この関数だけを hnd1 で動かし、GAS はここを経由する。
//
// GET /api/slopachi?page=kansai
//   ヘッダー X-Relay-Token（ブラウザ確認用に ?token= も可）が
//   環境変数 SLOPACHI_RELAY_TOKEN と一致すること
//   page は許可リストのみ（任意のURLは取れない）
//   戻り値: {status, page, fetchedAt, html}
//     status は取得元のHTTPステータス。403 のときは status:403 をそのまま返す。

const ORIGIN = 'https://777.slopachi-station.com';
const PAGES = {
  kansai: '/report_schedule/kansai/',
  renjiro: '/renjiro_schedule/',
  janjan: '/janjan_schedule/',
  ruibee: '/ruibee_schedule/'
};
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 合言葉をURLに載せないため、CDNにキャッシュさせない（1日1回の取得なので不要）
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(body));
}

// 合言葉はヘッダー優先。ブラウザでの確認用に token クエリも受け付ける。
function tokenOf(req, query) {
  const headers = req.headers || {};
  const header = headers['x-relay-token'] || headers['X-Relay-Token'];
  if (header) return String(Array.isArray(header) ? header[0] : header);
  return String(query.token || '');
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const query = {};
    url.searchParams.forEach((value, key) => { query[key] = value; });
    return query;
  } catch (error) {
    return {};
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, {error:'method_not_allowed'});
  }
  const query = queryOf(req);
  const page = String(query.page || '');
  if (!Object.prototype.hasOwnProperty.call(PAGES, page)) {
    return send(res, 400, {error:'invalid_page'});
  }
  const expected = process.env.SLOPACHI_RELAY_TOKEN || '';
  if (!expected) {
    return send(res, 500, {error:'relay_not_configured'});
  }
  if (tokenOf(req, query) !== expected) {
    return send(res, 401, {error:'unauthorized'});
  }

  const target = ORIGIN + PAGES[page];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (error) {
    return send(res, 502, {status:0, page, fetchedAt:new Date().toISOString(), error:'fetch_failed'});
  } finally {
    clearTimeout(timer);
  }

  let html = '';
  try {
    html = await upstream.text();
  } catch (error) {
    html = '';
  }
  const status = Number(upstream.status) || 0;
  const ok = status >= 200 && status < 300;
  return send(res, 200, {status, page, fetchedAt:new Date().toISOString(), html: ok ? html : ''});
};
