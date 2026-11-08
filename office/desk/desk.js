/* The Editor's Desk — edits the paper's content.json and publishes it to the website repository.
   Uses the Back Office login session (see ../session.js). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var O = window.Office;
  var cfg = O.Session.get();
  if (!cfg || !cfg.token) { try { sessionStorage.setItem('gz-next', 'desk'); } catch (e) {} location.replace('../'); return; }
  var gh = new O.GH(cfg), REPO = cfg.siteRepo;
  var D = null, sha = null, dirty = false, changes = [];

  /* ---------- utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function set(o, path, v) { var ks = path.split('.'), last = ks.pop(); ks.forEach(function (k) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[last] = v; }
  function slug(s) { return String(s || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'story'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function status(text, isDirty) { var s = $('status'); s.textContent = text; s.classList.toggle('dirty', !!isDirty); }
  function markDirty(what) { dirty = true; if (what) changes.push(what); status('Unpublished changes — press “Publish edition”.', true); }

  /* ---------- GitHub ---------- */
  function load() {
    return gh.getJSON(REPO, 'content.json').then(function (r) { sha = r.sha; return r.data; });
  }
  function publish() {
    var btn = $('publishBtn'); btn.disabled = true; status('Sending to the presses…');
    var msg = 'Edition: ' + (changes.length ? changes.slice(-3).join('; ') : 'updates') + ' (' + today() + ')';
    D.site = D.site || {}; D.site.updatedAt = new Date().toISOString(); /* the paper shows this as "Last updated" */
    gh.putJSON(REPO, 'content.json', D, sha, msg).then(function (j) {
      sha = j.content.sha; dirty = false; changes = [];
      status('Published. The paper updates in about a minute.');
    }).catch(function (e) {
      status('Not published: ' + e.message + (e.status === 409 || e.status === 422 ? ' Reload the desk and try again.' : ''), true);
    }).then(function () { btn.disabled = false; });
  }
  function uploadImage(file) {
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('That image is over 4 MB. Please resize it first.'));
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    }).then(function (b64) {
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      var path = 'images/' + today() + '-' + slug(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      return gh.put(REPO, path, b64, null, 'Add image ' + path).then(function () { return path; });
    });
  }

  $('signOut').onclick = function () {
    if (dirty && !confirm('You have unpublished changes. Sign out anyway and lose them?')) return;
    dirty = false; O.Session.clear(); location.href = '../';
  };
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function openDesk(data) {
    D = data; D.site = D.site || {}; D.entries = D.entries || []; D.skills = D.skills || []; D.letters = D.letters || []; D.corrections = D.corrections || [];
    $('connInfo').textContent = 'Connected to ' + cfg.owner + '/' + REPO + ' (' + cfg.branch + ').';
    renderAll();
  }

  /* ---------- tabs ---------- */
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tab]'); if (!b) return;
    document.querySelectorAll('#tabs [data-tab]').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
  });

  /* ---------- stories ---------- */
  var ORG = { certification: 'Issuer', course: 'Provider', project: 'Client or company (optional)', role: 'Company', education: 'University or school', honour: 'Awarded by', column: 'Published in (optional)' };
  var DATE = { role: 'Start date', education: 'Start date', column: 'Published on' };
  var F = [
    { k: 'title', label: 'Title', type: 'text', req: true, hintBy: { role: 'Your job title', education: 'Degree', column: 'Headline of your column' } },
    { k: 'org', label: 'Organisation', type: 'text' },
    { k: 'date', label: 'Date', type: 'date', req: true },
    { k: 'endDate', label: 'End date', type: 'date', only: ['role', 'education'], hint: 'Leave empty if this is current.' },
    { k: 'location', label: 'Location', type: 'text', only: ['role', 'education'] },
    { k: 'credentialId', label: 'Credential ID', type: 'text', only: ['certification', 'course'] },
    { k: 'deck', label: 'Sub-headline', type: 'text', full: true, hint: 'One line shown under the headline.' },
    { k: 'body', label: 'The story', type: 'textarea', full: true, hint: 'Leave a blank line between paragraphs.' },
    { k: 'excerpt', label: 'Excerpt', type: 'textarea', only: ['column'], full: true, hint: 'Two lines shown when readers hover.' },
    { k: 'minutes', label: 'Minutes to read', type: 'number', only: ['column'] },
    { k: 'bullets', label: 'Résumé bullets', type: 'lines', only: ['role', 'project'], full: true, hint: 'One per line. Start with a verb and include a result.' },
    { k: 'link', label: 'Link', type: 'text', hint: 'Credential, repo, article — full https:// address.' },
    { k: 'linkLabel', label: 'Link text', type: 'text', hint: 'e.g. Verify credential' },
    { k: 'image', label: 'Photo', type: 'image', not: ['column'] },
    { k: 'imageCaption', label: 'Photo caption', type: 'text', not: ['column'] },
    { k: 'headline', label: 'Custom front-page headline', type: 'text', full: true, hint: 'Optional. Leave empty and the paper writes one for you.' },
    { set: 'Case study (shown on page A2)', only: ['project'] },
    { k: 'featured', label: 'Feature this project on page A2', type: 'check', only: ['project'] },
    { k: 'case.problem', label: 'The problem', type: 'textarea', only: ['project'] },
    { k: 'case.approach', label: 'The approach', type: 'textarea', only: ['project'] },
    { k: 'case.result', label: 'The result', type: 'textarea', only: ['project'] },
    { k: 'case.quote', label: 'Pull quote', type: 'text', only: ['project'], full: true },
    { k: 'case.stats', label: 'By the numbers', type: 'stats', only: ['project'], full: true, hint: 'One per line as  value | label  — e.g.  40% | faster checkout' },
    { set: 'Résumé', not: ['column'] },
    { k: 'onResume', label: 'Include on my résumé', type: 'check', dflt: true, not: ['column'] }
  ];
  function shown(f, type) { return (!f.only || f.only.indexOf(type) > -1) && (!f.not || f.not.indexOf(type) < 0); }

  function renderStories() {
    var list = D.entries.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    $('storyList').innerHTML = list.length ? list.map(function (e) {
      return '<div class="story-row"><div><div class="m"><span class="badge">' + esc(e.type) + '</span>' + esc(e.date || 'no date') + (e.onResume === false ? ' · not on résumé' : '') + '</div>' +
        '<div class="t">' + esc(e.title || '(untitled)') + (e.org ? ' — ' + esc(e.org) : '') + '</div></div>' +
        '<div class="row-actions"><button type="button" class="btn" data-edit="' + esc(e.id) + '">Edit</button><button type="button" class="btn danger" data-del="' + esc(e.id) + '">Delete</button></div></div>';
    }).join('') : '<p class="help">No stories yet. File your first one above.</p>';
  }

  function storyForm(e) {
    var t = e.type;
    var h = '<h3 class="side-h">' + (e._new ? 'New ' : 'Edit ') + esc(t) + '</h3><form id="sf" class="grid2">';
    F.forEach(function (f) {
      if (!shown(f, t)) return;
      if (f.set) { h += '<div class="fieldset">' + esc(f.set) + '</div>'; return; }
      var v = get(e, f.k);
      var label = f.k === 'org' ? ORG[t] : f.k === 'date' ? (DATE[t] || 'Date') : f.label;
      var hint = (f.hintBy && f.hintBy[t]) || f.hint;
      var lab = esc(label) + (hint ? ' <span class="hint">' + esc(hint) + '</span>' : '');
      var cls = f.full || f.type === 'textarea' ? ' class="full"' : '';
      var name = ' name="' + esc(f.k) + '"' + (f.req ? ' required' : '');
      if (f.type === 'textarea') h += '<label' + cls + '>' + lab + '<textarea' + name + '>' + esc(v || '') + '</textarea></label>';
      else if (f.type === 'lines') h += '<label' + cls + '>' + lab + '<textarea' + name + '>' + esc((v || []).join('\n')) + '</textarea></label>';
      else if (f.type === 'stats') h += '<label' + cls + '>' + lab + '<textarea' + name + '>' + esc((v || []).map(function (s) { return s.value + ' | ' + s.label; }).join('\n')) + '</textarea></label>';
      else if (f.type === 'check') { var on = v == null ? !!f.dflt : !!v; h += '<label class="check full"><input type="checkbox"' + name + (on ? ' checked' : '') + '> ' + esc(label) + '</label>'; }
      else if (f.type === 'image') h += '<label' + cls + '>' + lab + '<input type="text"' + name + ' value="' + esc(v || '') + '" placeholder="images/photo.jpg"><input type="file" accept="image/*" data-upload>' +
        (v ? '<img class="img-prev" alt="" src="../../' + esc(v) + '">' : '') + '</label>';
      else h += '<label' + cls + '>' + lab + '<input type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '"' + name + ' value="' + esc(v == null ? '' : v) + '"></label>';
    });
    h += '<div class="actions full"><button type="submit" class="btn primary">Save story</button><button type="button" class="btn" id="sfCancel">Cancel</button></div></form>';
    var box = $('storyForm'); box.innerHTML = h; box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('sfCancel').onclick = function () { box.hidden = true; };
    var up = box.querySelector('[data-upload]');
    if (up) up.addEventListener('change', function () {
      var file = this.files[0], input = box.querySelector('[name="image"]'), inp = this; if (!file) return;
      status('Uploading photo…');
      uploadImage(file).then(function (path) { input.value = path; status('Photo uploaded. Save the story, then publish.', true); })
        .catch(function (err) { status(err.message, true); inp.value = ''; });
    });
    $('sf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var fd = this;
      F.forEach(function (f) {
        if (f.set || !shown(f, t)) return;
        var el = fd.elements[f.k]; if (!el) return;
        var v;
        if (f.type === 'check') v = el.checked;
        else if (f.type === 'lines') v = el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        else if (f.type === 'stats') v = el.value.split('\n').map(function (s) { var p = s.split('|'); return { value: (p[0] || '').trim(), label: (p.slice(1).join('|') || '').trim() }; }).filter(function (s) { return s.value; });
        else if (f.type === 'number') v = el.value ? +el.value : '';
        else v = el.value.trim();
        set(e, f.k, v);
      });
      var isNew = e._new; delete e._new;
      if (isNew) { e.id = slug(e.title) + '-' + Date.now().toString(36); D.entries.push(e); }
      markDirty((isNew ? 'filed ' : 'updated ') + '“' + e.title + '”');
      $('storyForm').hidden = true; renderStories();
    });
  }

  $('newBtn').onclick = function () { storyForm({ _new: true, type: $('newType').value, date: today(), onResume: $('newType').value !== 'column' }); };
  $('storyList').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-edit],[data-del]'); if (!b) return;
    var id = b.dataset.edit || b.dataset.del;
    var e = D.entries.find(function (x) { return x.id === id; }); if (!e) return;
    if (b.dataset.edit) storyForm(e);
    else if (confirm('Delete “' + e.title + '”? It disappears from the paper and your résumé when you publish.')) {
      D.entries = D.entries.filter(function (x) { return x !== e; }); markDirty('removed “' + e.title + '”'); renderStories();
    }
  });

  /* ---------- profile ---------- */
  var P = [
    { set: 'Masthead' },
    ['site.name', 'Full name'], ['site.surname', 'Name on the masthead', 'Shown as “The ___ Gazette”'], ['site.city', 'City'],
    ['site.role', 'Current role'], ['site.field', 'Your field'],
    ['site.profile', 'Profile paragraph (front page)', '', 'area'],
    ['site.accent', 'Accent colour', '', 'color'],
    { set: 'Résumé' },
    ['site.summary', 'Résumé summary', 'Two lines, with keywords from roles you target. Only appears on the résumé.', 'area'],
    { set: 'Contact' },
    ['site.contact.email', 'Email'], ['site.contact.phone', 'Phone', 'Used only on the résumé, but saved in your public content file. Leave empty to keep it private and add it to the downloaded .docx yourself.'], ['site.contact.linkedin', 'LinkedIn URL'],
    ['site.contact.github', 'GitHub URL'], ['site.contact.website', 'Other website']
  ];
  function renderProfile() {
    var root = { site: D.site };
    $('profileForm').innerHTML = P.map(function (p) {
      if (p.set) return '<div class="fieldset">' + esc(p.set) + '</div>';
      var v = get(root, p[0]) || (p[3] === 'color' ? '#B3001B' : '');
      var lab = esc(p[1]) + (p[2] ? ' <span class="hint">' + esc(p[2]) + '</span>' : '');
      if (p[3] === 'area') return '<label class="full">' + lab + '<textarea data-p="' + p[0] + '">' + esc(v) + '</textarea></label>';
      return '<label>' + lab + '<input type="' + (p[3] === 'color' ? 'color' : 'text') + '" data-p="' + p[0] + '" value="' + esc(v) + '"></label>';
    }).join('');
  }
  $('profileForm').addEventListener('input', function (ev) {
    var el = ev.target; if (!el.dataset.p) return;
    set({ site: D.site }, el.dataset.p, el.value); markDirty();
    if (changes[changes.length - 1] !== 'updated profile') changes.push('updated profile');
  });

  /* ---------- lists ---------- */
  function renderSkills() {
    $('skillsList').innerHTML = D.skills.map(function (s, i) {
      return '<div class="list-row" data-i="' + i + '">' +
        '<label>Skill<input data-k="name" value="' + esc(s.name) + '"></label>' +
        '<label>Group<input data-k="group" value="' + esc(s.group || '') + '" placeholder="Languages, Tools…"></label>' +
        '<label>Years<input data-k="years" type="number" min="0" value="' + esc(s.years == null ? '' : s.years) + '"></label>' +
        '<label>Trend<select data-k="trend"><option value="up"' + (s.trend === 'up' ? ' selected' : '') + '>▲ using more</option><option value="steady"' + (s.trend !== 'up' ? ' selected' : '') + '>— steady</option></select></label>' +
        '<label>History<input data-k="history" value="' + esc((s.history || []).join(', ')) + '" placeholder="1, 3, 5"></label>' +
        '<button type="button" class="btn danger" data-rm="skills">Remove</button></div>';
    }).join('');
  }
  function renderLetters() {
    $('lettersList').innerHTML = D.letters.map(function (l, i) {
      return '<div class="list-row" data-i="' + i + '">' +
        '<label class="wide">Quote<textarea data-k="quote">' + esc(l.quote) + '</textarea></label>' +
        '<label>Name<input data-k="name" value="' + esc(l.name) + '"></label>' +
        '<label>Title<input data-k="title" value="' + esc(l.title) + '"></label>' +
        '<label>Company<input data-k="company" value="' + esc(l.company) + '"></label>' +
        '<button type="button" class="btn danger" data-rm="letters">Remove</button></div>';
    }).join('');
  }
  function renderCorrections() {
    $('correctionsList').innerHTML = D.corrections.map(function (c, i) {
      return '<div class="list-row" data-i="' + i + '"><label class="wide">Correction<textarea data-k="_">' + esc(c) + '</textarea></label>' +
        '<button type="button" class="btn danger" data-rm="corrections">Remove</button></div>';
    }).join('');
  }
  function bindList(containerId, key) {
    var el = $(containerId);
    function onEdit(ev) {
      var t = ev.target, row = t.closest('[data-i]'); if (!row || !t.dataset.k) return;
      var i = +row.dataset.i;
      if (key === 'corrections') D.corrections[i] = t.value;
      else {
        var v = t.value;
        if (t.dataset.k === 'years') v = v === '' ? '' : +v;
        if (t.dataset.k === 'history') v = v.split(/[,\s]+/).filter(Boolean).map(Number).filter(function (n) { return !isNaN(n); });
        D[key][i][t.dataset.k] = v;
      }
      markDirty();
      if (changes[changes.length - 1] !== 'updated ' + key) changes.push('updated ' + key);
    }
    el.addEventListener('input', onEdit);
    el.addEventListener('change', function (ev) { if (ev.target.tagName === 'SELECT') onEdit(ev); });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-rm]'); if (!b) return;
      D[key].splice(+b.closest('[data-i]').dataset.i, 1); markDirty('updated ' + key); renderAll();
    });
  }
  bindList('skillsList', 'skills'); bindList('lettersList', 'letters'); bindList('correctionsList', 'corrections');
  $('addSkill').onclick = function () { D.skills.push({ name: '', group: '', years: '', trend: 'steady', history: [] }); renderSkills(); markDirty(); };
  $('addLetter').onclick = function () { D.letters.push({ quote: '', name: '', title: '', company: '' }); renderLetters(); markDirty(); };
  $('addCorrection').onclick = function () { D.corrections.push(''); renderCorrections(); markDirty(); };

  function renderAll() { renderStories(); renderProfile(); renderSkills(); renderLetters(); renderCorrections(); }

  function clean() {
    var c = JSON.parse(JSON.stringify(D));
    c.skills = c.skills.filter(function (s) { return s.name; });
    c.letters = c.letters.filter(function (l) { return l.quote; });
    c.corrections = c.corrections.filter(Boolean);
    return c;
  }

  /* ---------- toolbar ---------- */
  $('publishBtn').onclick = function () { D = clean(); renderAll(); publish(); };
  $('previewBtn').onclick = function () {
    try { localStorage.setItem('gz-preview', JSON.stringify(clean())); } catch (e) { status('Preview needs browser storage to be allowed.', true); return; }
    window.open('../../?preview#A1', '_blank');
  };
  $('pdfBtn').onclick = function () { Resume.print(clean()); };
  $('docxBtn').onclick = function () {
    status('Preparing your Word résumé…');
    Resume.docx(clean()).then(function () { status(dirty ? 'Résumé downloaded. You still have unpublished changes.' : 'Résumé downloaded.', dirty); })
      .catch(function (e) { status(e.message, true); });
  };
  $('downloadJson').onclick = function () {
    var blob = new Blob([JSON.stringify(clean(), null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'content.json';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('importJson').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) { var d = JSON.parse(t); if (!d.entries) throw new Error(); openDesk(d); markDirty('imported content'); })
      .catch(function () { status('That file is not a valid content.json.', true); });
  });

  /* ---------- boot ---------- */
  load().then(function (d) { openDesk(d); status('Latest content loaded from GitHub.'); })
    .catch(function (e) { status('Could not open the paper’s content: ' + e.message, true); });
})();
