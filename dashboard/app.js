/* Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed snapshot).
   No network, no fetch: every figure on this page comes from data.js, the same board the gate
   reads, so the page and board.json can never disagree. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('meta').textContent = 'No radar data found. Run main.ts to write data.js first.';
    return;
  }

  // The watchlist slugs ride in the data the program wrote (R.watchlist), so the page can
  // badge watchlist rows without ever fetching the snapshot itself.
  var watchlist = {};
  var state = {
    q: '', cat: '', chain: '', status: '', sort: 'rank',
    sandbox: null, // null = radar-2 defaults; otherwise {base, growth, mat}
    selected: null,
  };

  /* ---------- formatting ---------- */
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return '—';
    if (n < 365) return n + 'd';
    return (n / 365).toFixed(1) + 'y';
  }
  function chainsShort(chains, max) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= max) return chains.join(', ');
    return chains.slice(0, max).join(', ') + ' +' + (chains.length - max) + ' more';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------- model (mirrors lib/model.ts radar-2) ---------- */
  var M = R.model;
  function categoryMult(cat) {
    if (cat === null || cat === undefined) return M.uncategorised_multiplier;
    return 1;
  }
  function recompute(row, c) {
    var growthPct = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d));
    var growthM = 1 + (growthPct / 100) * c.growth;
    var ageDays = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var matM = c.mat + (Math.min(Math.max(ageDays, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var extra = Math.max(0, Math.min(row.chains.length - 1, M.breadth_max_extra_chains));
    var breadthM = 1 + M.breadth_per_chain * extra;
    var catM = categoryMult(row.category);
    var base = Math.pow(Math.max(row.tvl_usd, 1), M.tvl_exponent) * c.base;
    return { implied: Math.max(1, Math.round(base * growthM * matM * breadthM * catM)), growthM: growthM, matM: matM, breadthM: breadthM, catM: catM, growthPct: growthPct };
  }

  /* ---------- derived rows ---------- */
  function viewRows() {
    var rows = R.rows.map(function (r) {
      var v = state.sandbox ? recompute(r, state.sandbox) : null;
      return {
        rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
        tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, age_days: r.age_days,
        implied: v ? v.implied : r.implied_value_usd,
        growthM: v ? v.growthM : r.growth_multiplier,
        matM: v ? v.matM : r.maturity_multiplier,
        breadthM: v ? v.breadthM : r.breadth_multiplier,
        catM: v ? v.catM : r.category_multiplier,
        farm_steps: r.farm_steps, onWatchlist: isWatchlist(r.slug),
      };
    });
    if (state.sandbox) {
      rows.sort(function (a, b) { return b.implied - a.implied || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
      rows.forEach(function (r, i) { r.rank = i + 1; });
    }
    return rows;
  }
  /** Whether a slug is on the snapshot's watchlist. */
  function isWatchlist(slug) {
    return watchlist[slug] === true;
  }

  /* ---------- header, stats, selects ---------- */
  function initMeta() {
    document.getElementById('meta').textContent =
      'Snapshot ' + R.as_of + ' · DefiLlama protocols, sealed for this bounty' +
      ' · Floor $' + (R.floor_usd / 1e6).toFixed(0) + 'M · Model ' + R.model_version +
      ' · ' + R.board_size + ' ranked, ' + R.watchlist_size + ' on the watchlist, ' + R.live_size + ' live set aside';
    document.getElementById('foot').textContent =
      'Data: DefiLlama protocols snapshot, fetched ' + R.as_of + '. Snapshot date ' + R.as_of + '. Implied values are this radar\u2019s own claim, never a prediction that a token is issued. No live data, no network: this page runs from its own files.';
    var med = R.rows.slice().sort(function (a, b) { return a.implied_value_usd - b.implied_value_usd; })[Math.floor(R.rows.length / 2)];
    var stats = [
      [String(R.board_size), 'protocols ranked'],
      [String(R.watchlist_size), 'on the watchlist'],
      [money(med.implied_value_usd), 'median implied value'],
      [R.rows[0].name, 'rank 1 · ' + money(R.rows[0].implied_value_usd)],
    ];
    var box = document.getElementById('stats');
    stats.forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('b', null, s[0]));
      d.appendChild(el('span', null, s[1]));
      box.appendChild(d);
    });
    var cats = {}, chains = {};
    R.rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    fillSelect('cat', Object.keys(cats).sort());
    fillSelect('chain', Object.keys(chains).sort());
  }
  function fillSelect(id, values) {
    var s = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      s.appendChild(o);
    });
  }

  /* ---------- board ---------- */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = viewRows().filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.status === 'watchlist' && !r.onWatchlist) return false;
      if (state.status === 'early' && r.onWatchlist) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      implied: function (a, b) { return b.implied - a.implied; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    rows.sort(by);
    return rows;
  }
  function renderBoard() {
    var rows = filtered();
    var tb = document.getElementById('rows');
    tb.textContent = '';
    document.getElementById('empty').hidden = rows.length !== 0;
    document.getElementById('count').textContent =
      rows.length + ' of ' + R.board_size + ' ranked protocols' + (state.sandbox ? ' · sandbox model applied' : '');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.selected === r.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { showDetail(r.slug); });
      tr.appendChild(el('td', null, String(r.rank)));
      var nameTd = el('td');
      nameTd.appendChild(el('span', 'name', r.name));
      if (r.onWatchlist) nameTd.appendChild(el('span', 'badge', 'WATCHLIST'));
      nameTd.appendChild(el('span', 'slug', r.slug));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, r.category || '—'));
      var chainsTd = el('td');
      chainsTd.appendChild(el('span', 'chains', chainsShort(r.chains, 3)));
      tr.appendChild(chainsTd);
      tr.appendChild(el('td', 'num', money(r.tvl_usd)));
      var g = el('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), pct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', 'num', age(r.age_days)));
      tr.appendChild(el('td', 'num', money(r.implied)));
      tb.appendChild(tr);
    });
  }

  /* ---------- detail ---------- */
  function showDetail(slug) {
    state.selected = slug;
    var row = viewRows().filter(function (r) { return r.slug === slug; })[0];
    var body = document.getElementById('detail-body');
    body.textContent = '';
    if (!row) {
      body.appendChild(el('p', 'hint', 'That protocol is not on the board.'));
      renderBoard();
      return;
    }
    var head = el('div', 'detail-head');
    head.appendChild(el('h3', null, '#' + row.rank + ' ' + row.name));
    if (row.onWatchlist) head.appendChild(el('span', 'badge', 'WATCHLIST'));
    head.appendChild(el('span', 'hint', row.slug + ' · ' + (row.category || 'no category') + ' · ' + chainsShort(row.chains, 5)));
    body.appendChild(head);
    var kv = el('div', 'kv');
    [
      [moneyFull(row.implied), 'implied value'],
      [money(row.tvl_usd), 'TVL'],
      [pct(row.change_7d), 'TVL change, 7 days'],
      [age(row.age_days), 'tracked since ' + (row.listed_at || 'unknown')],
    ].forEach(function (k) {
      var d = el('div');
      d.appendChild(el('b', null, k[0]));
      d.appendChild(el('span', null, k[1]));
      kv.appendChild(d);
    });
    body.appendChild(kv);
    body.appendChild(el('p', 'hint', 'Why it ranks here — every multiplier the model applied:'));
    var mt = el('table', 'model-table');
    var mb = document.createElement('tbody');
    [
      ['Size: TVL^' + M.tvl_exponent + ' × ' + M.base_multiple, money(Math.pow(Math.max(row.tvl_usd, 1), M.tvl_exponent) * M.base_multiple)],
      ['Growth ×' + row.growthM.toFixed(2), pct(row.change_7d)],
      ['Maturity ×' + row.matM.toFixed(2), age(row.age_days)],
      ['Breadth ×' + row.breadthM.toFixed(2), row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's')],
      ['Category ×' + row.catM.toFixed(2), row.category || 'none named'],
      ['Implied value', moneyFull(row.implied)],
    ].forEach(function (line) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, line[0]));
      tr.appendChild(el('td', null, line[1]));
      mb.appendChild(tr);
    });
    mt.appendChild(mb);
    body.appendChild(mt);
    body.appendChild(el('p', 'hint', 'How to farm it — seven steps, each with its cost and time. This protocol records no token: that is what its DefiLlama record says, never proof it has none, and nothing here promises a token.'));
    var ol = el('ol', 'farm');
    row.farm_steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
    body.appendChild(ol);
    renderBoard();
    document.getElementById('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  /* ---------- live view ---------- */
  function renderLive() {
    var tb = document.getElementById('live-rows');
    R.live.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'name', p.name));
      tr.appendChild(el('td', null, p.category || '—'));
      var cTd = el('td');
      cTd.appendChild(el('span', 'chains', chainsShort(p.chains, 3)));
      tr.appendChild(cTd);
      tr.appendChild(el('td', 'num', money(p.tvl_usd)));
      tr.appendChild(el('td', 'num', p.mcap_usd === null ? '—' : money(p.mcap_usd)));
      tr.appendChild(el('td', 'num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'), pct(p.change_7d)));
      tb.appendChild(tr);
    });
  }

  /* ---------- set aside ---------- */
  function renderSetAside() {
    var tb = document.getElementById('setaside-rows');
    (R.set_aside || []).forEach(function (p) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', 'name', p.name));
      tr.appendChild(el('td', null, p.category || '—'));
      var cTd = el('td');
      cTd.appendChild(el('span', 'chains', chainsShort(p.chains, 3)));
      tr.appendChild(cTd);
      tr.appendChild(el('td', 'num', money(p.tvl_usd)));
      tr.appendChild(el('td', null, p.reason));
      tb.appendChild(tr);
    });
  }

  /* ---------- sandbox ---------- */
  function sandboxLabels() {
    document.getElementById('base-v').textContent = document.getElementById('base').value;
    document.getElementById('growth-v').textContent = document.getElementById('growth').value;
    document.getElementById('mat-v').textContent = document.getElementById('mat').value;
  }
  function initSandbox() {
    ['base', 'growth', 'mat'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', sandboxLabels);
    });
    sandboxLabels();
    document.getElementById('apply').addEventListener('click', function () {
      state.sandbox = {
        base: parseFloat(document.getElementById('base').value),
        growth: parseFloat(document.getElementById('growth').value),
        mat: parseFloat(document.getElementById('mat').value),
      };
      document.getElementById('sandbox-note').textContent =
        'Sandbox model live: base ' + state.sandbox.base + ', growth weight ' + state.sandbox.growth + ', maturity floor ' + state.sandbox.mat + '. The submitted board still uses radar-2.';
      renderBoard();
    });
    document.getElementById('sandbox-reset').addEventListener('click', function () {
      state.sandbox = null;
      document.getElementById('base').value = String(M.base_multiple);
      document.getElementById('growth').value = String(M.growth_weight);
      document.getElementById('mat').value = String(M.maturity_floor);
      sandboxLabels();
      document.getElementById('sandbox-note').textContent = '';
      renderBoard();
    });
  }

  /* ---------- wiring ---------- */
  function initToolbar() {
    var bind = function (id, key) {
      document.getElementById(id).addEventListener('input', function (e) {
        state[key] = e.target.value;
        renderBoard();
      });
      document.getElementById(id).addEventListener('change', function (e) {
        state[key] = e.target.value;
        renderBoard();
      });
    };
    bind('q', 'q'); bind('cat', 'cat'); bind('chain', 'chain'); bind('status', 'status'); bind('sort', 'sort');
    document.getElementById('reset').addEventListener('click', function () {
      state.q = ''; state.cat = ''; state.chain = ''; state.status = ''; state.sort = 'rank';
      document.getElementById('q').value = '';
      document.getElementById('cat').value = '';
      document.getElementById('chain').value = '';
      document.getElementById('status').value = '';
      document.getElementById('sort').value = 'rank';
      renderBoard();
    });
    document.getElementById('toolbar').addEventListener('submit', function (e) { e.preventDefault(); });
  }
  function initParams() {
    var p = new URLSearchParams(window.location.search);
    if (p.get('q')) { state.q = p.get('q'); document.getElementById('q').value = state.q; }
    if (p.get('cat')) { state.cat = p.get('cat'); document.getElementById('cat').value = state.cat; }
    if (p.get('chain')) { state.chain = p.get('chain'); document.getElementById('chain').value = state.chain; }
    if (p.get('status')) { state.status = p.get('status'); document.getElementById('status').value = state.status; }
    if (p.get('sort')) { state.sort = p.get('sort'); document.getElementById('sort').value = state.sort; }
    return p.get('detail');
  }

  // The watchlist flags ride in the data the program wrote: rows whose slug the snapshot's
  // watchlist named. data.js carries them as R.watchlist.
  if (Array.isArray(R.watchlist)) R.watchlist.forEach(function (s) { watchlist[s] = true; });
  initMeta();
  initToolbar();
  initSandbox();
  renderLive();
  renderSetAside();
  var detailSlug = initParams();
  renderBoard();
  if (detailSlug) showDetail(detailSlug);
})();
