/* Shared by the Back Office and the Editor's Desk:
   - Vault: the GitHub token, encrypted in this browser with your press pass (AES-GCM, key from PBKDF2)
   - Session: the unlocked connection for this tab (or this device, if "keep me signed in")
   - GH: a small GitHub contents API client */
(function () {
  'use strict';
  var VAULT = 'gz-office-vault', SESS = 'gz-office-session';
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(buf) { var s = '', b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }

  function deriveKey(pass, salt) {
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  var Vault = {
    exists: function () { return !!ls(VAULT); },
    create: function (cfg, pass) {
      var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      return deriveKey(pass, salt).then(function (key) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(cfg)));
      }).then(function (ct) { ls(VAULT, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) })); });
    },
    unlock: function (pass) {
      var v = JSON.parse(ls(VAULT) || 'null');
      if (!v) return Promise.reject(new Error('No press pass on this device yet.'));
      return deriveKey(pass, unb64(v.salt)).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct));
      }).then(function (pt) { return JSON.parse(dec.decode(pt)); }, function () { throw new Error('That press pass is not right.'); });
    },
    clear: function () { ls(VAULT, null); }
  };

  var Session = {
    get: function () { try { return JSON.parse(ss(SESS) || ls(SESS) || 'null'); } catch (e) { return null; } },
    set: function (cfg, keep) { var s = JSON.stringify(cfg); ss(SESS, s); ls(SESS, keep ? s : null); },
    clear: function () { ss(SESS, null); ls(SESS, null); }
  };

  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b) { return decodeURIComponent(escape(atob(String(b).replace(/\s/g, '')))); }

  function GH(cfg) { this.cfg = cfg; }
  GH.prototype.req = function (url, opts) {
    opts = opts || {};
    return fetch('https://api.github.com' + url, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + this.cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(
            r.status === 401 ? 'GitHub rejected the token — it may have expired. Use “Lost your pass?” to set up again with a new token.' :
            r.status === 403 ? 'The token is not allowed to do that. It needs Contents: Read and write on this repository.' :
            r.status === 404 ? 'Not found on GitHub (check the repository names, and that the token can see them).' :
            r.status === 409 || r.status === 422 ? 'The file changed on GitHub in the meantime.' :
            (j.message || 'GitHub said ' + r.status));
          e.status = r.status; throw e;
        }
        return j;
      });
    });
  };
  GH.prototype.path = function (repo, p) {
    return '/repos/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(repo) + '/contents/' + p.split('/').map(encodeURIComponent).join('/');
  };
  GH.prototype.repoInfo = function (repo) { return this.req('/repos/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(repo)); };
  GH.prototype.getJSON = function (repo, p) {
    return this.req(this.path(repo, p) + '?ref=' + encodeURIComponent(this.cfg.branch) + '&t=' + Date.now()).then(function (j) {
      return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
    });
  };
  GH.prototype.list = function (repo, p) {
    return this.req(this.path(repo, p) + '?ref=' + encodeURIComponent(this.cfg.branch) + '&t=' + Date.now());
  };
  GH.prototype.put = function (repo, p, contentB64, sha, message) {
    var body = { message: message, content: contentB64, branch: this.cfg.branch };
    if (sha) body.sha = sha;
    return this.req(this.path(repo, p), { method: 'PUT', body: body });
  };
  GH.prototype.putJSON = function (repo, p, data, sha, message) {
    return this.put(repo, p, b64enc(JSON.stringify(data, null, 2) + '\n'), sha, message);
  };
  GH.prototype.del = function (repo, p, sha, message) {
    return this.req(this.path(repo, p), { method: 'DELETE', body: { message: message, sha: sha, branch: this.cfg.branch } });
  };

  window.Office = { Vault: Vault, Session: Session, GH: GH, b64enc: b64enc, b64dec: b64dec };
})();
