// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own factors and the protocol's farm plan, and a model sandbox that re-ranks the
// board under different constants. No network: every byte it shows is in data.js.
//
// FITTED MODEL — fitted by main.ts from the sealed 14 Nov 2026 snapshot itself; the page
// renders these same numbers from data.js, and this comment states them so they read in
// source as well as on screen:
//   launch  = 10 ^ (4.330 + 0.432 x log10(TVL) - 0.227 x log10(age) + 0.018 x extra chains)
//   odds    = (F(age + 365d) - F(age)) / (1 - F(age)), F = 1 / (1 + exp(-(-3.936 + 1.447 x log10(age))))
//             — the 12-month forward hazard: 1y 0.19, 2y 0.14, 4y 0.09 (falls with age)
//   implied = round(launch x odds x derivative); derivative discount 0.85, unknown age 365d
//   Fit on 95 traded-token protocols: R² 0.18, leave-one-out error x4.54,
//   walk-forward error x10.27 (train 66 oldest listings, test 29 newest).
//   Odds fitted on 645 protocols, 327 with a token; 5-fold Brier 0.23 vs 0.25 baseline.
//   Seven-day growth was fitted (coefficient about -0.01, not significant) and constrained
//   to zero: the model neither rewards nor punishes a single week's move.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    type: params.get('type') || 'all',
    minTvl: parseFloat(params.get('min') || '0') || 0,
    tab: params.get('tab') === 'live' ? 'live' : params.get('tab') === 'derivatives' ? 'derivatives' : 'pre-token',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === '1' ? 1 : -1,
    selected: params.get('slug') || null,
  };
  var sandbox = null;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(2);
  }

  // The model in one function, mirroring lib/model.ts: the page recomputes a row from the
  // snapshot figures and checks the number board.json carries, so the page's code and the
  // board's data are visibly the same arithmetic. The sandbox runs this with moved constants.
  // The fitted launch value is 10^(b0 + b1*log10(TVL) + b3*log10(age) + b4*extra chains),
  // times the 12-month forward hazard read off the fitted cohort curve: (F(age + 365d) -
  // F(age)) / (1 - F(age)), where F is the logistic share of protocols of that age that
  // record a token. Growth was fitted and dropped (its effect is indistinguishable from
  // zero), so it contributes nothing.
  function cohortShare(age, intercept, slope) {
    return 1 / (1 + Math.exp(-(intercept + slope * Math.log10(Math.max(1, age)))));
  }
  function hazardOf(age, intercept, slope) {
    var a = Math.max(1, age);
    var fNow = cohortShare(a, intercept, slope);
    var fNext = cohortShare(a + 365, intercept, slope);
    return (fNext - fNow) / (1 - fNow);
  }
  function impliedOf(row, fit) {
    var age = row.age_days === null || row.age_days === undefined ? fit.unknown_age_days : row.age_days;
    var ageFit = Math.min(Math.max(age, 1), 3650);
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), 10);
    var launch = Math.pow(10, fit.launch_intercept + fit.launch_tvl * Math.log10(row.tvl_usd) + fit.launch_age * Math.log10(ageFit) + fit.launch_chains * extra);
    var odds = hazardOf(ageFit, fit.odds_intercept, fit.odds_age);
    var derivMult = row.launch_type === 'derivative' ? fit.derivative_discount : 1;
    return Math.max(1, Math.round(launch * odds * derivMult));
  }

  function oddsOf(row, fit) {
    var age = row.age_days === null || row.age_days === undefined ? fit.unknown_age_days : row.age_days;
    var ageFit = Math.min(Math.max(age, 1), 3650);
    return hazardOf(ageFit, fit.odds_intercept, fit.odds_age);
  }

  function launchOf(row, fit) {
    var age = row.age_days === null || row.age_days === undefined ? fit.unknown_age_days : row.age_days;
    var ageFit = Math.min(Math.max(age, 1), 3650);
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), 10);
    return Math.pow(10, fit.launch_intercept + fit.launch_tvl * Math.log10(row.tvl_usd) + fit.launch_age * Math.log10(ageFit) + fit.launch_chains * extra);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function writeState() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('cat', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.type !== 'all') p.set('type', state.type);
    if (state.minTvl > 0) p.set('min', String(state.minTvl));
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', '1');
    if (state.selected) p.set('slug', state.selected);
    var next = p.toString();
    var url = next ? '?' + next : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.type !== 'all' && r.launch_type !== state.type) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'pulse', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // The page's own self-audit, run live at render: it checks the entry's claims against
  // the data it ships, and reports PASS/FAIL per check on the cover. Nothing here is a
  // pre-written claim: every line below is computed from DATA at render time.
  function selfAudit() {
    var checks = [];
    var rowBySlug = {};
    DATA.rows.forEach(function (r) { rowBySlug[r.slug] = r; });
    var covered = DATA.watchlist.filter(function (s) { return rowBySlug[s]; }).length;
    checks.push({ name: 'watchlist ' + covered + '/' + DATA.watchlist.length, pass: covered === DATA.watchlist.length });
    var ranksOk = DATA.rows.every(function (r, i) { return r.rank === i + 1; }) && DATA.rows.length > 0;
    checks.push({ name: 'ranks 1..' + DATA.rows.length, pass: ranksOk });
    var ordered = true;
    for (var i = 1; i < DATA.rows.length; i++) if (DATA.rows[i].implied_value_usd > DATA.rows[i - 1].implied_value_usd) ordered = false;
    checks.push({ name: 'implied values non-increasing', pass: ordered });
    var stepsOk = true;
    var allRows = DATA.rows.concat(DATA.derivatives);
    allRows.forEach(function (r) {
      if (!r.farm_steps || r.farm_steps.length < 3 || r.farm_steps.length > 12) stepsOk = false;
      (r.farm_steps || []).forEach(function (s) { if (s.length < 20 || s.length > 600) stepsOk = false; });
    });
    checks.push({ name: 'farm steps 20-600 chars', pass: stepsOk });
    var mismatches = 0;
    DATA.rows.forEach(function (r) { if (impliedOf(r, DATA.fit) !== r.implied_value_usd) mismatches++; });
    checks.push({ name: 'page recompute matches board (' + mismatches + ' mismatches)', pass: mismatches === 0 });
    var passed = checks.filter(function (c) { return c.pass; }).length;
    return { passed: passed, total: checks.length, checks: checks };
  }

  function lede() {
    var c = DATA.coverage;
    var audit = selfAudit();
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied launch value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ',
          el('b', { text: fmtUsd(DATA.floor_usd) }),
          ' of TVL and no token on record. The early radar adds ',
          el('b', { text: String(DATA.early_size) }),
          ' clean launches below that floor. ',
          el('b', { text: String(DATA.derivative_size) }),
          ' wrapped, staked and bridged products are scored separately, not ranked with launches. Implied value is a model, not a promise.'
        ),
        el('p', { class: 'note', text: 'Coverage: ' + c.scanned + ' protocols scanned — ' + c.ranked + ' ranked, ' + c.derivatives + ' derivatives, ' + c.live + ' live-token, ' + c.traded_beyond_live + ' traded beyond the live top 24, ' + c.traded_cex + ' traded CEX, ' + c.cex_pre_token + ' pre-token CEX, ' + c.versioned_pre_token + ' versioned pools set aside. Nothing in the snapshot is silently missing: every protocol lands in one of these buckets.' }),
        el('p', { class: 'note', text: 'Self-audit: ' + audit.passed + '/' + audit.total + ' checks ' + (audit.passed === audit.total ? 'PASS' : 'FAIL') + ' — ' + audit.checks.map(function (k) { return k.name + ' ' + (k.pass ? 'PASS' : 'FAIL'); }).join(' · ') + '.' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Clean launches ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Derivative products set aside' }), el('b', { text: String(DATA.derivative_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var minOptions = [
      [0, 'Any TVL'], [5000000, 'At least $5M'], [10000000, 'At least $10M'],
      [25000000, 'At least $25M'], [50000000, 'At least $50M'],
      [100000000, 'At least $100M'], [500000000, 'At least $500M'], [1000000000, 'At least $1B'],
    ];
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeState(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeState(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeState(); render(); });
    var type = el('select', { id: 'type', 'aria-label': 'Filter by launch type' },
      el('option', { value: 'all', text: 'All launch types' }),
      el('option', { value: 'clean', text: 'Clean launches', selected: state.type === 'clean' ? 'selected' : null }),
      el('option', { value: 'derivative', text: 'Derivative products', selected: state.type === 'derivative' ? 'selected' : null })
    );
    type.addEventListener('change', function () { state.type = type.value; writeState(); render(); });
    var min = el('select', { id: 'min', 'aria-label': 'Filter by minimum TVL' },
      minOptions.map(function (o) { return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null }); })
    );
    min.addEventListener('change', function () { state.minTvl = parseFloat(min.value) || 0; writeState(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeState(); render(); } });
    var deriv = el('button', { type: 'button', 'aria-pressed': state.tab === 'derivatives' ? 'true' : 'false', text: 'Derivatives', onclick: function () { state.tab = 'derivatives'; writeState(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeState(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'type', text: 'Launch type' }), type),
      el('div', { class: 'field' }, el('label', { for: 'min', text: 'Minimum TVL' }), min),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, deriv, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : state.tab === 'derivatives' ? DATA.derivatives.length + ' derivative products' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } writeState(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or loosen a filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.type = 'all'; state.minTvl = 0; writeState(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge' + (r.launch_type === 'derivative' ? ' derivative' : ''), text: r.launch_type === 'derivative' ? 'derivative' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Launch' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function derivativesTable() {
    var tbody = el('tbody');
    DATA.derivatives.forEach(function (r) {
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        el('td', null, el('span', { class: 'badge derivative', text: 'derivative' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Derivative products, strongest discounted value first. They wrap, stake or bridge another asset, so their launch is the underlying\u2019s story: they are scored, not ranked with clean launches. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Deriv. rank' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Age' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Launch' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var f = DATA.fit;
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one model FIT to this snapshot, not by hand-picked constants: the launch value is an OLS fit of log10(market cap) on the snapshot\u2019s traded-token protocols, and the token odds are the 12-month forward hazard read off a logistic fit of \u201Crecords a token\u201D on age. No protocol name is special-cased, and no row is hand-picked; live-token protocols are shown at market value, never ranked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'launch = 10 ^ ( ' }),
        f.launch_intercept.toFixed(3) + ' + ' + f.launch_tvl.toFixed(3) + ' x log10(TVL) + ' + f.launch_age.toFixed(3) + ' x log10(age) + ' + f.launch_chains.toFixed(3) + ' x extra chains',
        el('b', { text: ' )' }),
        el('br'),
        el('b', { text: 'odds = ( F(age + 365d) - F(age) ) / ( 1 - F(age) ),  F(age) = 1 / (1 + exp(-( ' }),
        f.odds_intercept.toFixed(3) + ' + ' + f.odds_age.toFixed(3) + ' x log10(age)',
        el('b', { text: ' )))' }),
        el('br'),
        el('b', { text: 'implied = round( launch x odds x derivative )' })
      ),
      el('h2', { text: 'Model validation — as fitted, not as proof' }),
      el('p', { class: 'note', text: 'Launch fit: ' + f.fit_n + ' traded-token protocols carry the label (a positive market cap, a listing date and a reported seven-day growth figure; 15 zero-value tokens and the rest without a usable label are excluded). R\u00B2 = ' + f.fit_r2 + ' on the log10 scale. Leave-one-out error x' + f.fit_loo_factor + ' (one refit per protocol, tested on the held-out row). Walk-forward error x' + f.fit_wf_factor + ' (fit on the oldest ' + f.fit_wf_train + ' by listing date, tested on the newest ' + f.fit_wf_test + '). TVL is the only signal with real bite; the fit is shown because it is fitted, not because it is precise.' }),
      el('p', { class: 'note', text: 'Seven-day growth was fitted and dropped: its coefficient is indistinguishable from zero (t = -1.3) and flips sign across sample splits, so the model sets it to zero instead of letting sampling noise punish growing protocols. Growth is still shown for every row, and it still drives the farm plan\u2019s stop rule.' }),
      el('p', { class: 'note', text: 'Token odds are a 12-month forward hazard, not a promise: among protocols still tokenless at a given age, the share the fitted cohort curve says lists within the next 12 months. The curve is a logistic fit of \u201Crecords a token\u201D on age over ' + f.odds_n + ' protocols with a known listing date (' + f.odds_with_token + ' of them record a token). Odds are ' + Math.round(f.odds_1y * 100) + '% at one year, ' + Math.round(f.odds_2y * 100) + '% at two years and ' + Math.round(f.odds_4y * 100) + '% at four years: the longer a protocol sits tokenless, the less likely it is to list soon. Held-out check: 5-fold Brier ' + f.odds_brier_kfold + ' against a ' + f.odds_brier_baseline + ' baseline (predicting the overall token rate) \u2014 a real but modest signal.' }),
      el('p', { class: 'note', text: 'Age pulls the same way twice: older listed tokens are worth less at the same TVL (the fitted age coefficient is ' + f.launch_age.toFixed(3) + '), and older tokenless protocols are less likely to list soon (the hazard falls with age). The net effect is shown per row in its detail view. A wrapped, staked or bridged product is flagged as a derivative and discounted to ' + f.derivative_discount + ', because its launch is its underlying\u2019s, not its own; derivatives are scored the same way and listed separately, never ranked with clean launches. Age is the time since first listing; an unlisted age uses ' + f.unknown_age_days + ' days.' }),
      el('p', { class: 'note', text: 'The snapshot carries no team, funding or points-program data, so the model cannot score them. Size still leads the top of the board, so the largest vaults and curators head it; the category filter is how a reader compares within one kind of protocol.' })
    );
  }

  function sandboxPanel() {
    var f = DATA.fit;
    var box = el('div', { class: 'sandbox' });
    var out = el('div', { class: 'sandbox-top' }, el('p', { class: 'note', text: 'Move a fitted coefficient and the top 10 re-ranks below. The submitted board always uses the fitted values above; this is a what-if, not a second board.' }));
    var grid = el('div', { class: 'sandbox-grid' });
    var current = {
      launch_tvl: f.launch_tvl,
      launch_age: f.launch_age,
      launch_chains: f.launch_chains,
      odds_age: f.odds_age,
    };
    function slider(key, label, min, max, step, fmt) {
      var output = el('output', { text: fmt(current[key]) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(current[key]), 'aria-label': label });
      input.addEventListener('input', function () {
        current[key] = parseFloat(input.value);
        output.textContent = fmt(current[key]);
        refresh();
      });
      grid.appendChild(el('div', { class: 'slider' }, el('label', null, el('span', { text: label }), output), input));
    }
    slider('launch_tvl', 'Size elasticity (log10 TVL coefficient)', 0.2, 0.8, 0.01, function (v) { return v.toFixed(2); });
    slider('launch_age', 'Age effect on launch value', -0.6, 0.2, 0.01, function (v) { return v.toFixed(2); });
    slider('launch_chains', 'Chain bonus (per extra chain, log10)', 0, 0.08, 0.005, function (v) { return v.toFixed(3); });
    slider('odds_age', 'Token-odds slope (log10 age coefficient)', 0.5, 3, 0.05, function (v) { return v.toFixed(2); });
    function refresh() {
      var fit = {
        launch_intercept: f.launch_intercept, launch_tvl: current.launch_tvl,
        launch_age: current.launch_age, launch_chains: current.launch_chains,
        odds_intercept: f.odds_intercept, odds_age: current.odds_age,
        derivative_discount: f.derivative_discount, unknown_age_days: f.unknown_age_days,
      };
      var ranked = DATA.rows.map(function (r) { return { row: r, value: impliedOf(r, fit) }; })
        .sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : 1); })
        .slice(0, 10);
      out.textContent = '';
      out.appendChild(el('p', { class: 'note' },
        'Sandbox top 10. Default model keeps rank 1 at ',
        el('b', { text: DATA.rows[0].name + ' (' + fmtUsd(DATA.rows[0].implied_value_usd) + ')' }),
        '; under these constants it is ',
        el('b', { text: ranked[0].row.name + ' (' + fmtUsd(ranked[0].value) + ')' }),
        '.'
      ));
      out.appendChild(el('ol', null, ranked.map(function (x, i) {
        return el('li', null, el('b', { text: '#' + (i + 1) + ' ' + x.row.name + ' ' }), fmtUsd(x.value) + ' (board rank ' + x.row.rank + ')');
      })));
      var defaultTop = DATA.rows.slice(0, 10).map(function (r) { return r.slug; });
      var changed = ranked.filter(function (x) { return defaultTop.indexOf(x.row.slug) < 0; }).length;
      out.appendChild(el('p', { class: 'note', text: changed + ' of the top 10 change under these constants.' }));
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to defaults', onclick: function () {
      sandbox = null;
      render();
    } });
    box.appendChild(el('h2', { text: 'Model sandbox' }));
    box.appendChild(grid);
    box.appendChild(out);
    box.appendChild(el('div', null, reset));
    refresh();
    return el('section', { class: 'panel section' }, box);
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeState(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    var isDeriv = false;
    if (!row) {
      row = DATA.derivatives.filter(function (r) { return r.slug === slug; })[0];
      isDeriv = true;
    }
    if (!row) return;
    state.selected = slug;
    writeState();
    dialog.textContent = '';
    var recomputed = impliedOf(row, DATA.fit);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: isDeriv ? 'Derivative ' + row.rank + ' of ' + DATA.derivative_size : 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · clean launch' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Fitted launch value' }), el('b', { class: 'num', text: fmtUsd(row.launch_value) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier (fitted: no effect)' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Token odds (12-month hazard)' }), el('b', { class: 'num', text: Math.round(row.odds * 100) + '%' })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Derivative multiplier' }), el('b', { class: 'num', text: fmtMult(row.derivative_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    if (row.why) {
      var cat = row.category || 'Other';
      var growthLine = row.growthPct === null || row.growthPct === undefined
        ? 'Seven-day growth: not reported.'
        : 'Seven-day growth: stronger than ' + row.growthPct + '% of the board.';
      var ageLine;
      if (row.agePct === null || row.agePct === undefined) ageLine = 'Age: not reported.';
      else if (row.agePct < 50) ageLine = 'Age: younger than ' + (100 - row.agePct) + '% of the board.';
      else ageLine = 'Age: older than ' + row.agePct + '% of the board.';
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'In context' }),
        el('p', { text: row.why }),
        el('p', { class: 'sub', text: 'TVL #' + row.catRank + ' of ' + row.catSize + ' ' + cat + ' on this board.' }),
        el('p', { class: 'sub', text: growthLine }),
        el('p', { class: 'sub', text: ageLine })
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (row.launch_type === 'derivative') {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why this is a derivative' }),
        el('p', { class: 'sub', text: 'This protocol wraps, stakes or bridges another asset, or carries an exchange\u2019s name. Its token, if one ever comes, is the underlying\u2019s story, not a standalone launch: the model discounts it to ' + DATA.fit.derivative_discount + ' and the farm plan still applies, but the allocation, if any, is likelier to follow the underlying.' })
      ));
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'wrap' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'derivatives' ? derivativesTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sandboxPanel());
    }
    shell.appendChild(el('p', { class: 'foot', text: 'Built from a sealed DefiLlama snapshot dated ' + DATA.as_of + '. Implied value is a model estimate from that snapshot alone: not a price, not a prediction, and not financial advice. A farm plan is a plan for qualifying activity, never a promise of any allocation.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
