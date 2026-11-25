// Roda apps-script/Code.gs no Node com uma planilha falsa em memória.
// Não substitui testar no Google, mas pega erro de lógica (saldo, desfazer, PIN, validação).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const PIN = '4321';

/* ----------------------------- mocks ----------------------------- */

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
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
  get(r, c) { const v = (this.data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
}
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.get(this.r + i, this.c + j))); }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

function criarAmbiente({ pin = PIN } = {}) {
  const sheets = [new Sheet('Página1')];
  const ss = {
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
  const cache = new Map();
  const props = pin ? { ADMIN_PIN: pin } : {};
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    Utilities: {
      getUuid: () => randomUUID(),
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7),
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(CODE, ctx);
  ctx.setup();
  const raw = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content);
  const call = (action, payload = {}) => raw({ action, ...payload });
  const ok = (action, payload) => {
    const r = call(action, payload);
    assert.equal(r.ok, true, `${action} falhou: ${r.error}`);
    return r.data;
  };
  const tabela = nome => {
    const s = ss.getSheetByName(nome);
    const [h, ...rows] = s.data;
    return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  };
  return { ctx, ss, call, ok, raw, tabela, cache };
}

const DEV = 'device-aaaa-1111';
const DEV2 = 'device-bbbb-2222';

/* ----------------------------- testes ----------------------------- */

test('setup cria as abas, cabeçalhos e o cardápio; remove a aba vazia padrão', () => {
  const { ss, tabela } = criarAmbiente();
  const nomes = ss.getSheets().map(s => s.getName());
  assert.deepEqual(nomes, ['Config', 'Sabores', 'Pessoas', 'Registros', 'Pagamentos']);
  assert.equal(tabela('Sabores').length, 9);
  assert.deepEqual(ss.getSheetByName('Registros').data[0], ['id', 'data', 'nome', 'sabor_id', 'sabor_nome', 'qtd', 'preco_unit', 'total', 'status', 'device_id']);
});

test('setup é idempotente (não duplica dados)', () => {
  const { ctx, tabela } = criarAmbiente();
  ctx.setup();
  assert.equal(tabela('Sabores').length, 9);
  assert.equal(tabela('Config').length, 5);
});

test('doGet responde ok', () => {
  const { ctx } = criarAmbiente();
  assert.deepEqual(JSON.parse(ctx.doGet().content), { ok: true });
});

test('init devolve título, sabores ativos, pessoas e pix', () => {
  const { ok, ss } = criarAmbiente();
  ss.getSheetByName('Sabores').set(10, 5, false); // desativa farinhalactea (linha 10)
  const d = ok('init');
  assert.equal(d.titulo, 'Cookies');
  assert.equal(d.sabores.length, 8);
  assert.deepEqual(d.sabores[0], { id: 'tradicional', nome: 'Tradicional', preco: 10, emoji: '🍪' });
  assert.deepEqual(d.pessoas, ['Fulano']);
  assert.equal(d.pix.chave, '45281715895');
});

test('registrar vários sabores numa confirmação, com preço congelado', () => {
  const { ok, tabela, ss } = criarAmbiente();
  const r = ok('registrar', { nome: 'Maria', itens: [{ sabor_id: 'tradicional', qtd: 1 }, { sabor_id: 'nutella', qtd: 2 }], device_id: DEV });
  assert.equal(r.registros.length, 2);
  assert.equal(r.total, 34);
  assert.equal(r.qtd, 3);
  assert.equal(r.saldo, 34);
  assert.equal(r.pendente, 0);

  const regs = tabela('Registros');
  assert.equal(regs.length, 2);
  assert.deepEqual(regs.map(x => [x.sabor_id, x.qtd, x.preco_unit, x.total, x.status]), [
    ['tradicional', 1, 10, 10, 'ativo'],
    ['nutella', 2, 12, 24, 'ativo'],
  ]);
  // pessoa nova entra como "auto"
  assert.deepEqual(tabela('Pessoas').map(p => [p.nome, p.origem]), [['Fulano', 'lista'], ['Maria', 'auto']]);

  // muda o preço da Nutella: histórico não muda, compra nova usa o preço novo
  ss.getSheetByName('Sabores').set(5, 3, 15);
  const r2 = ok('registrar', { nome: 'maria  ', itens: [{ sabor_id: 'nutella', qtd: 1 }], device_id: DEV });
  assert.equal(r2.saldo, 34 + 15);
  assert.equal(tabela('Registros')[1].total, 24);
  assert.equal(r2.nome, 'Maria'); // grafia da planilha
  assert.equal(tabela('Pessoas').length, 2); // não duplicou
});

