/* The Gazette — renders the whole paper from content.json */
(function () {
  'use strict';

  var D = null;          // the content
  var editions = [];     // all entries, newest first
  var edIdx = 0;         // which edition the front page shows
  var letterIdx = 0;
  var morgueYear = null;
  var PAGES = [
    { code: 'A1', name: 'Front Page' },
    { code: 'A2', name: 'Features' },
    { code: 'A3', name: 'Opinion' },
    { code: 'B1', name: 'The Record' }
  ];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function paras(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }
  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function fmt(iso, opts) {
    var d = parseDate(iso);
    if (!d || isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function year(iso) { return iso ? String(iso).slice(0, 4) : ''; }
  function span(e) {
    var a = year(e.date), b = e.endDate ? year(e.endDate) : 'present';
    return a === b ? a : a + ' – ' + b;
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u) || /^[\w./-]+$/.test(u)) return u;
    return '';
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var KICKER = { certification: 'Certifications', course: 'Courses', project: 'Projects', role: 'Career', education: 'Education', column: 'Opinion', honour: 'Honours' };

  function headline(e) {
    if (e.headline) return e.headline;
    var n = D.site.name;
    switch (e.type) {
      case 'certification': return n + ' Earns ' + e.title;
      case 'course': return n + ' Completes ' + e.title;
      case 'project': return e.title + ' Goes Live';
      case 'role': return n + ' Joins ' + e.org + ' as ' + e.title;
      case 'education': return n + ' Completes ' + e.title + (e.org ? ' at ' + e.org : '');
      case 'column': return 'New Column: “' + e.title + '”';
      case 'honour': return n + ' Receives ' + e.title;
      default: return e.title;
    }
  }
  function tickerLine(e) {
    var n = D.site.name;
    switch (e.type) {
      case 'certification': return n + ' clears ' + e.title + (e.org ? ' — ' + e.org + ' confirms' : '');
      case 'project': return e.title + ' goes live';
      case 'column': return 'New column: “' + e.title + '”';
      case 'role': return n + ' joins ' + e.org;
      case 'honour': return n + ' receives ' + e.title;
      default: return headline(e);
    }
  }
  function isNew(e) {
    var d = parseDate(e.date);
    return d && (Date.now() - d.getTime()) < 45 * 864e5;
  }

  /* ---------- masthead, dateline, ticker ---------- */
  function renderChrome() {
    var s = D.site;
    var brand = 'The ' + s.surname + ' Gazette';
    document.querySelectorAll('[data-brand]').forEach(function (el) { el.textContent = brand; });
    document.title = brand + ' — ' + s.name;
    if (s.accent) document.documentElement.style.setProperty('--red', s.accent);
    $('onDesk').innerHTML = 'Studying ' + esc(s.onDesk && s.onDesk.studying) + '.<br>Reading ' + esc(s.onDesk && s.onDesk.reading) + '.';
    var first = editions.length ? year(editions[editions.length - 1].date) : new Date().getFullYear();
    $('vol').textContent = String(new Date().getFullYear() - (+first) + 1);
    $('profile').textContent = s.profile || '';

    var items = editions.slice(0, 6).map(function (e) { return '<span>' + esc(tickerLine(e)) + '</span><span aria-hidden="true">◆</span>'; }).join('');
    $('tickerRun').innerHTML = '<span class="half">' + items + '</span><span class="half" aria-hidden="true">' + items + '</span>';

    var c = s.contact || {};
    var links = [];
    if (c.email) links.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>');
    if (c.linkedin) links.push('<a href="' + esc(safeUrl(c.linkedin)) + '" rel="noopener">LinkedIn</a>');
    if (c.github) links.push('<a href="' + esc(safeUrl(c.github)) + '" rel="noopener">GitHub</a>');
    if (c.website) links.push('<a href="' + esc(safeUrl(c.website)) + '" rel="noopener">Website</a>');
    $('contact').innerHTML = '<span class="links">Correspondence: ' + links.join(' · ') + '</span><span>© ' + new Date().getFullYear() + ' ' + esc(s.name) + ' · Printed in ' + esc(s.city) + ' · <a class="staff" href="office/">Staff entrance</a></span>';
  }

  function tickClock() {
    $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- A1 front page ---------- */
  function photoHTML(e, caption) {
    var img = safeUrl(e.image);
    return '<figure class="photo' + (img ? ' has-img' : '') + '"><div class="photo-frame">' +
      (img ? '<img src="' + esc(img) + '" alt="' + esc(caption || e.title) + '" loading="lazy">' : '<div class="tone"></div>') +
      '<div class="dots"></div></div><figcaption><span>' + esc(caption || (img ? e.title : 'Photo to come.')) + '</span><b>Hover to develop</b></figcaption></figure>';
  }

  function renderLead() {
    var e = editions[edIdx];
    if (!e) { $('lead').innerHTML = '<p>No stories filed yet.</p>'; return; }
    var no = editions.length - edIdx;
    $('edNo').textContent = String(no);
    $('dateText').textContent = D.site.city + ', ' + fmt(e.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('older').disabled = edIdx >= editions.length - 1;
    $('newer').disabled = edIdx === 0;

    var ps = paras(e.body);
    if (!ps.length) ps = [e.deck || e.title];
    var first = ps[0];
    var body = '<p><span class="city">' + esc(D.site.city.toUpperCase()) + ' — </span><span class="dropcap">' + esc(first.charAt(0)) + '</span>' + esc(first.slice(1)) + '</p>' +
      ps.slice(1, 3).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    var target = e.type === 'column' ? '#A3/' + e.id : '#A2/' + e.id;
    body += '<p style="text-indent:0"><a class="lnk it" style="padding:0" href="' + target + '">Full story continued on page ' + (e.type === 'column' ? 'A3' : 'A2') + ' ▸</a></p>';

    $('lead').innerHTML =
      '<div class="kicker">' + esc(KICKER[e.type] || 'News') + (edIdx ? ' · Back issue' : '') + '</div>' +
      '<h2 class="headline"><span class="hl">' + esc(headline(e)) + '</span></h2>' +
      '<div class="short-rule"></div>' +
      (e.deck ? '<h3 class="deck">' + esc(e.deck) + '</h3>' : '') +
      '<div class="byline">By ' + esc(D.site.name) + ' · ' + esc(fmt(e.date)) + '</div>' +
      '<div class="lead-grid">' + photoHTML(e, e.imageCaption) + '<div class="np-body">' + body + '</div></div>';
  }

  function goEdition(i) {
    i = Math.max(0, Math.min(editions.length - 1, i));
    if (i === edIdx) return;
    var lead = $('lead');
    lead.classList.add('fading');
    setTimeout(function () { edIdx = i; renderLead(); lead.classList.remove('fading'); }, reduced ? 0 : 300);
  }

  function renderInside() {
    $('inside').innerHTML = PAGES.slice(1).map(function (p) {
      return '<a class="idx" href="#' + p.code + '"><span>' + esc(p.name) + '</span><span class="lead-dots"></span><b>' + p.code + '</b></a>';
    }).join('');
  }

  function renderLetters() {
    var L = D.letters || [];
    $('lettersWrap').hidden = !L.length;
    if (!L.length) return;
    var l = L[letterIdx % L.length];
    $('letter').innerHTML = '“' + esc(l.quote) + '”<footer>— ' + esc([l.name, l.title, l.company].filter(Boolean).join(', ')) + '</footer>';
    $('letterDots').innerHTML = L.length > 1 ? L.map(function (_, k) {
      return '<button type="button" aria-label="Letter ' + (k + 1) + '" aria-current="' + (k === letterIdx ? 'true' : 'false') + '" data-letter="' + k + '"><span></span></button>';
    }).join('') : '';
  }
  function showLetter(k) {
    var q = $('letter');
    q.classList.add('off');
    setTimeout(function () { letterIdx = k; renderLetters(); q.classList.remove('off'); }, reduced ? 0 : 450);
  }

  function renderBelow() {
    var arch = D.entries.filter(function (e) { return e.type === 'role' || e.type === 'education'; })
      .sort(function (a, b) { return String(b.date).localeCompare(a.date); });
    $('archives').innerHTML = arch.map(function (e) {
      var ps = paras(e.body);
      var extra = (e.bullets || []).filter(Boolean);
      return '<div class="arch story"><h4><span class="hl">' + esc(e.type === 'role' ? e.title + ', ' + e.org : e.title + ' — ' + e.org) + '</span></h4>' +
        '<div class="meta">' + esc(span(e)) + (e.location ? ' · ' + esc(e.location) : '') + '</div>' +
        '<p>' + esc(ps[0] || e.deck || '') + '</p>' +
        (ps.length > 1 || extra.length ? '<div class="more" hidden>' + ps.slice(1).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
          (extra.length ? '<p>' + extra.map(esc).join(' ') + '</p>' : '') + '</div><button type="button" class="lnk" aria-expanded="false" data-more>Read more ▸</button>' : '') +
        '</div>';
    }).join('') || '<p class="note">Nothing in the archives yet.</p>';

    var certs = D.entries.filter(function (e) { return e.type === 'certification' || e.type === 'course'; })
      .sort(function (a, b) { return String(b.date).localeCompare(a.date); });
    $('notices').innerHTML = certs.map(function (e) {
      var title = esc(e.title) + (e.org ? ' <span style="color:var(--sub)">· ' + esc(e.org) + '</span>' : '');
      var link = safeUrl(e.link);
      return '<div class="notice"><span>' + (link ? '<a href="' + esc(link) + '" rel="noopener">' + title + '</a>' : title) + '</span>' +
        (isNew(e) ? '<span class="stamp">NEW</span>' : '') + '<span class="lead-dots"></span><time>' + esc(fmt(e.date, { month: 'short', year: 'numeric' })) + '</time></div>';
    }).join('') || '<p class="note">No notices yet.</p>';

    $('market').innerHTML = (D.skills || []).map(function (s) {
      var h = (s.history && s.history.length > 1) ? s.history.map(Number) : [1, 1];
      var max = Math.max.apply(null, h.concat([1]));
      var step = 88 / (h.length - 1);
      var pts = h.map(function (v, k) { return (1 + k * step).toFixed(1) + ',' + (20 - (v / max) * 18).toFixed(1); }).join(' ');
      var up = s.trend === 'up';
      return '<tr><td>' + esc(s.name) + '</td><td class="spark"><svg width="90" height="22" viewBox="0 0 90 22" role="img" aria-label="' + (up ? 'Rising' : 'Steady') + '"><polyline points="' + pts + '" fill="none" stroke="currentColor" class="' + (up ? 'up' : 'steady') + '" stroke-width="1.6" stroke-linejoin="round"/></svg></td>' +
        '<td class="mv ' + (up ? 'up' : 'steady') + '">' + (s.years ? esc(s.years) + 'y ' : '') + (up ? '▲' : '—') + '</td></tr>';
    }).join('');
  }

  /* ---------- A2 features ---------- */
  function renderFeature(id) {
    var feats = D.entries.filter(function (e) { return e.type === 'project' || e.featured; })
      .sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.date).localeCompare(a.date); });
    var e = D.entries.find(function (x) { return x.id === id && x.type !== 'column'; }) || feats[0];
    if (!e) { $('feature').innerHTML = '<p class="note">No features yet.</p>'; $('moreFeatures').innerHTML = ''; return; }
    var c = e.case || {};
    var hasCase = c.problem || c.approach || c.result;
    var html = '<div class="label red">A2 · Features · ' + esc(KICKER[e.type] || '') + '</div>' +
      '<h2 class="feature-head">' + esc(e.type === 'project' ? 'Inside ' + e.title : headline(e)) + '</h2>' +
      '<h3 class="feature-deck">' + esc(e.deck || '') + ' <span class="byline" style="display:block;margin:8px 0 0;font-style:normal">By ' + esc(D.site.name) + ' · ' + esc(fmt(e.date)) + '</span></h3>';
    if (hasCase) {
      html += '<div class="case">' + [['The problem', c.problem], ['The approach', c.approach], ['The result', c.result]].filter(function (x) { return x[1]; })
        .map(function (x) { return '<div class="reveal"><div class="label">' + x[0] + '</div><p>' + esc(x[1]) + '</p></div>'; }).join('') + '</div>';
    }
    var ps = paras(e.body);
    if (ps.length && (!hasCase || e.type !== 'project')) html += '<div class="body-cols reveal">' + ps.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
    if (c.quote) html += '<blockquote class="pull reveal">“' + esc(c.quote) + '”</blockquote>';
    var stats = (c.stats || []).filter(function (s) { return s && s.value; });
    var link = safeUrl(e.link);
    html += '<div class="feature-foot reveal">' + photoHTML(e, e.imageCaption) +
      (stats.length || link ? '<div class="numbers"><div class="label ruled">By the numbers</div>' +
        stats.map(function (s) { return '<div class="big">' + esc(s.value) + '</div><div class="small">' + esc(s.label) + '</div>'; }).join('') +
        (link ? '<a class="lnk strong" href="' + esc(link) + '" rel="noopener">' + esc(e.linkLabel || 'Read more') + ' ↗</a>' : '') + '</div>' : '') + '</div>';
    $('feature').innerHTML = html;
    var others = feats.filter(function (x) { return x !== e; });
    $('moreFeatures').innerHTML = others.length ? '<div class="label ruled">More features</div>' + others.map(function (x) {
      return '<a href="#A2/' + esc(x.id) + '">' + esc(x.type === 'project' ? 'Inside ' + x.title : headline(x)) + ' ▸</a>';
    }).join('') : '';
  }

  /* ---------- A3 opinion ---------- */
  function renderOpinion(id) {
    var cols = D.entries.filter(function (e) { return e.type === 'column'; }).sort(function (a, b) { return String(b.date).localeCompare(a.date); });
    var open = id && cols.find(function (c) { return c.id === id; });
    if (open && paras(open.body).length) {
      $('columns').innerHTML = '<div class="column-full"><div class="meta" style="margin-top:12px">' + esc(fmt(open.date)) + (open.minutes ? ' · ' + esc(open.minutes) + ' min read' : '') + '</div>' +
        '<h2 class="feature-head">' + esc(open.title) + '</h2><div class="byline">By ' + esc(D.site.name) + '</div>' +
        paras(open.body).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
        '<p><a class="lnk it" style="padding:0" href="#A3">◂ All columns</a></p></div>';
    } else {
      $('columns').innerHTML = cols.map(function (c) {
        var ext = safeUrl(c.link);
        var href = paras(c.body).length ? '#A3/' + esc(c.id) : (ext ? esc(ext) : '#A3');
        return '<a class="col-card story" href="' + href + '"' + (ext && !paras(c.body).length ? ' rel="noopener"' : '') + '><div class="meta">' + esc(fmt(c.date)) + (c.minutes ? ' · ' + esc(c.minutes) + ' min read' : '') + '</div>' +
          '<h3><span class="hl">' + esc(c.title) + '</span></h3><p class="excerpt">' + esc(c.excerpt || '') + ' <b style="font-style:normal">Read ▸</b></p></a>';
      }).join('') || '<p class="note">The editor has not filed a column yet.</p>';
    }
    var cor = (D.corrections || []).filter(Boolean);
    $('correctionsWrap').hidden = !cor.length;
    $('corrections').innerHTML = cor.map(function (t) { return '<p class="correction">' + esc(t) + '</p>'; }).join('');
  }

  /* ---------- B1 the record ---------- */
  function renderRecord() {
    var count = function (t) { return D.entries.filter(function (e) { return t.indexOf(e.type) > -1; }).length; };
    var sc = [
      [count(['certification', 'course']), 'Certifications'],
      [count(['project']), 'Projects shipped'],
      [count(['column']), 'Columns written'],
      [editions.length, 'Editions printed']
    ];
    $('scoreboard').innerHTML = sc.map(function (s) { return '<div class="score"><div class="n" data-to="' + s[0] + '">0</div><div class="l">' + s[1] + '</div></div>'; }).join('');
    countUp();

    var hon = D.entries.filter(function (e) { return e.type === 'honour'; }).sort(function (a, b) { return String(b.date).localeCompare(a.date); });
    $('honours').innerHTML = hon.map(function (h) {
      return '<div class="honour reveal"><span class="star" aria-hidden="true">✦</span><div><div class="t">' + esc(h.title) + '</div><div class="m">' + esc([h.org, year(h.date)].filter(Boolean).join(' · ')) + '</div></div></div>';
    }).join('') || '<p class="note">No honours filed yet.</p>';

    var years = [];
    editions.forEach(function (e) { var y = year(e.date); if (years.indexOf(y) < 0) years.push(y); });
    if (!morgueYear || years.indexOf(morgueYear) < 0) morgueYear = years[0];
    $('years').innerHTML = years.map(function (y) { return '<button type="button" data-year="' + esc(y) + '" aria-pressed="' + (y === morgueYear) + '">' + esc(y) + '</button>'; }).join('');
    renderMorgue();
  }
  function renderMorgue() {
    $('morgue').innerHTML = editions.map(function (e, i) {
      if (year(e.date) !== morgueYear) return '';
      return '<button type="button" class="morgue-row" data-ed="' + i + '"><b>No. ' + (editions.length - i) + '</b><span>' + esc(headline(e)) + '</span><time>' + esc(fmt(e.date, { day: 'numeric', month: 'short' })) + '</time></button>';
    }).join('');
  }
  function countUp() {
    var els = document.querySelectorAll('#scoreboard .n');
    var t0 = performance.now();
    function step(t) {
      var k = reduced ? 1 : Math.min(1, (t - t0) / 1200), e = 1 - Math.pow(1 - k, 3);
      els.forEach(function (el) { el.textContent = String(Math.round(+el.dataset.to * e)); });
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- routing / page turns ---------- */
  var current = null;
  function route() {
    var h = (location.hash || '#A1').slice(1).split('/');
    var code = PAGES.some(function (p) { return p.code === h[0]; }) ? h[0] : 'A1';
    var sub = h[1] ? decodeURIComponent(h[1]) : null;
    if (code === 'A2') renderFeature(sub);
    if (code === 'A3') renderOpinion(sub);
    if (code === 'B1') renderRecord();
    document.querySelectorAll('.page').forEach(function (sec) {
      var on = sec.dataset.page === code;
      sec.hidden = !on;
      if (on && current !== null && current !== location.hash) {
        sec.classList.remove('turning'); void sec.offsetWidth; sec.classList.add('turning');
      }
    });
    var navHTML = PAGES.map(function (p) { return '<a href="#' + p.code + '"' + (p.code === code ? ' aria-current="page"' : '') + '>' + p.code + ' ' + p.name + '</a>'; }).join('');
    $('miniNav').innerHTML = navHTML;
    $('pagerNums').innerHTML = PAGES.map(function (p) { return '<a href="#' + p.code + '" aria-label="' + p.name + '"' + (p.code === code ? ' aria-current="page"' : '') + '>' + p.code + '</a>'; }).join('');
    var i = PAGES.findIndex(function (p) { return p.code === code; });
    $('prevPage').disabled = i === 0; $('prevPage').dataset.to = PAGES[Math.max(0, i - 1)].code;
    $('nextPage').disabled = i === PAGES.length - 1; $('nextPage').dataset.to = PAGES[Math.min(PAGES.length - 1, i + 1)].code;
    if (current !== null) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    current = location.hash;
    observeReveals();
  }

  /* ---------- scroll effects ---------- */
  var io = null;
  function observeReveals() {
    var els = document.querySelectorAll('.page:not([hidden]) .reveal:not(.in)');
    if (!('IntersectionObserver' in window) || reduced) { els.forEach(function (el) { el.classList.add('in'); }); return; }
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }
  function setupScroll() {
    var bar = $('minibar'), prog = $('progress');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { bar.classList.toggle('on', !es[0].isIntersecting); }).observe($('mastheadRow'));
    } else bar.classList.add('on');
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        var max = document.documentElement.scrollHeight - innerHeight;
        prog.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, scrollY / max) : 0) + ')';
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- extra! returning visitors ---------- */
  function setupExtra() {
    var last = store('gz-last');
    store('gz-last', new Date().toISOString().slice(0, 10));
    if (!last) return;
    var fresh = editions.filter(function (e) { return String(e.date) > last; });
    if (!fresh.length) return;
    $('extraText').innerHTML = 'Since your last visit: <b>' + esc(headline(fresh[0])) + '</b>' + (fresh.length > 1 ? ' and ' + (fresh.length - 1) + ' more' : '') + '.';
    $('extraGo').href = '#A1';
    setTimeout(function () { $('extra').hidden = false; }, 3200);
  }

  /* ---------- events ---------- */
  function wire() {
    $('older').onclick = function () { goEdition(edIdx + 1); };
    $('newer').onclick = function () { goEdition(edIdx - 1); };
    var night = $('nightBtn');
    function syncNight() { night.textContent = document.documentElement.dataset.theme === 'night' ? 'Day edition' : 'Night edition'; }
    night.onclick = function () {
      var n = document.documentElement.dataset.theme === 'night';
      if (n) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'night';
      store('gz-theme', n ? 'day' : 'night'); syncNight();
    };
    syncNight();
    $('prevPage').onclick = function () { location.hash = this.dataset.to; };
    $('nextPage').onclick = function () { location.hash = this.dataset.to; };
    $('extraClose').onclick = function () { $('extra').hidden = true; };
    $('extraGo').onclick = function () { $('extra').hidden = true; edIdx = 0; renderLead(); };
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-letter],[data-more],[data-year],[data-ed]');
      if (!t) return;
      if (t.dataset.letter != null) { showLetter(+t.dataset.letter); restartLetters(); }
      else if (t.hasAttribute('data-more')) {
        var m = t.previousElementSibling, open = m.hidden;
        m.hidden = !open; t.setAttribute('aria-expanded', String(open)); t.textContent = open ? '▴ Fold it back' : 'Read more ▸';
      } else if (t.dataset.year) {
        morgueYear = t.dataset.year;
        document.querySelectorAll('#years button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.year === morgueYear)); });
        var mg = $('morgue'); mg.classList.add('off');
        setTimeout(function () { renderMorgue(); mg.classList.remove('off'); }, reduced ? 0 : 250);
      } else if (t.dataset.ed != null) {
        edIdx = +t.dataset.ed; renderLead(); location.hash = '#A1';
      }
    });
    window.addEventListener('hashchange', route);
  }
  var letterTimer = null;
  function restartLetters() {
    clearInterval(letterTimer);
    if ((D.letters || []).length > 1 && !reduced) letterTimer = setInterval(function () { showLetter((letterIdx + 1) % D.letters.length); }, 7000);
  }

  /* ---------- boot ---------- */
  function boot(data) {
    D = data;
    D.site = D.site || {}; D.entries = (D.entries || []).filter(function (e) { return e && e.title; });
    D.entries.forEach(function (e, i) { if (!e.id) e.id = 'e' + i; });
    editions = D.entries.slice().sort(function (a, b) { return String(b.date).localeCompare(a.date); });
    renderChrome(); renderLead(); renderInside(); renderLetters(); renderBelow();
    tickClock(); setInterval(tickClock, 15000);
    wire(); setupScroll(); route(); restartLetters(); setupExtra();
  }

  function load() {
    var preview = /[?&]preview\b/.test(location.search) && store('gz-preview');
    if (preview) { try { return boot(JSON.parse(preview)); } catch (e) { /* fall through */ } }
    fetch('content.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(boot)
      .catch(function (err) {
        document.getElementById('pages').innerHTML = '<p style="padding:40px 0">The presses jammed — content.json could not be loaded (' + esc(err.message) + '). If you opened this file directly, run it from a web server instead.</p>';
      });
  }
  window.Gazette = { headline: function (e) { return headline(e); } };
  load();
})();
