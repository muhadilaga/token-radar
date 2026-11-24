// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own factors and the protocol's farm plan, and a model sandbox that re-ranks the
// board under different constants. No network: every byte it shows is in data.js.
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
  function impliedOf(row, model) {
    var size = Math.max(1, Math.round(Math.pow(row.tvl_usd, model.size_power) * model.size_scale));
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var z = (age - model.maturity_peak_days) / model.maturity_spread_days;
    var maturity = model.maturity_floor + model.maturity_peak * Math.exp(-(z * z));
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_bonus_cap);
    var chainMult = 1 + model.chain_bonus * extra;
    var derivMult = row.launch_type === 'derivative' ? model.derivative_discount : 1;
    return Math.max(1, Math.round(size * growthMult * maturity * chainMult * derivMult));
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

  function lede() {
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
        )
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
    var m = DATA.model;
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one function of three snapshot figures only — TVL, seven-day growth and age — with no token on record, no protocol name special-cased, and no row hand-picked; live-token protocols are shown at market value, never ranked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( ' }),
        'tvl ^ ' + m.size_power + ' x ' + m.size_scale + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + m.maturity_peak + ' x exp(-((age - ' + m.maturity_peak_days + ') / ' + m.maturity_spread_days + ')^2)) x (1 + ' + m.chain_bonus + ' x min(chains - 1, ' + m.chain_bonus_cap + ')) x derivative',
        el('b', { text: ' )' })
      ),
      el('p', { class: 'note', text: 'Size is sub-linear: doubling locked value does not double launch value. Growth is clamped, so one wild week cannot carry a row. Maturity is a hump that peaks around two years of track record: very young is unproven, very old has likely decided not to launch. Breadth across chains adds a little. A wrapped, staked or bridged product is flagged as a derivative and discounted to ' + m.derivative_discount + ', because its launch is its underlying\u2019s, not its own; derivatives are scored the same way and listed separately, never ranked with clean launches. Age is the time since first listing; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { class: 'note', text: 'The snapshot carries no team, funding or points-program data, so the model cannot score them. Size and age dominate the top of the board, so the largest vaults and curators lead it; the category filter is how a reader compares within one kind of protocol.' })
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    var box = el('div', { class: 'sandbox' });
    var out = el('div', { class: 'sandbox-top' }, el('p', { class: 'note', text: 'Move a constant and the top 10 re-ranks below. The submitted board always uses the defaults above; this is a what-if, not a second board.' }));
    var grid = el('div', { class: 'sandbox-grid' });
    var current = {
      size_power: m.size_power,
      growth_weight: m.growth_weight,
      maturity_peak_days: m.maturity_peak_days,
      chain_bonus: m.chain_bonus,
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
    slider('size_power', 'Size power (TVL exponent)', 0.3, 0.8, 0.05, function (v) { return v.toFixed(2); });
    slider('growth_weight', 'Growth weight', 0, 1.2, 0.1, function (v) { return v.toFixed(1); });
    slider('maturity_peak_days', 'Maturity peak (days)', 365, 1095, 15, function (v) { return String(Math.round(v)); });
    slider('chain_bonus', 'Chain bonus (per extra chain)', 0, 0.1, 0.01, function (v) { return v.toFixed(2); });
    function refresh() {
      var model = {
        size_power: current.size_power, size_scale: m.size_scale,
        growth_weight: current.growth_weight, growth_floor: m.growth_floor, growth_cap: m.growth_cap,
        maturity_floor: m.maturity_floor, maturity_peak: m.maturity_peak,
        maturity_peak_days: current.maturity_peak_days, maturity_spread_days: m.maturity_spread_days,
        chain_bonus: current.chain_bonus, chain_bonus_cap: m.chain_bonus_cap,
        derivative_discount: m.derivative_discount, unknown_age_days: m.unknown_age_days,
      };
      var ranked = DATA.rows.map(function (r) { return { row: r, value: impliedOf(r, model) }; })
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
    var recomputed = impliedOf(row, DATA.model);
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
        el('div', null, el('span', { text: 'Size value (TVL^power x scale)' }), el('b', { class: 'num', text: fmtUsd(row.size_value) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
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
        el('p', { class: 'sub', text: 'This protocol wraps, stakes or bridges another asset, or carries an exchange\u2019s name. Its token, if one ever comes, is the underlying\u2019s story, not a standalone launch: the model discounts it to ' + DATA.model.derivative_discount + ' and the farm plan still applies, but the allocation, if any, is likelier to follow the underlying.' })
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