test('sabores repetidos no mesmo pedido são somados', () => {
  const { ok, tabela } = criarAmbiente();
  ok('registrar', { nome: 'Ana', itens: [{ sabor_id: 'mm', qtd: 1 }, { sabor_id: 'mm', qtd: 2 }], device_id: DEV });
  const regs = tabela('Registros');
  assert.equal(regs.length, 1);
  assert.equal(regs[0].qtd, 3);
});

test('validações do registrar', () => {
  const { call } = criarAmbiente();
  const base = { nome: 'Ana', device_id: DEV };
  const erro = p => call('registrar', { ...base, ...p });
  assert.equal(erro({ itens: [] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'xx', qtd: 1 }] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'mm', qtd: 0 }] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'mm', qtd: 21 }] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'mm', qtd: 1.5 }] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'mm', qtd: '2' }] }).ok, false);
  assert.equal(erro({ itens: [{ sabor_id: 'mm', qtd: 15 }, { sabor_id: 'mm', qtd: 10 }] }).ok, false);
  assert.equal(erro({ nome: 'A', itens: [{ sabor_id: 'mm', qtd: 1 }] }).ok, false);
  assert.equal(erro({ nome: 'x'.repeat(41), itens: [{ sabor_id: 'mm', qtd: 1 }] }).ok, false);
  assert.equal(erro({ nome: '=HYPERLINK("x")', itens: [{ sabor_id: 'mm', qtd: 1 }] }).ok, false);
  assert.equal(erro({ device_id: '', itens: [{ sabor_id: 'mm', qtd: 1 }] }).ok, false);
  assert.equal(call('naoExiste').ok, false);
  assert.equal(call('constructor').ok, false);
});

test('sabor inativo não pode ser registrado', () => {
  const { call, ss } = criarAmbiente();
  ss.getSheetByName('Sabores').set(2, 5, false); // tradicional
  assert.equal(call('registrar', { nome: 'Ana', itens: [{ sabor_id: 'tradicional', qtd: 1 }], device_id: DEV }).ok, false);
});

