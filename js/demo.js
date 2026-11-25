// MODO TESTE LOCAL — só para desenvolvimento, não vai para a Vercel (.vercelignore).
//
// Roda o próprio apps-script/Code.gs dentro do navegador, com uma planilha falsa
// guardada no localStorage. Assim dá pra testar o site inteiro sem o Google.
// Liga sozinho em localhost enquanto js/config.js não tiver a URL real; ou force com ?demo.

import { uuid } from './api.js';

const DB_KEY = 'cookies.demo.db';
const PIN = '1234';
const CLIENT_ID = 'modo-teste.apps.googleusercontent.com'; // liga o login (com "Google" de mentira)
const PROPS_KEY = 'cookies.demo.props';
const LATENCIA_MS = 350; // simula a demora da rede

/* --------------------------- planilha falsa --------------------------- */

class Sheet {
  constructor(name, data = []) { this.name = name; this.data = data; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, (r || []).length), 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
  insertRowsAfter() {}
  get(r, c) { const v = (this.data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.get(this.r + i, this.c + j)));
  }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

// Datas viram {"$d": iso} no JSON e voltam como Date (igual o Sheets devolve).
const salvar = sheets => {
  const plano = sheets.map(s => ({ name: s.name, data: s.data.map(r => r.map(v => (v instanceof Date ? { $d: v.toISOString() } : v))) }));
  localStorage.setItem(DB_KEY, JSON.stringify(plano));
};
const carregar = () => {
  try {
    const plano = JSON.parse(localStorage.getItem(DB_KEY));
    if (!Array.isArray(plano)) return null;
    return plano.map(s => new Sheet(s.name, s.data.map(r => r.map(v => (v && v.$d ? new Date(v.$d) : v)))));
  } catch { return null; }
}

/* ------------------------- ambiente do Apps Script ------------------------- */

function propriedades() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PROPS_KEY)) || {}; } catch { /* */ }
  return { ADMIN_PIN: PIN, GOOGLE_CLIENT_ID: CLIENT_ID, ADMIN_EMAILS: 'admin@exemplo.com', ...p };
}
function salvarProp(k, v) {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PROPS_KEY)) || {}; } catch { /* */ }
  p[k] = v;
  localStorage.setItem(PROPS_KEY, JSON.stringify(p));
}
const deB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function hashFake(str) {
  const out = [];
  let h = 2166136261;
  for (let i = 0; i < 32; i++) {
    for (const c of str + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    out.push((h & 255) > 127 ? (h & 255) - 256 : h & 255);
  }
  return out;
}

let motor = null; // { doPost, setup }
let sheets = null;
const cache = new Map();

function globais() {
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
  return {
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => propriedades()[k] ?? null, setProperty: (k, v) => salvarProp(k, v) }) },
    // no lugar do tokeninfo do Google: o "token" do modo teste é só o JSON em base64
    UrlFetchApp: {
      fetch: url => {
        let info = null;
        try { info = JSON.parse(deB64(decodeURIComponent(url.split('id_token=')[1] || '').split('.')[1])); } catch { /* */ }
        return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) };
      },
    },
    Utilities: {
      getUuid: () => uuid(),
      // HMAC de mentira (síncrono, só para o modo teste; o Apps Script de verdade usa SHA-256)
      computeHmacSha256Signature: (v, k) => hashFake(k + '|' + v),
      base64EncodeWebSafe: v => btoa(String.fromCharCode(...(typeof v === 'string' ? new TextEncoder().encode(v) : v.map(b => b & 255))))
        .replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
      newBlob: b => ({ getDataAsString: () => new TextDecoder().decode(new Uint8Array(b.map(x => x & 255))) }),
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7),
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } }),
    },
    console,
  };
}

async function ligarMotor() {
  if (motor) return;
  const res = await fetch(new URL('../apps-script/Code.gs', import.meta.url));
  if (!res.ok) throw new Error('Modo teste: não achei apps-script/Code.gs (rode pelo servidor local, na raiz do projeto).');
  const codigo = await res.text();
  const g = globais();
  // eslint-disable-next-line no-new-func
  motor = new Function(...Object.keys(g), `${codigo}\nreturn { doPost, setup };`)(...Object.values(g));
}

