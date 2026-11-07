/* ATS résumé builder — turns content.json into a plain, single-column résumé.
   Exposes window.Resume.html(data), .print(data), .docx(data). */
(function () {
  'use strict';
  var DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function paras(t) { return String(t || '').split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean); }
  function mon(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    var d = new Date(+p[0], (+p[1] || 1) - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function range(e) { return mon(e.date) + ' – ' + (e.endDate ? mon(e.endDate) : 'Present'); }
  function byDate(a, b) { return String(b.date).localeCompare(String(a.date)); }
  function strip(u) { return String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); }

  /* One structured model, used by both HTML and DOCX output */
  function model(D) {
    var s = D.site || {}, c = s.contact || {};
    var E = (D.entries || []).filter(function (e) { return e && e.title && e.onResume !== false; });
    var of = function (types) { return E.filter(function (e) { return types.indexOf(e.type) > -1; }).sort(byDate); };
    var bullets = function (e) { var b = (e.bullets || []).filter(Boolean); return b.length ? b : paras(e.body).slice(0, 3); };
    var groups = {};
    (D.skills || []).forEach(function (k) { if (!k.name) return; var g = k.group || 'Skills'; (groups[g] = groups[g] || []).push(k.name); });
    return {
      name: s.name || '',
      headline: s.role || '',
      contact: [s.city, c.email, c.phone, strip(c.linkedin), strip(c.github), strip(c.website)].filter(Boolean),
      summary: s.summary || '',
      skills: Object.keys(groups).map(function (g) { return { group: g, items: groups[g] }; }),
      experience: of(['role']).map(function (e) { return { title: e.title, org: e.org, loc: e.location, when: range(e), bullets: bullets(e) }; }),
      projects: of(['project']).map(function (e) { return { title: e.title, line: e.deck || '', when: mon(e.date), bullets: (e.bullets || []).filter(Boolean) }; }),
      certs: of(['certification', 'course']).map(function (e) { return { title: e.title, org: e.org, when: mon(e.date), id: e.credentialId }; }),
      education: of(['education']).map(function (e) { return { title: e.title, org: e.org, loc: e.location, when: (e.date ? String(e.date).slice(0, 4) : '') + (e.endDate ? ' – ' + String(e.endDate).slice(0, 4) : '') }; }),
      honours: of(['honour']).map(function (e) { return { title: e.title, org: e.org, when: e.date ? String(e.date).slice(0, 4) : '' }; })
    };
  }

  function html(D) {
    var m = model(D);
    var sec = function (t, body) { return body ? '<h2>' + t + '</h2>' + body : ''; };
    var ul = function (arr) { return arr.length ? '<ul>' + arr.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : ''; };
    var row = function (l, r) { return '<div class="row"><span>' + l + '</span><span>' + esc(r) + '</span></div>'; };
    var out = '<h1>' + esc(m.name) + '</h1>' +
      (m.headline ? '<div class="sub">' + esc(m.headline) + '</div>' : '') +
      '<div class="contact">' + m.contact.map(esc).join(' | ') + '</div>' +
      sec('Summary', m.summary ? '<p>' + esc(m.summary) + '</p>' : '') +
      sec('Skills', m.skills.map(function (g) { return '<p><b>' + esc(g.group) + ':</b> ' + g.items.map(esc).join(', ') + '</p>'; }).join('')) +
      sec('Experience', m.experience.map(function (x) {
        return '<div class="item">' + row('<b>' + esc(x.title) + '</b>, ' + esc(x.org) + (x.loc ? ', ' + esc(x.loc) : ''), x.when) + ul(x.bullets) + '</div>';
      }).join('')) +
      sec('Projects', m.projects.map(function (x) {
        return '<div class="item">' + row('<b>' + esc(x.title) + '</b>' + (x.line ? ' — ' + esc(x.line) : ''), x.when) + ul(x.bullets) + '</div>';
      }).join('')) +
      sec('Certifications', m.certs.length ? '<ul>' + m.certs.map(function (x) {
        return '<li>' + esc(x.title) + (x.org ? ' — ' + esc(x.org) : '') + (x.when ? ', ' + esc(x.when) : '') + (x.id ? ' (Credential ID ' + esc(x.id) + ')' : '') + '</li>';
      }).join('') + '</ul>' : '') +
      sec('Education', m.education.map(function (x) { return row('<b>' + esc(x.title) + '</b>, ' + esc(x.org) + (x.loc ? ', ' + esc(x.loc) : ''), x.when); }).join('')) +
      sec('Awards', m.honours.length ? '<ul>' + m.honours.map(function (x) { return '<li>' + esc(x.title) + (x.org ? ' — ' + esc(x.org) : '') + (x.when ? ', ' + esc(x.when) : '') + '</li>'; }).join('') + '</ul>' : '');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(m.name) + ' — Résumé</title><style>' +
      '@page{size:A4;margin:16mm 18mm}body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;line-height:1.4;color:#000;max-width:760px;margin:24px auto;padding:0 16px}' +
      'h1{font-size:20pt;margin:0}.sub{font-size:11pt;margin-top:2px}.contact{margin:4px 0 6px}h2{font-size:11pt;text-transform:uppercase;border-bottom:1px solid #000;margin:14px 0 6px;padding-bottom:2px}' +
      'p{margin:0 0 4px}ul{margin:3px 0 0;padding-left:18px}li{margin-bottom:2px}.item{margin-bottom:8px}.row{display:flex;justify-content:space-between;gap:16px}' +
      '@media print{body{margin:0;padding:0;max-width:none}}</style></head><body>' + out + '</body></html>';
  }

  function print(D) {
    var w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups for this page to print your résumé.'); return; }
    w.document.open(); w.document.write(html(D)); w.document.close();
    w.onload = function () { w.focus(); w.print(); };
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 600);
  }

  function loadDocx() {
    return new Promise(function (res, rej) {
      if (window.docx) return res(window.docx);
      var s = document.createElement('script');
      s.src = DOCX_URL; s.onload = function () { res(window.docx); }; s.onerror = function () { rej(new Error('Could not load the Word export library.')); };
      document.head.appendChild(s);
    });
  }

  function docxFile(D) {
    var m = model(D);
    return loadDocx().then(function (X) {
      var P = X.Paragraph, T = X.TextRun, kids = [];
      var tab = 9638; // right tab stop near the right margin (twips)
      var run = function (t, o) { o = o || {}; o.text = t; o.font = 'Arial'; o.size = o.size || 21; return new T(o); };
      var head = function (t) {
        kids.push(new P({ children: [run(t.toUpperCase(), { bold: true, size: 22 })], spacing: { before: 240, after: 80 },
          border: { bottom: { style: X.BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } } }));
      };
      var row = function (left, right) {
        kids.push(new P({ tabStops: [{ type: X.TabStopType.RIGHT, position: tab }], spacing: { before: 80 },
          children: left.concat(right ? [run('\t' + right)] : []) }));
      };
      var bullet = function (t) { kids.push(new P({ bullet: { level: 0 }, children: [run(t)] })); };
      var text = function (parts) { kids.push(new P({ children: parts, spacing: { after: 40 } })); };

      kids.push(new P({ children: [run(m.name, { bold: true, size: 36 })] }));
      if (m.headline) text([run(m.headline, { size: 22 })]);
      text([run(m.contact.join(' | '))]);
      if (m.summary) { head('Summary'); text([run(m.summary)]); }
      if (m.skills.length) { head('Skills'); m.skills.forEach(function (g) { text([run(g.group + ': ', { bold: true }), run(g.items.join(', '))]); }); }
      if (m.experience.length) { head('Experience'); m.experience.forEach(function (x) {
        row([run(x.title, { bold: true }), run(', ' + x.org + (x.loc ? ', ' + x.loc : ''))], x.when); x.bullets.forEach(bullet); }); }
      if (m.projects.length) { head('Projects'); m.projects.forEach(function (x) {
        row([run(x.title, { bold: true }), run(x.line ? ' — ' + x.line : '')], x.when); x.bullets.forEach(bullet); }); }
      if (m.certs.length) { head('Certifications'); m.certs.forEach(function (x) {
        bullet(x.title + (x.org ? ' — ' + x.org : '') + (x.when ? ', ' + x.when : '') + (x.id ? ' (Credential ID ' + x.id + ')' : '')); }); }
      if (m.education.length) { head('Education'); m.education.forEach(function (x) {
        row([run(x.title, { bold: true }), run(', ' + x.org + (x.loc ? ', ' + x.loc : ''))], x.when); }); }
      if (m.honours.length) { head('Awards'); m.honours.forEach(function (x) { bullet(x.title + (x.org ? ' — ' + x.org : '') + (x.when ? ', ' + x.when : '')); }); }

      var doc = new X.Document({ creator: m.name, title: m.name + ' Résumé',
        sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: kids }] });
      return X.Packer.toBlob(doc);
    });
  }

  function docx(D) {
    return docxFile(D).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ((D.site && D.site.name) || 'resume').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '_Resume.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  window.Resume = { model: model, html: html, print: print, docx: docx, docxFile: docxFile };
})();