test('JSON inválido retorna erro amigável', () => {
  const { raw } = criarAmbiente();
  const r = raw('isso não é json');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('request_id repetido não grava duas vezes', () => {
  const { ok, tabela } = criarAmbiente();
  const p = { nome: 'Ana', itens: [{ sabor_id: 'mm', qtd: 1 }], device_id: DEV, request_id: 'req-12345678' };
  const a = ok('registrar', p);
  const b = ok('registrar', p);
  assert.deepEqual(a, b);
  assert.equal(tabela('Registros').length, 1);
});

test('saldo, já paguei, confirmar e rejeitar', () => {
  const { ok, tabela } = criarAmbiente();
  ok('registrar', { nome: 'Bia', itens: [{ sabor_id: 'redvelvet', qtd: 2 }], device_id: DEV }); // 24
  let s = ok('saldo', { nome: ' BIA ' });
  assert.equal(s.saldo, 24);
  assert.equal(s.ultimos.length, 1);

  const p1 = ok('jaPaguei', { nome: 'Bia', valor: 10 });
  assert.deepEqual(p1, { saldo: 24, pendente: 10 });
  const p2 = ok('jaPaguei', { nome: 'bia', valor: '4,00' });
  assert.deepEqual(p2, { saldo: 24, pendente: 14 });
  const pags = tabela('Pagamentos');
  assert.equal(pags.length, 2);
  assert.ok(pags.every(p => p.status === 'aguardando'));

  const resumo = ok('adminResumo', { pin: PIN });
  assert.equal(resumo.pagamentos_aguardando.length, 2);

  const c = ok('adminConfirmar', { pin: PIN, pagamento_id: pags[0].id });
  assert.equal(c.saldo, 14);
  assert.equal(c.pendente, 4);
  const r = ok('adminRejeitar', { pin: PIN, pagamento_id: pags[1].id });
  assert.equal(r.saldo, 14); // rejeitar mantém a dívida
  assert.equal(r.pendente, 0);

  const resumo2 = ok('adminResumo', { pin: PIN });
  assert.equal(resumo2.pagamentos_aguardando.length, 0);
  assert.equal(resumo2.total_recebido_mes, 10);
  assert.equal(resumo2.total_a_receber, 14);
});

test('não confirma duas vezes; rejeitado pode ser confirmado depois', () => {
  const { ok, call, tabela } = criarAmbiente();
  ok('jaPaguei', { nome: 'Caio', valor: 5 });
  const id = tabela('Pagamentos')[0].id;
  ok('adminRejeitar', { pin: PIN, pagamento_id: id });
  assert.equal(call('adminRejeitar', { pin: PIN, pagamento_id: id }).ok, false);
  ok('adminConfirmar', { pin: PIN, pagamento_id: id });
  assert.equal(call('adminConfirmar', { pin: PIN, pagamento_id: id }).ok, false);
});

test('jaPaguei valida valor', () => {
  const { call } = criarAmbiente();
  assert.equal(call('jaPaguei', { nome: 'Ana', valor: 0 }).ok, false);
  assert.equal(call('jaPaguei', { nome: 'Ana', valor: -5 }).ok, false);
  assert.equal(call('jaPaguei', { nome: 'Ana', valor: 'abc' }).ok, false);
  assert.equal(call('jaPaguei', { nome: 'Ana', valor: 999999 }).ok, false);
});

test('desfazer: só no mesmo celular e por até 10 minutos', () => {
  const { ok, call, ss, tabela } = criarAmbiente();
  const r = ok('registrar', { nome: 'Davi', itens: [{ sabor_id: 'kinder', qtd: 1 }, { sabor_id: 'limao', qtd: 1 }], device_id: DEV });

  // outro celular: não pode
  assert.equal(call('desfazer', { ids: r.registros, device_id: DEV2 }).ok, false);

  // mesmo celular: pode (formato da spec, um id por vez)
  const d = ok('desfazer', { id: r.registros[0], device_id: DEV });
  assert.equal(d.saldo, 12);
  assert.equal(tabela('Registros')[0].status, 'cancelado');

  // depois de 10 minutos: não pode
  const sh = ss.getSheetByName('Registros');
  sh.set(3, 2, new Date(Date.now() - 11 * 60 * 1000));
  const tarde = call('desfazer', { id: r.registros[1], device_id: DEV });
  assert.equal(tarde.ok, false);
  assert.match(tarde.error, /10 minutos/);
});

test('desfazer vários de uma vez', () => {
  const { ok } = criarAmbiente();
  const r = ok('registrar', { nome: 'Eva', itens: [{ sabor_id: 'kinder', qtd: 1 }, { sabor_id: 'limao', qtd: 3 }], device_id: DEV });
  const d = ok('desfazer', { ids: r.registros, device_id: DEV });
  assert.equal(d.cancelados, 2);
  assert.equal(d.saldo, 0);
});

test('admin: PIN errado é rejeitado em todas as ações', () => {
  const { call } = criarAmbiente();
  for (const a of ['adminResumo', 'adminHistorico', 'adminConfirmar', 'adminRejeitar', 'adminPagamentoManual', 'adminCancelarRegistro']) {
    const r = call(a, { pin: '0000', nome: 'Ana', valor: 5, pagamento_id: 'x', registro_id: 'x' });
    assert.equal(r.ok, false, a);
    assert.match(r.error, /PIN/);
  }
  assert.equal(call('adminResumo', {}).ok, false);
});

test('admin: bloqueia depois de muitas tentativas erradas', () => {
  const { call } = criarAmbiente();
  for (let i = 0; i < 10; i++) call('adminResumo', { pin: '0000' });
  const r = call('adminResumo', { pin: PIN });
  assert.equal(r.ok, false);
  assert.match(r.error, /tentativas/);
});

test('admin: sem ADMIN_PIN configurado nada passa', () => {
  const { call } = criarAmbiente({ pin: null });
  const r = call('adminResumo', { pin: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /ADMIN_PIN/);
});

test('admin: pagamento manual, cancelar registro, histórico e devedores', () => {
  const { ok, call, ss } = criarAmbiente();
  ok('registrar', { nome: 'Gil', itens: [{ sabor_id: 'tradicional', qtd: 3 }], device_id: DEV }); // 30
  const h1 = ok('registrar', { nome: 'Hugo', itens: [{ sabor_id: 'cacaublack', qtd: 1 }], device_id: DEV }); // 12

  const m = ok('adminPagamentoManual', { pin: PIN, nome: 'gil', valor: 10, obs: '=dinheiro' });
  assert.equal(m.saldo, 20);
  const pag = ss.getSheetByName('Pagamentos').data[1];
  assert.equal(pag[4], 'confirmado');
  assert.equal(pag[6], 'dinheiro'); // "=" removido

  const c = ok('adminCancelarRegistro', { pin: PIN, registro_id: h1.registros[0] });
  assert.equal(c.saldo, 0);
  assert.equal(call('adminCancelarRegistro', { pin: PIN, registro_id: h1.registros[0] }).ok, false);

  const h = ok('adminHistorico', { pin: PIN, nome: 'Gil' });
  assert.equal(h.registros.length, 1);
  assert.equal(h.pagamentos.length, 1);
  assert.equal(h.saldo, 20);

  const res = ok('adminResumo', { pin: PIN });
  assert.deepEqual(res.devedores.map(d => [d.nome, d.saldo]), [['Gil', 20]]);
  assert.equal(res.total_a_receber, 20);
  assert.ok(res.devedores[0].ultima_compra);
  assert.ok(res.devedores[0].deve_desde);
});

test('devedores ordenados por saldo e "deve desde" segue a compra mais antiga não paga', () => {
  const { ok, ss } = criarAmbiente();
  ok('registrar', { nome: 'Ivo', itens: [{ sabor_id: 'tradicional', qtd: 1 }], device_id: DEV }); // 10
  ok('registrar', { nome: 'Ivo', itens: [{ sabor_id: 'nutella', qtd: 1 }], device_id: DEV });     // 12
  ok('registrar', { nome: 'Jo', itens: [{ sabor_id: 'nutella', qtd: 5 }], device_id: DEV });      // 60
  const sh = ss.getSheetByName('Registros');
  const antiga = new Date(Date.now() - 20 * 86400000);
  const recente = new Date(Date.now() - 2 * 86400000);
  sh.set(2, 2, antiga);
  sh.set(3, 2, recente);

  let res = ok('adminResumo', { pin: PIN });
  assert.deepEqual(res.devedores.map(d => d.nome), ['Jo', 'Ivo']);
  const ivo = () => res.devedores.find(d => d.nome === 'Ivo');
  assert.equal(ivo().deve_desde, antiga.toISOString());
  assert.equal(ivo().ultima_compra, recente.toISOString());

  // pagou a compra antiga: agora deve desde a recente
  ok('adminPagamentoManual', { pin: PIN, nome: 'Ivo', valor: 10 });
  res = ok('adminResumo', { pin: PIN });
  assert.equal(ivo().deve_desde, recente.toISOString());
});

test('nomes com maiúsculas/espaços diferentes são a mesma pessoa', () => {
  const { ok } = criarAmbiente();
  ok('registrar', { nome: 'Fulano', itens: [{ sabor_id: 'mm', qtd: 1 }], device_id: DEV });
  ok('registrar', { nome: '  FULANO ', itens: [{ sabor_id: 'mm', qtd: 1 }], device_id: DEV });
  assert.equal(ok('saldo', { nome: 'fulano' }).saldo, 24);
  assert.equal(ok('init').pessoas.length, 1);
});

test('preço como texto com vírgula na planilha funciona', () => {
  const { ok, ss } = criarAmbiente();
  ss.getSheetByName('Sabores').set(2, 3, '10,50');
  const r = ok('registrar', { nome: 'Ana', itens: [{ sabor_id: 'tradicional', qtd: 2 }], device_id: DEV });
  assert.equal(r.total, 21);
});
