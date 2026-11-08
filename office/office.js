/* The Back Office — press-pass login, hub and the private Notebook.
   A notebook day holds several pages; any page can be published as a post to one of the paper's two strips
   ("From The Column" = tech, "Life & Times" = life). Published copies go to the website repo's posts/ folder. */
(function () {
  'use strict';
  var O = window.Office, $ = function (id) { return document.getElementById(id); };
  var cfg = null, gh = null, site = null;
  var months = {}, monthList = null, touched = {}, chains = {}, pending = 0, saveTimer = null;
  var nb = { month: null, tag: 'all', q: '', show: 'all' }; /* show: all | pub | tech | life */
  var page = { date: null, day: null, pg: null, draft: null };
  var SECTIONS = { tech: 'From The Column', life: 'Life & Times' };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function ymOf(s) { return s.slice(0, 7); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmt(s, o) { return parse(s).toLocaleDateString('en-GB', o); }
  function shiftMonth(ym, n) { var d = parse(ym + '-01'); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s)); }
  function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function textOf(e) { return (e && e.text || '').trim(); }
  /* a page has content if it has a title, tags, any written entry, or a post attached */
  function hasContent(p) { return !!p && (!!(p.title || '').trim() || (p.tags || []).length > 0 || (p.entries || []).some(textOf) || !!p.post); }
  function dayHas(d) { return !!d && (d.pages || []).some(hasContent); }
  function words(p) { return (p.entries || []).map(function (e) { return e.text || ''; }).join(' ').trim().split(/\s+/).filter(Boolean).length; }
  function firstText(p) { var e = (p.entries || []).find(textOf); return e ? e.text.trim() : ''; }
  function firstTime(p) { var e = (p.entries || [])[0]; return e && e.t || ''; }
  function live(p) { return !!(p && p.post && p.post.live); }
  function show(id) { ['vHub', 'vNotebook', 'vPage', 'vLoading'].forEach(function (v) { $(v).hidden = v !== id; }); window.scrollTo(0, 0); }
  function setSave(text, err) { var s = $('saveState'); s.textContent = text; s.classList.toggle('err', !!err); }

  /* ---------- notebook storage: one private JSON file per month ----------
     v2: { v: 2, days: { "YYYY-MM-DD": { pages: [ { id, title, tags[], entries[{t,text}], post? } ] } } }
     v1 days ({ title, tags, entries }) are read as a day with one page and written back as v2. */
  function normDay(d) {
    if (!d) return d;
    if (Array.isArray(d.pages)) return d;
    return { pages: [{ id: 'p1', title: d.title || '', tags: d.tags || [], entries: d.entries || [] }] };
  }
  function normMonth(data) {
    data.days = data.days || {};
    Object.keys(data.days).forEach(function (k) { data.days[k] = normDay(data.days[k]); });
    return data;
  }
  function loadMonth(ym) {
    if (months[ym]) return Promise.resolve(months[ym]);
    return gh.getJSON(cfg.notebookRepo, 'pages/' + ym + '.json').then(function (r) {
      normMonth(r.data); months[ym] = r; return r;
    }, function (e) {
      if (e.status === 404) { months[ym] = { sha: null, data: { v: 2, days: {} } }; return months[ym]; }
      throw e;
    });
  }
  function listMonths() {
    if (monthList) return Promise.resolve(monthList);
    return gh.list(cfg.notebookRepo, 'pages').then(function (files) {
      monthList = (Array.isArray(files) ? files : []).map(function (f) { return f.name; })
        .filter(function (n) { return /^\d{4}-\d{2}\.json$/.test(n); }).map(function (n) { return n.slice(0, 7); }).sort().reverse();
      return monthList;
    }, function (e) { if (e.status === 404) { monthList = []; return monthList; } throw e; });
  }
  function loadAll() { return listMonths().then(function (l) { return Promise.all(l.map(loadMonth)); }); }
  /* every page with content, newest day first, later pages in a day first */
  function allPages() {
    var out = [];
    Object.keys(months).forEach(function (ym) {
      var days = months[ym].data.days;
      Object.keys(days).forEach(function (k) {
        (days[k].pages || []).forEach(function (p, i) { if (hasContent(p)) out.push({ date: k, pg: p, i: i }); });
      });
    });
    return out.sort(function (a, b) { return b.date.localeCompare(a.date) || b.i - a.i; });
  }
  function cleaned(data) {
    var out = { v: 2, days: {} };
    Object.keys(data.days).sort().forEach(function (k) {
      var pages = (data.days[k].pages || []).filter(hasContent).map(function (p) {
        var c = { id: p.id, title: (p.title || '').trim(), tags: p.tags || [], entries: (p.entries || []).filter(textOf) };
        if (p.post) c.post = p.post;
        return c;
      });
      if (pages.length) out.days[k] = { pages: pages };
    });
    return out;
  }
  function saveMonth(ym) {
    pending++; setSave('Saving…');
    var run = function (retry) {
      var m = months[ym];
      return gh.putJSON(cfg.notebookRepo, 'pages/' + ym + '.json', cleaned(m.data), m.sha, 'Notebook: ' + ym).then(function (r) {
        m.sha = r.content.sha;
        if (monthList && monthList.indexOf(ym) < 0) { monthList.push(ym); monthList.sort().reverse(); }
      }, function (e) {
        if ((e.status === 409 || e.status === 422) && !retry) {
          // someone saved this month elsewhere: take theirs, keep the days touched here
          var mine = m.data.days;
          return gh.getJSON(cfg.notebookRepo, 'pages/' + ym + '.json').then(function (r) {
            normMonth(r.data);
            Object.keys(touched).forEach(function (k) { if (ymOf(k) === ym) r.data.days[k] = mine[k]; });
            Object.keys(r.data.days).forEach(function (k) { if (r.data.days[k] === undefined) delete r.data.days[k]; });
            m.sha = r.sha; m.data = r.data;
            if (page.date && ymOf(page.date) === ym && r.data.days[page.date]) page.day = r.data.days[page.date];
            return run(true);
          });
        }
        throw e;
      });
    };
    chains[ym] = (chains[ym] || Promise.resolve()).then(function () { return run(false); });
    return chains[ym].then(function () {
      pending--; if (!pending) setSave('✓ Saved · ' + nowHM());
    }, function (e) {
      pending--; setSave('Not saved — ' + e.message, true);
      throw e;
    });
  }
  function dayFor(date, create) {
    var m = months[ymOf(date)];
    var d = m.data.days[date];
    if (!d && create) { d = { pages: [] }; m.data.days[date] = d; }
    return d;
  }

  /* ---------- entrance ---------- */
  function entrance(mode) {
    $('inside').hidden = true; $('entrance').hidden = false;
    $('loginCard').hidden = mode !== 'login'; $('setupCard').hidden = mode !== 'setup';
    setTimeout(function () { (mode === 'login' ? $('lPass') : $('sOwner')).focus(); }, 50);
  }
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault(); $('loginMsg').textContent = 'Checking your pass…';
    O.Vault.unlock($('lPass').value).then(function (c) {
      O.Session.set(c, $('lKeep').checked); $('lPass').value = ''; $('loginMsg').textContent = '';
      var next = null; try { next = sessionStorage.getItem('gz-next'); sessionStorage.removeItem('gz-next'); } catch (e) {}
      if (next === 'desk') { location.href = 'desk/'; return; }
      enter(c);
    }).catch(function (e) { $('loginMsg').textContent = e.message; });
  });
  $('lostBtn').onclick = function () {
    if (!confirm('Forget the press pass on this device? You will set up again with your GitHub token. Your notebook and paper are not affected.')) return;
    O.Vault.clear(); O.Session.clear(); entrance('setup');
  };
  $('setupForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = $('setupMsg');
    if ($('sPass').value !== $('sPass2').value) { msg.textContent = 'The two press passes do not match.'; return; }
    var c = { owner: $('sOwner').value.trim(), branch: $('sBranch').value.trim() || 'main', siteRepo: $('sSite').value.trim(), notebookRepo: $('sNote').value.trim(), token: $('sToken').value.trim() };
    if (c.siteRepo === c.notebookRepo) { msg.textContent = 'The notebook needs its own repository, separate from the website.'; return; }
    var g = new O.GH(c);
    msg.textContent = 'Checking with GitHub…';
    g.repoInfo(c.siteRepo).catch(function (e) { throw new Error('Website repository: ' + e.message); })
      .then(function () { return g.repoInfo(c.notebookRepo).catch(function (e) { throw new Error('Notebook repository: ' + e.message); }); })
      .then(function (r) {
        if (!r.private) throw new Error('Your notebook repository is public. Make it private on GitHub first (Settings → General → Danger Zone → Change visibility), so nobody else can read your pages.');
        return g.list(c.notebookRepo, '').catch(function (e) {
          if (e.status === 404) throw new Error('Your notebook repository is empty. On GitHub, open it and click “Add a README” (any content), then try again.');
          throw e;
        });
      })
      .then(function () { return O.Vault.create(c, $('sPass').value); })
      .then(function () { O.Session.set(c, false); $('sToken').value = $('sPass').value = $('sPass2').value = ''; msg.textContent = ''; enter(c); })
      .catch(function (e) { msg.textContent = e.message; });
  });

  /* ---------- inside ---------- */
  function enter(c) {
    cfg = c; gh = new O.GH(c);
    $('entrance').hidden = true; $('inside').hidden = false;
    if (!location.hash || location.hash === '#login' || location.hash === '#setup') location.hash = '#hub';
    else route();
  }
  $('signOut').onclick = function () {
    if (pending && !confirm('A save is still in progress. Sign out anyway?')) return;
    O.Session.clear(); location.hash = ''; location.reload();
  };
  window.addEventListener('beforeunload', function (e) { if (pending || saveTimer) { e.preventDefault(); e.returnValue = ''; } });

  function route() {
    if (!cfg) return;
    var h = (location.hash || '#hub').slice(1).split('/');
    flushPageSave();
    if (h[0] === 'page' && validDate(h[1] || '')) return openPage(h[1], h[2] || null);
    if (h[0] === 'notebook') return openNotebook(/^\d{4}-\d{2}$/.test(h[1] || '') ? h[1] : null);
    openHub();
  }
  window.addEventListener('hashchange', route);
  function crumb(html) { $('crumb').innerHTML = html ? ' / ' + html : ''; }
  function fail(e) { show('vHub'); setSave(e.message, true); }

  /* ---------- hub ---------- */
  function pageLabel(p) { return p.title || firstText(p) || '(untitled)'; }
  function openHub() {
    crumb(''); show('vHub');
    var h = new Date().getHours();
    var first = site && site.site && site.site.name ? String(site.site.name).split(' ')[0] : '';
    $('hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (first && first.charAt(0) !== '[' ? ', ' + first : '') + '.';
    $('hubDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (site && site.entries) $('deskMeta').textContent = 'Edition No. ' + site.entries.length + ' in print';
    $('nbMeta').textContent = 'Opening…';
    openVis();
    loadAll().then(function () {
      var all = allPages(), pub = all.filter(function (x) { return live(x.pg); }).length;
      $('nbMeta').textContent = all.length ? all.length + ' page' + (all.length === 1 ? '' : 's') + (pub ? ' · ' + pub + ' published' : '') + ' · last written ' + (all[0].date === today() ? 'today' : fmt(all[0].date, { day: 'numeric', month: 'short' })) : 'No pages yet — start today';
      $('recent').innerHTML = all.slice(0, 5).map(function (x) {
        return '<a class="recent-row" href="#page/' + x.date + '/' + esc(x.pg.id) + '"><b>' + esc(fmt(x.date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</b><span>' + esc(pageLabel(x.pg)) + '</span>' + secChip(x.pg) + '</a>';
      }).join('') || '<p class="empty">Nothing yet. Jot a note above, or open today’s page.</p>';
    }).catch(function (e) { $('nbMeta').textContent = e.message; });
  }
  /* ---------- show / hide sections of the paper (settings.json in the website repo) ---------- */
  var VIS = [
    { key: 'tech', name: 'From The Column', cls: 'tech' },
    { key: 'life', name: 'Life & Times', cls: 'life' },
    { key: 'letters', name: 'Letters to the Editor', cls: '' },
    { key: 'corrections', name: 'Corrections', cls: '' }
  ];
  var settings = null; /* { sha, data: { hidden: [] } } */
  function loadSettings() {
    return gh.getJSON(cfg.siteRepo, 'settings.json').then(function (r) {
      r.data = r.data || {}; r.data.hidden = Array.isArray(r.data.hidden) ? r.data.hidden : []; return r;
    }, function (e) { if (e.status === 404) return { sha: null, data: { hidden: [] } }; throw e; });
  }
  function renderVis() {
    var h = settings.data.hidden;
    $('visList').innerHTML = VIS.map(function (v) {
      var on = h.indexOf(v.key) < 0;
      return '<label class="vis-row' + (on ? '' : ' off') + '"><span><span class="vis-name ' + v.cls + '">' + esc(v.name) + '</span>' +
        '<span class="vis-state">' + (on ? 'Shown on the paper' : 'Hidden') + '</span></span>' +
        '<span class="switch"><input type="checkbox" data-vis="' + v.key + '"' + (on ? ' checked' : '') + ' aria-label="Show ' + esc(v.name) + ' on the paper"><span></span></span></label>';
    }).join('');
  }
  function openVis() {
    $('visList').innerHTML = '<p class="vis-note">Checking the paper…</p>';
    $('quoteList').innerHTML = '';
    loadSettings().then(function (r) { settings = r; renderVis(); quoteDraft = null; renderQuotes(); })
      .catch(function (e) { $('visList').innerHTML = '<p class="msg">' + esc(e.message) + '</p>'; });
  }

  /* ---------- quote of the day (settings.json → quotes: [{text, by}]) ---------- */
  var quoteDraft = null, QUOTE_MAX = 120;
  /* the same pick as the paper: day number in Bangalore, modulo the list */
  function todaysQuoteIndex(n) {
    if (!n) return -1;
    var d = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-');
    return Math.floor(Date.UTC(+d[0], +d[1] - 1, +d[2]) / 864e5) % n;
  }
  function renderQuotes() {
    if (!quoteDraft) quoteDraft = (settings.data.quotes || []).map(function (q) { return { text: q.text || '', by: q.by || '' }; });
    var filled = quoteDraft.filter(function (q) { return q.text.trim(); }).length, k = 0;
    var ti = todaysQuoteIndex(filled);
    $('quoteList').innerHTML = quoteDraft.map(function (q, i) {
      var isToday = q.text.trim() && (k++ === ti), len = q.text.trim().length;
      return '<div class="q-row' + (isToday ? ' today' : '') + '"><label>Quote<textarea data-qi="' + i + '" data-qk="text" rows="2" placeholder="Write a quote…">' + esc(q.text) + '</textarea></label>' +
        '<label>By <span class="hint">optional</span><input data-qi="' + i + '" data-qk="by" value="' + esc(q.by) + '" placeholder="Who said it"></label>' +
        '<button type="button" class="btn rm" data-rmq="' + i + '" aria-label="Remove quote ' + (i + 1) + '">Remove</button>' +
        '<div class="q-meta">' + (isToday ? '<span class="q-today">On the paper today</span>' : '') +
        '<span class="' + (len > QUOTE_MAX ? 'long' : '') + '" data-qlen="' + i + '">' + len + ' / ' + QUOTE_MAX + ' characters' + (len > QUOTE_MAX ? ' · may be cut short on the paper' : '') + '</span></div></div>';
    }).join('') || '<p class="vis-note">No quotes yet. Add one and the box beside the masthead will show it.</p>';
  }
  $('quoteList').addEventListener('input', function (ev) {
    var t = ev.target; if (t.dataset.qi == null) return;
    var i = +t.dataset.qi; quoteDraft[i][t.dataset.qk] = t.value;
    $('quoteMsg').className = 'msg'; $('quoteMsg').textContent = 'Unsaved changes';
    if (t.dataset.qk === 'text') {
      var len = t.value.trim().length, el = document.querySelector('[data-qlen="' + i + '"]');
      if (el) { el.textContent = len + ' / ' + QUOTE_MAX + ' characters' + (len > QUOTE_MAX ? ' · may be cut short on the paper' : ''); el.className = len > QUOTE_MAX ? 'long' : ''; }
    }
  });
  $('quoteList').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-rmq]'); if (!b) return;
    quoteDraft.splice(+b.dataset.rmq, 1); renderQuotes();
    $('quoteMsg').className = 'msg'; $('quoteMsg').textContent = 'Unsaved changes';
  });
  $('addQuote').onclick = function () {
    if (!settings) return;
    quoteDraft.push({ text: '', by: '' }); renderQuotes();
    var all = document.querySelectorAll('#quoteList textarea'); if (all.length) all[all.length - 1].focus();
  };
  $('saveQuotes').onclick = function () {
    if (!settings) return;
    var btn = this, quotes = quoteDraft.map(function (q) { return { text: q.text.trim(), by: q.by.trim() }; }).filter(function (q) { return q.text; });
    btn.disabled = true; $('quoteMsg').className = 'msg ok'; $('quoteMsg').textContent = 'Saving…';
    var apply = function (r) {
      var next = Object.assign({}, r.data, { quotes: quotes, updatedAt: new Date().toISOString() });
      return gh.putJSON(cfg.siteRepo, 'settings.json', next, r.sha, 'Quotes of the day: ' + quotes.length)
        .then(function (j) { settings = { sha: j.content.sha, data: next }; });
    };
    apply(settings).catch(function (e) {
      if (e.status === 409 || e.status === 422) return loadSettings().then(apply);
      throw e;
    }).then(function () {
      quoteDraft = null; renderQuotes(); renderVis();
      $('quoteMsg').className = 'msg ok'; $('quoteMsg').textContent = 'Saved ' + quotes.length + ' quote' + (quotes.length === 1 ? '' : 's') + ' · on the paper in about a minute';
    }).catch(function (e) {
      $('quoteMsg').className = 'msg'; $('quoteMsg').textContent = 'Not saved: ' + e.message;
    }).then(function () { btn.disabled = false; });
  };
  $('visList').addEventListener('change', function (ev) {
    var box = ev.target.closest('[data-vis]'); if (!box || !settings) return;
    var key = box.dataset.vis, show = box.checked, name = VIS.find(function (v) { return v.key === key; }).name;
    document.querySelectorAll('[data-vis]').forEach(function (b) { b.disabled = true; });
    $('visMsg').className = 'msg ok'; $('visMsg').textContent = 'Saving…';
    var apply = function (r) {
      var h = r.data.hidden.filter(function (k) { return k !== key; });
      if (!show) h.push(key);
      var next = Object.assign({}, r.data, { hidden: h, updatedAt: new Date().toISOString() });
      return gh.putJSON(cfg.siteRepo, 'settings.json', next, r.sha, (show ? 'Show ' : 'Hide ') + key + ' on the paper')
        .then(function (j) { settings = { sha: j.content.sha, data: next }; });
    };
    apply(settings).catch(function (e) {
      if (e.status === 409 || e.status === 422) return loadSettings().then(apply); /* changed elsewhere: reload and retry once */
      throw e;
    }).then(function () {
      $('visMsg').textContent = name + (show ? ' is back on the paper' : ' is hidden from the paper') + ' · live in about a minute';
    }).catch(function (e) {
      $('visMsg').className = 'msg'; $('visMsg').textContent = 'Not saved: ' + e.message;
    }).then(function () { renderVis(); });
  });

  function secChip(p) { return live(p) ? '<span class="sec ' + esc(p.post.section) + '">' + esc(SECTIONS[p.post.section] || '') + '</span>' : ''; }
  $('quickForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = $('quickText').value.trim(); if (!text) return;
    var t = today(), btn = this.querySelector('button'); btn.disabled = true;
    loadMonth(ymOf(t)).then(function () {
      var d = dayFor(t, true), p = d.pages[d.pages.length - 1];
      if (!p || live(p)) { p = { id: newId(), title: '', tags: [], entries: [] }; d.pages.push(p); }
      p.entries.push({ t: nowHM(), text: text }); touched[t] = 1;
      return saveMonth(ymOf(t));
    }).then(function () { $('quickText').value = ''; $('quickMsg').textContent = 'Added to today’s latest page ✓'; setTimeout(function () { $('quickMsg').textContent = ''; }, 3000); openHub(); })
      .catch(function (e) { $('quickMsg').textContent = ''; setSave('Not saved — ' + e.message, true); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- notebook list ---------- */
  function sheetHTML(x) {
    var p = x.pg, isToday = x.date === today();
    return '<a class="sheet" href="#page/' + x.date + '/' + esc(p.id) + '"><span class="st">' + (isToday ? 'Today' : esc(fmt(x.date, { day: 'numeric', month: 'short' }))) + '</span>' +
      '<div class="dy">' + esc(fmt(x.date, { weekday: 'long', day: 'numeric', month: 'short' })) + (firstTime(p) ? ' · ' + esc(firstTime(p)) : '') + '</div>' +
      (p.title ? '<div class="tt">' + esc(p.title) + '</div>' : '') +
      '<p>' + esc(firstText(p)) + '</p>' +
      '<div class="tg">' + secChip(p) + (p.tags || []).map(function (g) { return '<span class="chip">#' + esc(g) + '</span>'; }).join('') + '</div></a>';
  }
  function openNotebook(ym) {
    crumb('<a href="#notebook">The Notebook</a>');
    nb.month = ym || nb.month || ymOf(today());
    $('todayBtn').href = '#page/' + today() + '/new';
    show('vLoading');
    Promise.all([listMonths(), loadMonth(nb.month)]).then(function () { show('vNotebook'); renderNotebook(); checkOrphans(); }).catch(fail);
  }

  /* ---------- posts on the paper with no notebook page (e.g. ones written straight to the website repo) ----------
     "Add them to the notebook" gives each one a page on its own date, holding the post's text as a single entry and
     marked as published, so Edit post and Unpublish work for it like any other. */
  var orphans = [];
  function checkOrphans() {
    $('adoptBox').hidden = true;
    Promise.all([loadAll(), getIndex()]).then(function (x) {
      var linked = {};
      allPages().forEach(function (y) { if (y.pg.post && y.pg.post.slug) linked[y.pg.post.slug] = 1; });
      orphans = x[1].data.posts.filter(function (p) { return p && p.slug && !linked[p.slug]; });
      if (!orphans.length) return;
      $('adoptText').textContent = orphans.length + ' post' + (orphans.length === 1 ? ' is' : 's are') +
        ' on the paper without a notebook page, so you can’t edit or unpublish ' + (orphans.length === 1 ? 'it' : 'them') + ' from here yet.';
      $('adoptMsg').textContent = '';
      $('adoptBtn').hidden = false;
      $('adoptBox').hidden = false;
    }).catch(function () { /* the notebook still works without this check */ });
  }
  $('adoptBtn').onclick = function () {
    var btn = this, todo = orphans.slice();
    if (!todo.length) return;
    btn.disabled = true; $('adoptMsg').className = 'msg'; $('adoptMsg').textContent = 'Fetching ' + todo.length + ' post' + (todo.length === 1 ? '' : 's') + '…';
    Promise.all(todo.map(function (p) {
      return gh.getJSON(cfg.siteRepo, 'posts/' + p.slug + '.json').then(function (r) { return r.data; });
    })).then(function (posts) {
      var yms = {};
      posts.forEach(function (p) { if (validDate(String(p.date || ''))) yms[ymOf(p.date)] = 1; });
      return Promise.all(Object.keys(yms).map(loadMonth)).then(function () { return posts; });
    }).then(function (posts) {
      var dirty = {}, have = {};
      allPages().forEach(function (y) { if (y.pg.post && y.pg.post.slug) have[y.pg.post.slug] = 1; });
      posts = posts.filter(function (p) { return p && p.slug && !have[p.slug]; }); /* never add the same post twice, e.g. on a retry */
      posts.forEach(function (p) {
        var date = validDate(String(p.date || '')) ? p.date : today();
        var d = dayFor(date, true);
        var tags = (p.tags || []).map(function (t) { return String(t).toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, ''); }).filter(Boolean);
        d.pages.push({
          id: newId(), title: p.title || '', tags: tags,
          entries: [{ t: '', text: String(p.body || p.excerpt || p.title || '').trim() }],
          post: { slug: p.slug, section: p.section === 'life' ? 'life' : 'tech', title: p.title || '', excerpt: p.excerpt || '', tags: p.tags || [],
            include: [0], date: p.date || date, updated: p.updated || p.date || date, live: true }
        });
        touched[date] = 1; dirty[ymOf(date)] = 1;
      });
      return Promise.all(Object.keys(dirty).map(saveMonth)).then(function () { return posts.length; });
    }).then(function (n) {
      orphans = [];
      $('adoptMsg').className = 'msg ok';
      $('adoptMsg').textContent = 'Added ' + n + ' page' + (n === 1 ? '' : 's') + '. Find them under Show → Published.';
      btn.hidden = true; $('adoptText').textContent = 'Every post on the paper now has a notebook page.';
      renderNotebook();
    }).catch(function (e) {
      $('adoptMsg').className = 'msg'; $('adoptMsg').textContent = 'Not added: ' + e.message + ' Nothing on the paper changed; try again.';
    }).then(function () { btn.disabled = false; });
  };
  function renderNotebook() {
    var ym = nb.month, days = months[ym].data.days, t = today();
    $('calTitle').textContent = fmt(ym + '-01', { month: 'long', year: 'numeric' });
    var first = parse(ym + '-01'), lead = (first.getDay() + 6) % 7, n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), cells = '';
    for (var i = 0; i < lead; i++) cells += '<span class="d"></span>';
    for (var d = 1; d <= n; d++) {
      var k = ym + '-' + pad(d), w = dayHas(days[k]), cls = (w ? 'w' : '') + (k === t ? ' today' : '');
      cells += '<a href="#page/' + k + '" class="' + cls + '" aria-label="' + esc(fmt(k, { day: 'numeric', month: 'long' })) + (w ? ', written' : '') + '">' + d + '</a>';
    }
    $('calDays').innerHTML = cells;

    /* searching or showing published pages looks across every month; otherwise just this month */
    var scoped = nb.show !== 'all';
    var list = nb.q || scoped ? allPages() : allPages().filter(function (x) { return ymOf(x.date) === ym; });
    if (nb.q) {
      var q = nb.q.toLowerCase();
      list = list.filter(function (x) {
        var p = x.pg; return (p.title || '').toLowerCase().indexOf(q) > -1 || (p.tags || []).join(' ').toLowerCase().indexOf(q) > -1 ||
          (p.entries || []).some(function (e) { return (e.text || '').toLowerCase().indexOf(q) > -1; });
      });
    }
    if (scoped) list = list.filter(function (x) { return live(x.pg) && (nb.show === 'pub' || x.pg.post.section === nb.show); });
    var showName = { pub: 'Published', tech: 'Published in The Column', life: 'Published in Life & Times' }[nb.show];
    $('nbTitle').textContent = nb.q ? 'Search: “' + nb.q + '”' + (scoped ? ' · ' + showName.toLowerCase() : '') :
      scoped ? showName : fmt(ym + '-01', { month: 'long', year: 'numeric' });
    document.querySelectorAll('#showFilter [data-show]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.show === nb.show)); });
    var tags = {}; list.forEach(function (x) { (x.pg.tags || []).forEach(function (g) { tags[g] = 1; }); });
    if (nb.tag !== 'all' && !tags[nb.tag]) nb.tag = 'all';
    var shown = nb.tag === 'all' ? list : list.filter(function (x) { return (x.pg.tags || []).indexOf(nb.tag) > -1; });
    $('tagFilter').innerHTML = ['all'].concat(Object.keys(tags).sort()).map(function (g) {
      return '<button type="button" data-tag="' + esc(g) + '" aria-pressed="' + (g === nb.tag) + '">' + (g === 'all' ? 'All' : '#' + esc(g)) + '</button>';
    }).join('');
    $('nbCount').textContent = shown.length + ' page' + (shown.length === 1 ? '' : 's') + (nb.tag !== 'all' ? ' tagged #' + nb.tag : '');
    $('sheets').innerHTML = shown.map(sheetHTML).join('') ||
      '<p class="empty">' + (nb.q ? 'Nothing matches.' : scoped ? 'Nothing published here yet. Open a page and press Publish… to put it on the paper.' :
        'No pages this month. <a href="#page/' + (ym === ymOf(t) ? t : ym + '-01') + '/new">Write one</a>.') + '</p>';

    var older = shiftMonth(ym, -1), newer = shiftMonth(ym, 1), earliest = (monthList || []).slice(-1)[0] || ymOf(t);
    $('olderMonth').textContent = '‹ ' + fmt(older + '-01', { month: 'long', year: 'numeric' });
    $('olderMonth').disabled = older < earliest && older < shiftMonth(ymOf(t), -1);
    $('newerMonth').textContent = fmt(newer + '-01', { month: 'long', year: 'numeric' }) + ' ›';
    $('newerMonth').disabled = newer > ymOf(t);
    $('olderMonth').hidden = $('newerMonth').hidden = !!nb.q || scoped;
  }
  $('showFilter').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-show]'); if (!b) return;
    nb.show = b.dataset.show; nb.tag = 'all';
    if (nb.show === 'all') renderNotebook();
    else { $('nbTitle').textContent = 'Gathering published pages…'; loadAll().then(renderNotebook).catch(fail); }
  });
  $('olderMonth').onclick = function () { location.hash = '#notebook/' + shiftMonth(nb.month, -1); };
  $('newerMonth').onclick = function () { location.hash = '#notebook/' + shiftMonth(nb.month, 1); };
  $('prevMonth').onclick = $('olderMonth').onclick;
  $('nextMonth').onclick = function () { if (shiftMonth(nb.month, 1) <= ymOf(today())) $('newerMonth').onclick(); };
  $('tagFilter').addEventListener('click', function (ev) { var b = ev.target.closest('[data-tag]'); if (b) { nb.tag = b.dataset.tag; renderNotebook(); } });
  var searchT = null;
  $('nbSearch').addEventListener('input', function () {
    var v = this.value.trim(); clearTimeout(searchT);
    searchT = setTimeout(function () {
      nb.q = v;
      if (v) loadAll().then(renderNotebook).catch(fail); else renderNotebook();
    }, 250);
  });

  /* ---------- a page (one of several on a day) ---------- */
  function openPage(date, id) {
    crumb('<a href="#notebook/' + ymOf(date) + '">The Notebook</a> / ' + esc(fmt(date, { day: 'numeric', month: 'short', year: 'numeric' })));
    show('vLoading');
    loadMonth(ymOf(date)).then(function () {
      var day = dayFor(date, false) || { pages: [] };
      var pages = day.pages.filter(hasContent);
      var pg = id && id !== 'new' ? day.pages.find(function (p) { return p.id === id; }) : null;
      if (!pg && id !== 'new' && pages.length) pg = pages[pages.length - 1];
      if (!pg) pg = { id: newId(), title: '', tags: [], entries: [] }; /* attached to the day on the first keystroke */
      page.date = date; page.day = day; page.pg = pg; page.draft = null;
      if (id !== pg.id) history.replaceState(null, '', '#page/' + date + '/' + pg.id);
      show('vPage'); renderPage();
    }).catch(fail);
  }
  function renderDayPages() {
    var shown = page.day.pages.filter(function (p) { return hasContent(p) || p === page.pg; });
    if (shown.indexOf(page.pg) < 0) shown.push(page.pg);
    $('dayPages').innerHTML = shown.map(function (p, i) {
      return '<a href="#page/' + page.date + '/' + esc(p.id) + '"' + (p === page.pg ? ' aria-current="page"' : '') + '><span class="dp-time">' + esc(firstTime(p) || (hasContent(p) ? '—' : 'new')) + '</span>' +
        '<span class="dp-title">' + esc(p.title || (hasContent(p) ? firstText(p).slice(0, 40) : 'New page') || 'Page ' + (i + 1)) + '</span>' + secChip(p) + '</a>';
    }).join('') + '<a class="dp-new" href="#page/' + page.date + '/new">＋ New page</a>';
  }
  function renderPage() {
    var date = page.date, p = page.pg, prev = parse(date), next = parse(date);
    prev.setDate(prev.getDate() - 1); next.setDate(next.getDate() + 1);
    $('prevDay').href = '#page/' + iso(prev); $('prevDay').setAttribute('aria-label', 'Previous day');
    $('nextDay').href = '#page/' + iso(next); $('nextDay').setAttribute('aria-label', 'Next day');
    $('nextDay').style.visibility = iso(next) > today() ? 'hidden' : 'visible';
    $('dayTitle').textContent = fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    renderDayPages();
    renderStamp();
    $('pTitle').value = p.title || '';
    $('entries').innerHTML = (p.entries || []).map(function (e, i) {
      return '<div class="entry"><time>' + esc(e.t || '') + '</time><label><span class="sr">Entry at ' + esc(e.t || '') + '</span><textarea data-i="' + i + '" rows="2">' + esc(e.text) + '</textarea></label></div>';
    }).join('') + '<div class="entry"><time id="draftTime">' + (date === today() ? 'now' : '') + '</time><label><span class="sr">New entry</span><textarea id="draft" rows="4" placeholder="' + ((p.entries || []).length ? 'Keep writing…' : 'What’s on your mind?') + '"></textarea></label></div>';
    renderTags();
    document.querySelectorAll('#entries textarea').forEach(autosize);
    updateWords();
    closePublish();
    if (!(p.entries || []).length && date === today()) setTimeout(function () { $('draft').focus(); }, 60);
  }
  function renderStamp() {
    var p = page.pg, st = $('dayStamp');
    if (live(p)) { st.textContent = 'Published · ' + SECTIONS[p.post.section]; st.className = 'stamp ' + p.post.section; }
    else { st.textContent = page.date === today() ? 'Today' : fmt(page.date, { day: 'numeric', month: 'short', year: 'numeric' }); st.className = 'stamp'; }
    $('pubBtn').textContent = live(p) ? 'Edit post…' : 'Publish…';
    $('pubState').innerHTML = live(p) ? 'Live in <b>' + esc(SECTIONS[p.post.section]) + '</b> · <a href="../#A3/' + esc(p.post.slug) + '" target="_blank" rel="noopener">view ↗</a>' : '';
  }
  function renderTags() {
    $('pTags').innerHTML = (page.pg.tags || []).map(function (g, i) {
      return '<span class="chip">#' + esc(g) + '<button type="button" data-rmtag="' + i + '" aria-label="Remove tag ' + esc(g) + '">×</button></span>';
    }).join(' ');
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(64, t.scrollHeight) + 'px'; }
  function updateWords() {
    var n = words(page.pg), k = page.day.pages.filter(hasContent).length;
    $('wordCount').textContent = n + ' word' + (n === 1 ? '' : 's') + (k > 1 ? ' · ' + k + ' pages this day' : '') + ' · saves automatically';
  }
  function changed() {
    var date = page.date, m = months[ymOf(date)];
    if (!m.data.days[date]) m.data.days[date] = page.day;
    if (page.day.pages.indexOf(page.pg) < 0) { page.day.pages.push(page.pg); }
    touched[date] = 1; updateWords();
    setSave('Unsaved changes…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveMonth(ymOf(date)).catch(function () {}); renderDayPages(); }, 1500);
  }
  function flushPageSave() {
    if (saveTimer && page.date) { clearTimeout(saveTimer); saveTimer = null; return saveMonth(ymOf(page.date)); }
    return chains[page.date ? ymOf(page.date) : ''] || Promise.resolve();
  }
  $('entries').addEventListener('input', function (ev) {
    var t = ev.target; if (t.tagName !== 'TEXTAREA') return;
    autosize(t);
    if (t.id === 'draft') {
      if (!page.draft) {
        page.draft = { t: nowHM(), text: '' };
        page.pg.entries = page.pg.entries || []; page.pg.entries.push(page.draft);
        $('draftTime').textContent = page.draft.t;
      }
      page.draft.text = t.value;
    } else page.pg.entries[+t.dataset.i].text = t.value;
    changed();
  });
  $('pTitle').addEventListener('input', function () { page.pg.title = this.value; changed(); });
  $('pTagInput').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ',') return;
    ev.preventDefault();
    var g = this.value.trim().replace(/^#/, '').toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '');
    if (g && (page.pg.tags = page.pg.tags || []).indexOf(g) < 0) { page.pg.tags.push(g); renderTags(); changed(); }
    this.value = '';
  });
  $('pTags').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-rmtag]'); if (!b) return;
    page.pg.tags.splice(+b.dataset.rmtag, 1); renderTags(); changed();
  });
  $('dlPage').onclick = function () {
    var p = page.pg, md = '# ' + fmt(page.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (p.title ? ' — ' + p.title : '') + '\n\n' +
      (p.entries || []).filter(textOf).map(function (e) { return '**' + e.t + '**  \n' + e.text.trim(); }).join('\n\n') +
      ((p.tags || []).length ? '\n\n' + p.tags.map(function (g) { return '#' + g; }).join(' ') : '') + '\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'notebook-' + page.date + (page.day.pages.length > 1 ? '-' + (page.day.pages.indexOf(p) + 1) : '') + '.md'; document.body.appendChild(a); a.click(); a.remove();
  };
  $('delPage').onclick = function () {
    var p = page.pg, ym = ymOf(page.date);
    if (live(p)) { alert('This page is published in ' + SECTIONS[p.post.section] + '. Unpublish it first (Edit post… → Unpublish), then delete it.'); return; }
    if (!hasContent(p)) { location.hash = '#notebook/' + ym; return; }
    if (!confirm('Delete this page' + (p.title ? ' (“' + p.title + '”)' : '') + ' from ' + fmt(page.date, { day: 'numeric', month: 'long', year: 'numeric' }) + '? This cannot be undone from here.')) return;
    clearTimeout(saveTimer); saveTimer = null;
    page.day.pages = page.day.pages.filter(function (x) { return x !== p; });
    if (!dayHas(page.day)) delete months[ym].data.days[page.date];
    touched[page.date] = 1;
    saveMonth(ym).then(function () { location.hash = dayHas(page.day) ? '#page/' + page.date : '#notebook/' + ym; }).catch(function () {});
  };

  /* ---------- publishing a page as a post ----------
     Writes posts/<slug>.json, then posts/index.json in the website repo. The page keeps a record in page.post. */
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  }
  /* shorten at a word boundary, with an ellipsis, so excerpts never end mid-word */
  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var cut = s.slice(0, n), sp = cut.lastIndexOf(' ');
    return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
  }
  function pubSection() { var r = document.querySelector('input[name="pubSec"]:checked'); return r ? r.value : 'tech'; }
  function pubIncluded() {
    return [].slice.call(document.querySelectorAll('#pubEntries input')).filter(function (c) { return c.checked; }).map(function (c) { return +c.value; });
  }
  function openPublish() {
    var p = page.pg, post = p.post || {};
    if (!(p.entries || []).some(textOf)) { alert('Write something on this page first.'); return; }
    var sec = post.section || ((p.tags || []).some(function (t) { return /^(ai|tech|security|infra|infrastructure|code|work|cloud)$/.test(t); }) ? 'tech' : 'life');
    document.querySelectorAll('input[name="pubSec"]').forEach(function (r) { r.checked = r.value === sec; });
    $('pubTitle').value = post.title || p.title || '';
    $('pubSlug').value = post.slug || '';
    $('pubSlug').readOnly = !!post.slug;
    $('pubSlugHint').textContent = post.slug ? 'fixed once published, so shared links keep working' : 'made from the headline; you can change it now';
    $('pubTags').value = post.tags ? post.tags.join(', ') : (p.tags || []).join(', ');
    $('pubEx').value = post.excerpt != null ? post.excerpt : clip(firstText(p), 160);
    var inc = post.include;
    $('pubEntries').innerHTML = (p.entries || []).map(function (e, i) {
      if (!textOf(e)) return '';
      return '<label><input type="checkbox" value="' + i + '"' + (!inc || inc.indexOf(i) > -1 ? ' checked' : '') + '><time>' + esc(e.t || '') + '</time><span>' + esc(e.text.trim().slice(0, 220)) + (e.text.trim().length > 220 ? '…' : '') + '</span></label>';
    }).join('');
    $('pubForm').hidden = false; $('pubMsg').textContent = '';
    $('pubUnpub').hidden = !live(p);
    $('pubH').textContent = live(p) ? 'Edit the published post' : 'Publish this page';
    syncPublish();
    $('pubForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { $('pubTitle').focus(); }, 300);
  }
  function closePublish() { $('pubForm').hidden = true; }
  function syncPublish() {
    var sec = pubSection(), p = page.pg;
    if (!$('pubSlug').readOnly && !$('pubSlug').dataset.edited) $('pubSlug').value = slugify($('pubTitle').value);
    $('pubGo').textContent = (live(p) ? 'Update in ' : 'Publish to ') + SECTIONS[sec];
    $('pubGo').className = 'btn big go-' + sec;
    var inc = pubIncluded(), n = inc.reduce(function (s, i) { return s + p.entries[i].text.trim().split(/\s+/).length; }, 0);
    var tags = $('pubTags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 3);
    $('pubPreview').className = 'pv ' + sec;
    $('pubPreview').innerHTML = '<div class="pv-meta">' + esc(fmt(today(), { day: 'numeric', month: 'short', year: 'numeric' })) + ' · ' + Math.max(1, Math.round(n / 200)) + ' min read</div>' +
      '<div class="pv-title">' + esc($('pubTitle').value || 'Your headline') + '</div>' +
      ($('pubEx').value.trim() ? '<div class="pv-ex">' + esc($('pubEx').value.trim()) + '</div>' : '') +
      (tags.length ? '<div class="pv-tags">' + tags.map(esc).join(' · ') + '</div>' : '');
  }
  $('pubForm').addEventListener('input', function (ev) { if (ev.target.id === 'pubSlug') this.querySelector('#pubSlug').dataset.edited = '1'; syncPublish(); });
  $('pubForm').addEventListener('change', syncPublish);
  $('pubBtn').onclick = function () { if ($('pubForm').hidden) openPublish(); else closePublish(); };
  $('pubCancel').onclick = closePublish;

  function getIndex() {
    return gh.getJSON(cfg.siteRepo, 'posts/index.json').then(function (r) {
      r.data = r.data && Array.isArray(r.data.posts) ? r.data : { posts: [] }; return r;
    }, function (e) { if (e.status === 404) return { sha: null, data: { posts: [] } }; throw e; });
  }
  function fileSha(path) {
    return gh.list(cfg.siteRepo, path).then(function (j) { return j && j.sha || null; }, function (e) { if (e.status === 404) return null; throw e; });
  }
  /* apply fn to the latest index and save it; on a clash with another save, reload and try once more */
  function updateIndex(fn, message) {
    var go = function (retry) {
      return getIndex().then(function (r) {
        r.data.posts = fn(r.data.posts.slice());
        r.data.posts.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
        r.data.updatedAt = new Date().toISOString(); /* the paper shows this as "Last updated" */
        return gh.putJSON(cfg.siteRepo, 'posts/index.json', r.data, r.sha, message);
      }).catch(function (e) { if ((e.status === 409 || e.status === 422) && !retry) return go(true); throw e; });
    };
    return go(false);
  }
  $('pubForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var p = page.pg, msg = $('pubMsg'), btn = $('pubGo');
    var title = $('pubTitle').value.trim(), sec = pubSection(), inc = pubIncluded();
    var slug = $('pubSlug').readOnly ? $('pubSlug').value : slugify($('pubSlug').value || title);
    if (!title) { msg.textContent = 'Give the post a headline.'; $('pubTitle').focus(); return; }
    if (!slug) { msg.textContent = 'The headline needs some letters or numbers for its link.'; return; }
    if (!inc.length) { msg.textContent = 'Tick at least one entry to include.'; return; }
    var first = !live(p);
    if (first && !confirm('Publish “' + title + '” to ' + SECTIONS[sec] + '?\n\nAnyone will be able to read it. Unpublishing later takes it off the site, but copies people already saved cannot be pulled back.')) return;
    var body = inc.map(function (i) { return p.entries[i].text.trim(); }).join('\n\n');
    var tags = $('pubTags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 6);
    var excerpt = $('pubEx').value.trim().slice(0, 240);
    var minutes = Math.max(1, Math.round(body.split(/\s+/).length / 200));
    var date = (p.post && p.post.date) || today(), updated = today();
    btn.disabled = true; msg.textContent = 'Sending to the presses…';
    getIndex().then(function (r) {
      if (!$('pubSlug').readOnly) { /* pick a link nobody else uses */
        var base = slug, n = 2, taken = function (s) { return s === 'life' || s === 'tech' || r.data.posts.some(function (x) { return x.slug === s; }); };
        while (taken(slug)) slug = base + '-' + (n++);
      }
      return fileSha('posts/' + slug + '.json');
    }).then(function (sha) {
      var post = { slug: slug, section: sec, title: title, date: date, updated: updated, excerpt: excerpt, tags: tags, minutes: minutes, body: body };
      return gh.putJSON(cfg.siteRepo, 'posts/' + slug + '.json', post, sha, (first ? 'Column: publish ' : 'Column: update ') + slug);
    }).then(function () {
      var entry = { slug: slug, section: sec, title: title, date: date, updated: updated, excerpt: excerpt, tags: tags, minutes: minutes };
      return updateIndex(function (list) { return list.filter(function (x) { return x.slug !== slug; }).concat([entry]); }, 'Column: list ' + slug);
    }).then(function () {
      p.post = { slug: slug, section: sec, title: title, excerpt: excerpt, tags: tags, include: inc, date: date, updated: updated, live: true };
      changed(); flushPageSave();
      closePublish(); renderStamp(); renderDayPages();
      setSave((first ? 'Published to ' : 'Updated in ') + SECTIONS[sec] + ' · on the paper in about a minute');
    }).catch(function (e) {
      msg.textContent = 'Not published: ' + e.message + ' Nothing on this page was lost; try again.';
    }).then(function () { btn.disabled = false; });
  });
  $('pubUnpub').onclick = function () {
    var p = page.pg, msg = $('pubMsg'), btn = this;
    if (!live(p)) return;
    if (!confirm('Take “' + p.post.title + '” off the paper? It stays here in your notebook, and you can publish it again later.')) return;
    btn.disabled = true; msg.textContent = 'Taking it down…';
    var slug = p.post.slug;
    updateIndex(function (list) { return list.filter(function (x) { return x.slug !== slug; }); }, 'Column: unlist ' + slug)
      .then(function () { return fileSha('posts/' + slug + '.json'); })
      .then(function (sha) { return sha ? gh.del(cfg.siteRepo, 'posts/' + slug + '.json', sha, 'Column: unpublish ' + slug) : null; })
      .then(function () {
        p.post.live = false; changed(); flushPageSave();
        closePublish(); renderStamp(); renderDayPages();
        setSave('Unpublished · gone from the paper in about a minute');
      })
      .catch(function (e) { msg.textContent = 'Not unpublished: ' + e.message; })
      .then(function () { btn.disabled = false; });
  };

  /* ---------- boot ---------- */
  fetch('../content.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
    site = j;
    var brand = j && j.site && j.site.surname ? 'The ' + j.site.surname + ' Gazette' : 'The Gazette';
    document.querySelectorAll('[data-brand]').forEach(function (el) { el.textContent = brand; });
    if (cfg && !$('vHub').hidden) openHub();
  });
  var s = O.Session.get();
  if (s && s.token) enter(s);
  else entrance(O.Vault.exists() ? 'login' : 'setup');
})();
