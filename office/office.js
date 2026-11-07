/* The Back Office — press-pass login, hub and the private Notebook */
(function () {
  'use strict';
  var O = window.Office, $ = function (id) { return document.getElementById(id); };
  var cfg = null, gh = null, site = null;
  var months = {}, monthList = null, touched = {}, chains = {}, pending = 0, saveTimer = null;
  var nb = { month: null, tag: 'all', q: '' };
  var page = { date: null, day: null };

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
  function hasContent(d) { return d && ((d.title || '').trim() || (d.tags || []).length || (d.entries || []).some(function (e) { return (e.text || '').trim(); })); }
  function words(d) { return (d.entries || []).map(function (e) { return e.text || ''; }).join(' ').trim().split(/\s+/).filter(Boolean).length; }
  function firstText(d) { var e = (d.entries || []).find(function (x) { return (x.text || '').trim(); }); return e ? e.text.trim() : ''; }
  function show(id) { ['vHub', 'vNotebook', 'vPage', 'vLoading'].forEach(function (v) { $(v).hidden = v !== id; }); window.scrollTo(0, 0); }
  function setSave(text, err) { var s = $('saveState'); s.textContent = text; s.classList.toggle('err', !!err); }

  /* ---------- notebook storage: one private JSON file per month ---------- */
  function loadMonth(ym) {
    if (months[ym]) return Promise.resolve(months[ym]);
    return gh.getJSON(cfg.notebookRepo, 'pages/' + ym + '.json').then(function (r) {
      r.data.days = r.data.days || {}; months[ym] = r; return r;
    }, function (e) {
      if (e.status === 404) { months[ym] = { sha: null, data: { v: 1, days: {} } }; return months[ym]; }
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
  function allDays() {
    var out = [];
    Object.keys(months).forEach(function (ym) {
      var days = months[ym].data.days;
      Object.keys(days).forEach(function (k) { if (hasContent(days[k])) out.push({ date: k, day: days[k] }); });
    });
    return out.sort(function (a, b) { return b.date.localeCompare(a.date); });
  }
  function cleaned(data) {
    var out = { v: 1, days: {} };
    Object.keys(data.days).sort().forEach(function (k) {
      var d = data.days[k]; if (!hasContent(d)) return;
      out.days[k] = { title: (d.title || '').trim(), tags: d.tags || [], entries: (d.entries || []).filter(function (e) { return (e.text || '').trim(); }) };
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
    if (!d && create) { d = { title: '', tags: [], entries: [] }; m.data.days[date] = d; }
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
    if (h[0] === 'page' && validDate(h[1] || '')) return openPage(h[1]);
    if (h[0] === 'notebook') return openNotebook(/^\d{4}-\d{2}$/.test(h[1] || '') ? h[1] : null);
    openHub();
  }
  window.addEventListener('hashchange', route);
  function crumb(html) { $('crumb').innerHTML = html ? ' / ' + html : ''; }
  function fail(e) { show('vHub'); setSave(e.message, true); }

  /* ---------- hub ---------- */
  function openHub() {
    crumb(''); show('vHub');
    var h = new Date().getHours();
    var first = site && site.site && site.site.name ? String(site.site.name).split(' ')[0] : '';
    $('hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (first && first.charAt(0) !== '[' ? ', ' + first : '') + '.';
    $('hubDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (site && site.entries) $('deskMeta').textContent = 'Edition No. ' + site.entries.length + ' in print';
    $('nbMeta').textContent = 'Opening…';
    loadAll().then(function () {
      var all = allDays();
      $('nbMeta').textContent = all.length ? all.length + ' page' + (all.length === 1 ? '' : 's') + ' · last written ' + (all[0].date === today() ? 'today' : fmt(all[0].date, { day: 'numeric', month: 'short' })) : 'No pages yet — start today';
      $('recent').innerHTML = all.slice(0, 5).map(function (x) {
        return '<a class="recent-row" href="#page/' + x.date + '"><b>' + esc(fmt(x.date, { weekday: 'short', day: 'numeric', month: 'short' })) + '</b><span>' + esc(x.day.title || firstText(x.day) || '(untitled)') + '</span></a>';
      }).join('') || '<p class="empty">Nothing yet. Jot a note above, or open today’s page.</p>';
    }).catch(function (e) { $('nbMeta').textContent = e.message; });
  }
  $('quickForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = $('quickText').value.trim(); if (!text) return;
    var t = today(), btn = this.querySelector('button'); btn.disabled = true;
    loadMonth(ymOf(t)).then(function () {
      var d = dayFor(t, true); d.entries.push({ t: nowHM(), text: text }); touched[t] = 1;
      return saveMonth(ymOf(t));
    }).then(function () { $('quickText').value = ''; $('quickMsg').textContent = 'Added to today’s page ✓'; setTimeout(function () { $('quickMsg').textContent = ''; }, 3000); openHub(); })
      .catch(function (e) { $('quickMsg').textContent = ''; setSave('Not saved — ' + e.message, true); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- notebook list ---------- */
  function sheetHTML(x) {
    var d = x.day, isToday = x.date === today();
    return '<a class="sheet" href="#page/' + x.date + '"><span class="st">' + (isToday ? 'Today' : esc(fmt(x.date, { day: 'numeric', month: 'short' }))) + '</span>' +
      '<div class="dy">' + esc(fmt(x.date, { weekday: 'long', day: 'numeric', month: 'short' })) + '</div>' +
      (d.title ? '<div class="tt">' + esc(d.title) + '</div>' : '') +
      '<p>' + esc(firstText(d)) + '</p>' +
      '<div class="tg">' + (d.tags || []).map(function (g) { return '<span class="chip">#' + esc(g) + '</span>'; }).join('') + '</div></a>';
  }
  function openNotebook(ym) {
    crumb('<a href="#notebook">The Notebook</a>');
    nb.month = ym || nb.month || ymOf(today());
    $('todayBtn').href = '#page/' + today();
    show('vLoading');
    Promise.all([listMonths(), loadMonth(nb.month)]).then(function () { show('vNotebook'); renderNotebook(); }).catch(fail);
  }
  function renderNotebook() {
    var ym = nb.month, days = months[ym].data.days, t = today();
    $('calTitle').textContent = fmt(ym + '-01', { month: 'long', year: 'numeric' });
    var first = parse(ym + '-01'), lead = (first.getDay() + 6) % 7, n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), cells = '';
    for (var i = 0; i < lead; i++) cells += '<span class="d"></span>';
    for (var d = 1; d <= n; d++) {
      var k = ym + '-' + pad(d), cls = (hasContent(days[k]) ? 'w' : '') + (k === t ? ' today' : '');
      cells += '<a href="#page/' + k + '" class="' + cls + '" aria-label="' + esc(fmt(k, { day: 'numeric', month: 'long' })) + (hasContent(days[k]) ? ', written' : '') + '">' + d + '</a>';
    }
    $('calDays').innerHTML = cells;

    var list;
    if (nb.q) {
      var q = nb.q.toLowerCase();
      list = allDays().filter(function (x) {
        var d = x.day; return (d.title || '').toLowerCase().indexOf(q) > -1 || (d.tags || []).join(' ').toLowerCase().indexOf(q) > -1 ||
          (d.entries || []).some(function (e) { return (e.text || '').toLowerCase().indexOf(q) > -1; });
      });
      $('nbTitle').textContent = 'Search: “' + nb.q + '”';
    } else {
      list = Object.keys(days).filter(function (k) { return hasContent(days[k]); }).sort().reverse().map(function (k) { return { date: k, day: days[k] }; });
      $('nbTitle').textContent = fmt(ym + '-01', { month: 'long', year: 'numeric' });
    }
    var tags = {}; list.forEach(function (x) { (x.day.tags || []).forEach(function (g) { tags[g] = 1; }); });
    if (nb.tag !== 'all' && !tags[nb.tag]) nb.tag = 'all';
    var shown = nb.tag === 'all' ? list : list.filter(function (x) { return (x.day.tags || []).indexOf(nb.tag) > -1; });
    $('tagFilter').innerHTML = ['all'].concat(Object.keys(tags).sort()).map(function (g) {
      return '<button type="button" data-tag="' + esc(g) + '" aria-pressed="' + (g === nb.tag) + '">' + (g === 'all' ? 'All' : '#' + esc(g)) + '</button>';
    }).join('');
    $('nbCount').textContent = shown.length + ' page' + (shown.length === 1 ? '' : 's') + (nb.tag !== 'all' ? ' tagged #' + nb.tag : '');
    $('sheets').innerHTML = shown.map(sheetHTML).join('') ||
      '<p class="empty">' + (nb.q ? 'Nothing matches.' : 'No pages this month. <a href="#page/' + (ym === ymOf(t) ? t : ym + '-01') + '">Write one</a>.') + '</p>';

    var older = shiftMonth(ym, -1), newer = shiftMonth(ym, 1), earliest = (monthList || []).slice(-1)[0] || ymOf(t);
    $('olderMonth').textContent = '‹ ' + fmt(older + '-01', { month: 'long', year: 'numeric' });
    $('olderMonth').disabled = older < earliest && older < shiftMonth(ymOf(t), -1);
    $('newerMonth').textContent = fmt(newer + '-01', { month: 'long', year: 'numeric' }) + ' ›';
    $('newerMonth').disabled = newer > ymOf(t);
    $('olderMonth').hidden = $('newerMonth').hidden = !!nb.q;
  }
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

  /* ---------- a page ---------- */
  function openPage(date) {
    crumb('<a href="#notebook/' + ymOf(date) + '">The Notebook</a> / ' + esc(fmt(date, { day: 'numeric', month: 'short', year: 'numeric' })));
    show('vLoading');
    loadMonth(ymOf(date)).then(function () {
      page.date = date;
      page.day = dayFor(date, false) || { title: '', tags: [], entries: [] };
      page.draft = null;
      show('vPage'); renderPage();
    }).catch(fail);
  }
  function renderPage() {
    var date = page.date, d = page.day, prev = parse(date), next = parse(date);
    prev.setDate(prev.getDate() - 1); next.setDate(next.getDate() + 1);
    $('prevDay').href = '#page/' + iso(prev); $('prevDay').setAttribute('aria-label', 'Previous day');
    $('nextDay').href = '#page/' + iso(next); $('nextDay').setAttribute('aria-label', 'Next day');
    $('nextDay').style.visibility = iso(next) > today() ? 'hidden' : 'visible';
    $('dayTitle').textContent = fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('dayStamp').textContent = date === today() ? 'Today' : fmt(date, { day: 'numeric', month: 'short', year: 'numeric' });
    $('pTitle').value = d.title || '';
    $('entries').innerHTML = (d.entries || []).map(function (e, i) {
      return '<div class="entry"><time>' + esc(e.t || '') + '</time><label><span class="sr">Entry at ' + esc(e.t || '') + '</span><textarea data-i="' + i + '" rows="2">' + esc(e.text) + '</textarea></label></div>';
    }).join('') + '<div class="entry"><time id="draftTime">' + (date === today() ? 'now' : '') + '</time><label><span class="sr">New entry</span><textarea id="draft" rows="4" placeholder="' + ((d.entries || []).length ? 'Keep writing…' : 'What’s on your mind?') + '"></textarea></label></div>';
    renderTags();
    document.querySelectorAll('#entries textarea').forEach(autosize);
    updateWords();
    if (!(d.entries || []).length && date === today()) setTimeout(function () { $('draft').focus(); }, 60);
  }
  function renderTags() {
    $('pTags').innerHTML = (page.day.tags || []).map(function (g, i) {
      return '<span class="chip">#' + esc(g) + '<button type="button" data-rmtag="' + i + '" aria-label="Remove tag ' + esc(g) + '">×</button></span>';
    }).join(' ');
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(64, t.scrollHeight) + 'px'; }
  function updateWords() { var n = words(page.day); $('wordCount').textContent = n + ' word' + (n === 1 ? '' : 's') + ' · saves automatically as you type'; }
  function changed() {
    var date = page.date, m = months[ymOf(date)];
    if (!m.data.days[date]) m.data.days[date] = page.day;
    touched[date] = 1; updateWords();
    setSave('Unsaved changes…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveMonth(ymOf(date)).catch(function () {}); }, 1500);
  }
  function flushPageSave() {
    if (saveTimer && page.date) { clearTimeout(saveTimer); saveTimer = null; saveMonth(ymOf(page.date)).catch(function () {}); }
  }
  $('entries').addEventListener('input', function (ev) {
    var t = ev.target; if (t.tagName !== 'TEXTAREA') return;
    autosize(t);
    if (t.id === 'draft') {
      if (!page.draft) {
        page.draft = { t: nowHM(), text: '' };
        page.day.entries = page.day.entries || []; page.day.entries.push(page.draft);
        $('draftTime').textContent = page.draft.t;
      }
      page.draft.text = t.value;
    } else page.day.entries[+t.dataset.i].text = t.value;
    changed();
  });
  $('pTitle').addEventListener('input', function () { page.day.title = this.value; changed(); });
  $('pTagInput').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ',') return;
    ev.preventDefault();
    var g = this.value.trim().replace(/^#/, '').toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '');
    if (g && (page.day.tags = page.day.tags || []).indexOf(g) < 0) { page.day.tags.push(g); renderTags(); changed(); }
    this.value = '';
  });
  $('pTags').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-rmtag]'); if (!b) return;
    page.day.tags.splice(+b.dataset.rmtag, 1); renderTags(); changed();
  });
  $('dlPage').onclick = function () {
    var d = page.day, md = '# ' + fmt(page.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (d.title ? ' — ' + d.title : '') + '\n\n' +
      (d.entries || []).filter(function (e) { return (e.text || '').trim(); }).map(function (e) { return '**' + e.t + '**  \n' + e.text.trim(); }).join('\n\n') +
      ((d.tags || []).length ? '\n\n' + d.tags.map(function (g) { return '#' + g; }).join(' ') : '') + '\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = 'notebook-' + page.date + '.md'; document.body.appendChild(a); a.click(); a.remove();
  };
  $('delPage').onclick = function () {
    if (!hasContent(page.day)) { location.hash = '#notebook/' + ymOf(page.date); return; }
    if (!confirm('Delete the whole page for ' + fmt(page.date, { day: 'numeric', month: 'long', year: 'numeric' }) + '? This cannot be undone from here.')) return;
    clearTimeout(saveTimer); saveTimer = null;
    var ym = ymOf(page.date); delete months[ym].data.days[page.date]; touched[page.date] = 1;
    saveMonth(ym).then(function () { location.hash = '#notebook/' + ym; }).catch(function () {});
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