/** Planilha nova: roda setup() e põe alguns dados de exemplo para o painel não ficar vazio. */
function popular() {
  sheets = [new Sheet('Página1')];
  motor.setup();
  const sh = n => sheets.find(s => s.name === n);
  const dias = n => new Date(Date.now() - n * 86400000);

  const pessoas = sh('Pessoas');
  pessoas.data.length = 1; // tira o "Fulano"
  // Ana Paula já está com o e-mail reservado: quem entrar como ana@exemplo.com cai direto na conta dela
  for (const [nome, email] of [['Ana Paula', 'ana@exemplo.com'], ['Bruno', ''], ['Carla', ''], ['Diego', '']]) pessoas.data.push([nome, dias(30), 'lista', email]);

  const reg = (d, nome, id, sabor, qtd, preco, status = 'ativo') =>
    sh('Registros').data.push([uuid(), dias(d), nome, id, sabor, qtd, preco, qtd * preco, status, 'demo-seed']);
  reg(12, 'Bruno', 'nutella', 'Nutella', 2, 12);
  reg(9, 'Bruno', 'tradicional', 'Tradicional', 1, 10);
  reg(2, 'Bruno', 'kinder', 'Kinder Bueno', 1, 12);
  reg(3, 'Ana Paula', 'redvelvet', 'Red Velvet', 1, 12);
  reg(1, 'Ana Paula', 'limao', 'Limão Siciliano', 1, 12);
  reg(1, 'Ana Paula', 'tradicional', 'Tradicional', 1, 10, 'cancelado');
  reg(5, 'Carla', 'tradicional', 'Tradicional', 1, 10);
  reg(20, 'Diego', 'cacaublack', 'Cacau Black', 2, 12);

  const pag = (d, nome, valor, status, obs) =>
    sh('Pagamentos').data.push([uuid(), dias(d), nome, valor, status, status === 'confirmado' ? dias(d) : '', obs]);
  pag(15, 'Diego', 24, 'confirmado', 'Pix');
  pag(0, 'Ana Paula', 12, 'aguardando', 'Pix (informado pela pessoa)');
  salvar(sheets);
}

/* ------------------------------ API falsa ------------------------------ */

export async function demoApi(action, payload = {}) {
  await ligarMotor();
  sheets = carregar(); // relê a cada chamada: outra aba (ex.: admin) pode ter mudado
  if (!sheets) popular();
  await new Promise(r => setTimeout(r, LATENCIA_MS));
  const out = JSON.parse(motor.doPost({ postData: { contents: JSON.stringify({ ...payload, action }) } }).content);
  salvar(sheets);
  if (!out.ok) {
    const err = new Error(out.error || 'Erro desconhecido.');
    err.code = out.code || null;
    throw err;
  }
  return out.data;
}

/* ------------------------------ aviso na tela ------------------------------ */

function aviso() {
  if (document.getElementById('demo-aviso')) return;
  const el = document.createElement('div');
  el.id = 'demo-aviso';
  const q = new URLSearchParams(location.search).has('demo') ? '?demo' : '';
  el.style.cssText = 'background:#ffd54a;color:#3a2a00;font:600 14px/1.35 system-ui,sans-serif;padding:8px 12px;' +
    'display:flex;gap:6px 12px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center';
  el.innerHTML = '<span>🧪 Modo teste local: os dados ficam só neste navegador. Painel: entre como <b>admin@exemplo.com</b> · Cliente: qualquer e-mail (ana@exemplo.com já é da Ana Paula)</span>' +
    '<span style="display:flex;gap:12px"><a href="index.html' + q + '" style="color:inherit">Cliente</a>' +
    '<a href="admin.html' + q + '" style="color:inherit">Painel</a><a href="qr.html' + q + '" style="color:inherit">Cartaz</a>' +
    '<button type="button" style="font:inherit;background:none;border:0;padding:0;color:inherit;text-decoration:underline;cursor:pointer">Zerar dados</button></span>';
  el.querySelector('button').addEventListener('click', () => {
    if (!confirm('Apagar todos os dados de teste e começar de novo?')) return;
    localStorage.removeItem(DB_KEY);
    for (const k of Object.keys(localStorage)) if (k.startsWith('cookies.')) localStorage.removeItem(k);
    sessionStorage.clear();
    location.reload();
  });
  document.body.prepend(el);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aviso);
else aviso();
