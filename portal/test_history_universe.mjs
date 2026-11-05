import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('prototype/app.html', root), 'utf8');
const snapshot = JSON.parse(html.match(/<script id="APPDATA"[^>]*>(.*?)<\/script>/s)[1]);
const names = JSON.parse(readFileSync(new URL('pipeline/daily/meta.json', root), 'utf8')).names;
const source = html.slice(html.indexOf('var D=JSON.parse'), html.lastIndexOf('</script>'));

function browser(saved = {}, search = '') {
  const cats = {};
  for (const [k, meta] of Object.entries(names)) (cats[meta.grp] ??= []).push({ k, ...meta });
  const data = { ...snapshot, cats };
  const elements = new Map();
  const storage = new Map([['kzqj', JSON.stringify(saved)]]);
  const context = {
    URL, URLSearchParams, Date, Set,
    setTimeout: () => 0, clearTimeout: () => {},
    location: { href: `https://traderhome-histroy.xyz/history/${search}`, search },
    history: { replaceState: (_state, _title, path) => { context.lastURL = path; } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: {
      addEventListener: () => {}, querySelectorAll: () => [],
      getElementById(id) {
        if (id === 'APPDATA') return { textContent: JSON.stringify(data) };
        if (!elements.has(id)) elements.set(id, { innerHTML: '', value: '', hidden: false,
          classList: { add() {}, remove() {} } });
        return elements.get(id);
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, storage };
}

test('search resolves canonical tickers, provider codes and aliases across markets', () => {
  const { context: c } = browser();
  for (const [query, symbol] of [['NQ', 'NQ'], ['NQ1!', 'NQ'], ['ES=F', 'ES'], ['^NDX', 'NDX'],
    ['us tech 100', 'NDX'], ['纳指', 'NDX'], ['特斯拉', 'TSLA'], ['PLTR', 'PLTR']]) {
    assert.equal(c.searchSymbols(query)[0].k, symbol, query);
  }
  assert.equal(c.universe().length, 48);
  assert.equal(c.searchSymbols('not-a-symbol').length, 0);
});

test('unknown and legacy custom symbols never borrow another asset', () => {
  const { context: c } = browser({ custom: { stock: [{ k: 'FAKE', tmpl: 'AAPL' }] },
    fav: { l1: { name: 'test', items: [{ k: 'FAKE', grp: 'stock' }, { k: 'NQ', grp: 'stock', tmpl: 'AAPL' }] } } });
  assert.equal(c.catData({ k: 'FAKE', custom: true, tmpl: 'AAPL' }), undefined);
  assert.equal(c.allCats('stock').some(x => x.k === 'FAKE'), false);
  assert.deepEqual(Array.from(c.activeItems(), x => ({ ...x })), [{ k: 'NQ', grp: 'futures' }]);
});

test('direct links select the right market and unresolved links do not show BTC', () => {
  const { context: c } = browser({}, '?symbol=NQ1!');
  assert.equal(c.S.cat, 'NQ');
  assert.equal(c.S.bf, 'futures');
  const { context: unknown } = browser({}, '?symbol=unknown');
  assert.equal(unknown.S.cat, null);
  assert.equal(unknown.S.query, 'unknown');
});

test('cross-market selection updates URL and all-market watchlists', () => {
  const { context: c } = browser();
  c.openByKey('ES');
  assert.equal(c.S.bf, 'futures');
  assert.equal(c.S.cat, 'ES');
  assert.equal(c.lastURL, '/history/?symbol=ES');
  c.toggleFavByKey('ES');
  c.switchBF('crypto');
  assert.equal(c.isFav('ES'), true);
  assert.ok(c.favSection().includes('ES'));
  c.toggleFavByKey('ES');
  assert.equal(c.isFav('ES'), false);
});

test('unavailable instrument and empty search render honest states', () => {
  const { context: c, elements } = browser();
  delete c.D.assets.NQ;
  c.renderAnalysis(c.findSymbol('NQ'));
  assert.ok(elements.get('dmain').innerHTML.includes(c.t('unavailable_note')));
  elements.set('sqi', { value: '<img src=x onerror=alert(1)>' });
  c.onSearch();
  const results = elements.get('search-results').innerHTML;
  assert.ok(results.includes(c.t('resolve_none')));
  assert.equal(results.includes('<img'), false);
  assert.equal(c.healthOf(undefined).status, 'unavailable');
});

test('expired snapshots are never labelled fresh indefinitely', () => {
  const { context: c } = browser();
  const status = c.healthOf({ grp: 'stock', health: { status: 'fresh', asofTimestamp: 1 } });
  assert.equal(status.status, 'stale');
});

test('published statistics always belong to the selected instrument', () => {
  for (const [symbol, asset] of Object.entries(snapshot.assets)) {
    assert.ok(names[symbol], symbol);
    assert.equal(asset.k, symbol);
    assert.equal(asset.chart, symbol);
    assert.equal(asset.last, null);
  }
});
