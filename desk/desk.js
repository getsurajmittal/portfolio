/* The Editor's Desk — edits content.json and publishes it to GitHub */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var D = null, sha = null, cfg = null, offline = false, dirty = false, editing = null, changes = [];
  var CFG_KEY = 'gz-desk-cfg';

  /* ---------- small utils ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function set(o, path, v) { var ks = path.split('.'), last = ks.pop(); ks.forEach(function (k) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[last] = v; }
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b) { return decodeURIComponent(escape(atob(String(b).replace(/\s/g, '')))); }
  function slug(s) { return String(s || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'story'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function status(text, isDirty) { var s = $('status'); s.textContent = text; s.classList.toggle('dirty', !!isDirty); }
  function markDirty(what) { dirty = true; if (what) changes.push(what); status('Unpublished changes — ' + (offline ? 'download the file when done.' : 'press “Publish edition”.'), true); }

  /* ---------- GitHub ---------- */
  function api(path, opts) {
    opts = opts || {};
    var url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
    if (!opts.method || opts.method === 'GET') url += '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now();
    return fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var why = r.status === 401 ? 'The token was rejected. Check it has not expired.' :
            r.status === 403 ? 'The token is not allowed to do that. It needs “Contents: Read and write” on this repository.' :
            r.status === 404 ? 'Could not find that repository, branch or file. Check the names (and that the token can see the repo).' :
            r.status === 409 ? 'Someone (maybe you, in another tab) published in the meantime. Reload the desk and try again.' :
            (j.message || ('GitHub said ' + r.status));
          throw new Error(why);
        }
        return j;
      });
    });
  }
  function loadRemote() {
    return api('content.json').then(function (j) { sha = j.sha; return JSON.parse(b64dec(j.content)); });
  }
  function publish() {
    if (offline) { downloadJson(); return; }
    var btn = $('publishBtn'); btn.disabled = true; status('Sending to the presses…');
    var msg = 'Edition: ' + (changes.length ? changes.slice(-3).join('; ') : 'updates') + ' (' + today() + ')';
    api('content.json', { method: 'PUT', body: { message: msg, content: b64enc(JSON.stringify(D, null, 2) + '\n'), sha: sha, branch: cfg.branch } })
      .then(function (j) {
        sha = j.content.sha; dirty = false; changes = [];
        status('Published. The site updates in about a minute.');
      })
      .catch(function (e) { status('Not published: ' + e.message, true); })
      .then(function () { btn.disabled = false; });
  }
  function uploadImage(file) {
    if (offline) return Promise.reject(new Error('Images can only be uploaded when the desk is unlocked. Offline: put the file in the images folder and type its path, e.g. images/photo.jpg'));
    if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('That image is over 4 MB. Please resize it first.'));
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    }).then(function (b64) {
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      var path = 'images/' + today() + '-' + slug(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + ext;
      return api(path, { method: 'PUT', body: { message: 'Add image ' + path, content: b64, branch: cfg.branch } }).then(function () { return path; });
    });
  }

  /* ---------- unlock ---------- */
  function readCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || sessionStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; } }
  function saveCfg(remember) {
    try {
      var s = JSON.stringify(cfg);
      if (remember) { localStorage.setItem(CFG_KEY, s); sessionStorage.removeItem(CFG_KEY); }
      else { sessionStorage.setItem(CFG_KEY, s); localStorage.removeItem(CFG_KEY); }
    } catch (e) {}
  }
  function forget() { try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch (e) {} }

  function openDesk(data) {
    D = data; D.site = D.site || {}; D.entries = D.entries || []; D.skills = D.skills || []; D.letters = D.letters || []; D.corrections = D.corrections || [];
    $('unlock').hidden = true; $('editor').hidden = false;
    $('publishBtn').textContent = offline ? 'Download content.json' : 'Publish edition';
    $('connInfo').textContent = offline ? 'Working offline. Changes are not saved until you download the file and put it in your repository.' : 'Connected to ' + cfg.owner + '/' + cfg.repo + ' (' + cfg.branch + ').';
    status(offline ? 'Working offline.' : 'Unlocked. Latest content loaded from GitHub.');
    renderAll();
  }

  $('unlockForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    cfg = { owner: $('cOwner').value.trim(), repo: $('cRepo').value.trim(), branch: $('cBranch').value.trim() || 'main', token: $('cToken').value.trim() };
    $('unlockMsg').textContent = 'Checking…';
    offline = false;
    loadRemote().then(function (data) { saveCfg($('cRemember').checked); $('unlockMsg').textContent = ''; openDesk(data); })
      .catch(function (e) { $('unlockMsg').textContent = e.message; });
  });
  $('offlineBtn').onclick = function () {
    offline = true;
    fetch('../content.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(openDesk)
      .catch(function () { $('unlockMsg').textContent = 'Could not read ../content.json. Use File › Import after opening.'; openDesk({ site: {}, entries: [] }); });
  };
  $('lockBtn').onclick = function () {
    if (dirty && !confirm('You have unpublished changes. Lock anyway and lose them?')) return;
    forget(); location.reload();
  };
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

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
    { k: 'org', label: 'Organisation', type: 'text', not: [] },
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
    { set: 'Résumé' },
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
    editing = e;
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
        (v ? '<img class="img-prev" alt="" src="../' + esc(v) + '">' : '') + '</label>';
      else h += '<label' + cls + '>' + lab + '<input type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '"' + name + ' value="' + esc(v == null ? '' : v) + '"></label>';
    });
    h += '<div class="actions full"><button type="submit" class="btn primary">Save story</button><button type="button" class="btn" id="sfCancel">Cancel</button></div></form>';
    var box = $('storyForm'); box.innerHTML = h; box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('sfCancel').onclick = function () { box.hidden = true; editing = null; };
    box.querySelector('[data-upload]') && box.querySelector('[data-upload]').addEventListener('change', function () {
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
      $('storyForm').hidden = true; editing = null; renderStories();
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
    ['site.onDesk.studying', 'On the desk: studying'], ['site.onDesk.reading', 'On the desk: reading'],
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
    var root = { site: D.site }; set(root, el.dataset.p, el.value); markDirty();
    if (changes[changes.length - 1] !== 'updated profile') changes.push('updated profile');
  });

  /* ---------- lists: skills, letters, corrections ---------- */
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
    el.addEventListener('input', function (ev) {
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
    });
    el.addEventListener('change', function (ev) { if (ev.target.tagName === 'SELECT') ev.target.dispatchEvent(new Event('input', { bubbles: true })); });
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

  /* ---------- clean copy for output ---------- */
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
    window.open('../?preview#A1', '_blank');
  };
  $('pdfBtn').onclick = function () { Resume.print(clean()); };
  $('docxBtn').onclick = function () {
    status('Preparing your Word résumé…');
    Resume.docx(clean()).then(function () { status(dirty ? 'Résumé downloaded. You still have unpublished changes.' : 'Résumé downloaded.', dirty); })
      .catch(function (e) { status(e.message, true); });
  };
  function downloadJson() {
    var blob = new Blob([JSON.stringify(clean(), null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'content.json';
    document.body.appendChild(a); a.click(); a.remove();
    if (offline) { dirty = false; status('Downloaded. Replace content.json in your repository with this file to publish.'); }
  }
  $('downloadJson').onclick = downloadJson;
  $('importJson').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) { var d = JSON.parse(t); if (!d.entries) throw new Error(); D = d; openDesk(D); markDirty('imported content'); })
      .catch(function () { status('That file is not a valid content.json.', true); });
  });

  /* ---------- auto-unlock if remembered ---------- */
  var saved = readCfg();
  if (saved && saved.token) {
    cfg = saved;
    $('cOwner').value = cfg.owner; $('cRepo').value = cfg.repo; $('cBranch').value = cfg.branch;
    $('unlockMsg').textContent = 'Opening your desk…';
    loadRemote().then(function (d) { $('unlockMsg').textContent = ''; openDesk(d); })
      .catch(function (e) { $('unlockMsg').textContent = e.message; });
  }
})();
