/**
 * Caixinha de Cookies — backend (Google Apps Script, runtime V8)
 *
 * Cole este arquivo inteiro em Extensões → Apps Script da planilha "Cookies".
 * Rode setup() uma vez. Publique como App da Web (Executar como: Eu / Acesso: Qualquer pessoa).
 * O PIN do admin fica em Configurações do projeto → Propriedades do script → ADMIN_PIN.
 */

const SHEETS = {
  Config: ['chave', 'valor'],
  Sabores: ['id', 'nome', 'preco', 'emoji', 'ativo'],
  Pessoas: ['nome', 'criado_em', 'origem'],
  Registros: ['id', 'data', 'nome', 'sabor_id', 'sabor_nome', 'qtd', 'preco_unit', 'total', 'status', 'device_id'],
  Pagamentos: ['id', 'data', 'nome', 'valor', 'status', 'confirmado_em', 'obs'],
};

const UNDO_WINDOW_MS = 10 * 60 * 1000; // "desfazer" vale por 10 minutos
const MAX_QTD = 20;                     // por sabor, por registro
const MAX_PAGAMENTO = 10000;
const PIN_MAX_FALHAS = 10;              // tentativas erradas antes de bloquear
const PIN_BLOQUEIO_SEG = 15 * 60;       // bloqueio de 15 minutos

const ACTIONS = {
  // públicas
  init: actionInit_,
  registrar: actionRegistrar_,
  saldo: actionSaldo_,
  desfazer: actionDesfazer_,
  jaPaguei: actionJaPaguei_,
  // admin (exigem pin)
  adminResumo: admin_(actionAdminResumo_),
  adminHistorico: admin_(actionAdminHistorico_),
  adminConfirmar: admin_(actionAdminConfirmar_),
  adminRejeitar: admin_(actionAdminRejeitar_),
  adminPagamentoManual: admin_(actionAdminPagamentoManual_),
  adminCancelarRegistro: admin_(actionAdminCancelarRegistro_),
};

/* ------------------------------------------------------------------ */
/* Entradas HTTP                                                       */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Requisição inválida.' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'Requisição inválida.' });

  const handler = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
  if (!handler) return json_({ ok: false, error: 'Ação desconhecida.' });

  try {
    return json_({ ok: true, data: handler(req) });
  } catch (err) {
    if (err && err.userFacing) return json_({ ok: false, error: err.message });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'Erro no servidor. Tenta de novo.' });
  }
}

/* ------------------------------------------------------------------ */
/* Ações públicas                                                      */
/* ------------------------------------------------------------------ */

function actionInit_() {
  const c = config_();
  return {
    titulo: String(c.titulo || 'Cookies'),
    subtitulo: String(c.subtitulo || ''),
    sabores: sabores_(true).map(s => ({ id: s.id, nome: s.nome, preco: s.preco, emoji: s.emoji })),
    pessoas: pessoas_().map(p => p.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    pix: {
      chave: String(c.pix_chave || '').trim(),
      nome: String(c.pix_nome || '').trim(),
      cidade: String(c.pix_cidade || '').trim(),
    },
  };
}

function actionRegistrar_(req) {
  const nomeInformado = validName_(req.nome);
  const deviceId = validDevice_(req.device_id);
  const itens = Array.isArray(req.itens) ? req.itens : [];
  if (!itens.length) fail_('Escolhe pelo menos um cookie.');
  if (itens.length > 50) fail_('Itens demais.');

  const catalogo = {};
  sabores_(true).forEach(s => { catalogo[s.id] = s; });

  // agrupa sabores repetidos e valida
  const qtdPorSabor = {};
  const ordem = [];
  itens.forEach(it => {
    const id = String((it && it.sabor_id) || '').trim();
    const qtd = it && it.qtd;
    if (!catalogo[id]) fail_('Esse sabor não está disponível. Atualiza a página.');
    if (typeof qtd !== 'number' || !Number.isInteger(qtd) || qtd < 1 || qtd > MAX_QTD) fail_('A quantidade precisa ser de 1 a ' + MAX_QTD + '.');
    if (!(id in qtdPorSabor)) { qtdPorSabor[id] = 0; ordem.push(id); }
    qtdPorSabor[id] += qtd;
    if (qtdPorSabor[id] > MAX_QTD) fail_('A quantidade precisa ser de 1 a ' + MAX_QTD + '.');
  });

  return withLock_(() => idempotent_(req, () => {
    const nome = garantirPessoa_(nomeInformado);
    const agora = new Date();
    const registros = ordem.map(id => {
      const s = catalogo[id];
      const qtd = qtdPorSabor[id];
      return {
        id: Utilities.getUuid(),
        data: agora,
        nome: nome,
        sabor_id: s.id,
        sabor_nome: s.nome,
        qtd: qtd,
        preco_unit: s.preco,                 // preço congelado no momento da compra
        total: round2_(s.preco * qtd),
        status: 'ativo',
        device_id: deviceId,
      };
    });
    appendRows_(readTable_('Registros'), registros);
    SpreadsheetApp.flush();

    const conta = saldoDe_(nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return {
      registros: registros.map(r => r.id),
      nome: nome,
      qtd: registros.reduce((a, r) => a + r.qtd, 0),
      total: round2_(registros.reduce((a, r) => a + r.total, 0)),
      saldo: conta.saldo,
      pendente: conta.pendente,
    };
  }));
}

function actionSaldo_(req) {
  const nome = validName_(req.nome);
  const regs = readTable_('Registros').rows;
  const conta = saldoDe_(nome, regs, readTable_('Pagamentos').rows);
  const k = key_(nome);
  const ultimos = regs
    .filter(r => key_(r.nome) === k)
    .sort((a, b) => time_(b.data) - time_(a.data))
    .slice(0, 5)
    .map(registroOut_);
  return { saldo: conta.saldo, pendente: conta.pendente, ultimos: ultimos };
}

function actionDesfazer_(req) {
  const deviceId = validDevice_(req.device_id);
  const ids = (Array.isArray(req.ids) ? req.ids : [req.id]).map(v => String(v || '').trim()).filter(Boolean);
  if (!ids.length || ids.length > 50) fail_('Registro inválido.');

  return withLock_(() => {
    const t = readTable_('Registros');
    const agora = Date.now();
    const alvo = ids.map(id => {
      const r = t.rows.find(x => String(x.id) === id);
      if (!r) fail_('Registro não encontrado.');
      if (String(r.device_id) !== deviceId) fail_('Só dá pra desfazer no mesmo celular que registrou.');
      if (agora - time_(r.data) > UNDO_WINDOW_MS) fail_('Passou de 10 minutos, não dá mais pra desfazer. Fala comigo!');
      return r;
    });
    let cancelados = 0;
    alvo.forEach(r => {
      if (status_(r.status) === 'ativo') { setField_(t, r, 'status', 'cancelado'); cancelados++; }
    });
    SpreadsheetApp.flush();
    const conta = saldoDe_(alvo[0].nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return { cancelados: cancelados, saldo: conta.saldo, pendente: conta.pendente };
  });
}

function actionJaPaguei_(req) {
  const nomeInformado = validName_(req.nome);
  const valor = validValor_(req.valor);
  return withLock_(() => idempotent_(req, () => {
    const nome = garantirPessoa_(nomeInformado);
    appendRows_(readTable_('Pagamentos'), [{
      id: Utilities.getUuid(),
      data: new Date(),
      nome: nome,
      valor: valor,
      status: 'aguardando',
      confirmado_em: '',
      obs: 'Pix (informado pela pessoa)',
    }]);
    SpreadsheetApp.flush();
    const conta = saldoDe_(nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return { saldo: conta.saldo, pendente: conta.pendente };
  }));
}

/* ------------------------------------------------------------------ */
/* Ações de admin                                                      */
/* ------------------------------------------------------------------ */

function admin_(fn) {
  return function (req) {
    requirePin_(req);
    return fn(req);
  };
}

function requirePin_(req) {
  const pin = String(PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '').trim();
  if (!pin) fail_('ADMIN_PIN não configurado nas Propriedades do script.');
  const cache = CacheService.getScriptCache();
  const falhas = Number(cache.get('pin_falhas') || 0);
  if (falhas >= PIN_MAX_FALHAS) fail_('Muitas tentativas erradas. Espera 15 minutos.');
  if (String(req.pin == null ? '' : req.pin).trim() !== pin) {
    cache.put('pin_falhas', String(falhas + 1), PIN_BLOQUEIO_SEG);
    fail_('PIN incorreto.');
  }
}

function actionAdminResumo_() {
  const regs = readTable_('Registros').rows;
  const pags = readTable_('Pagamentos').rows;
  const contas = {};
  const conta = nome => {
    const k = key_(nome);
    if (!k) return null;
    if (!contas[k]) contas[k] = { nome: cleanName_(nome), compras: [], comprado: 0, pago: 0, pendente: 0, ultima: 0 };
    return contas[k];
  };
  pessoas_().forEach(p => conta(p.nome)); // nome "oficial" vem da aba Pessoas

  regs.forEach(r => {
    if (status_(r.status) !== 'ativo') return;
    const c = conta(r.nome);
    if (!c) return;
    const t = time_(r.data);
    const total = money_(r.total);
    c.comprado += total;
    c.compras.push({ t: t, total: total });
    if (t > c.ultima) c.ultima = t;
  });

  const tz = Session.getScriptTimeZone();
  const mesAtual = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  let recebidoMes = 0;
  const aguardando = [];
  pags.forEach(p => {
    const c = conta(p.nome);
    if (!c) return;
    const st = status_(p.status);
    const valor = money_(p.valor);
    if (st === 'confirmado') {
      c.pago += valor;
      const quando = toDate_(p.confirmado_em) || toDate_(p.data);
      if (quando && Utilities.formatDate(quando, tz, 'yyyy-MM') === mesAtual) recebidoMes += valor;
    } else if (st === 'aguardando') {
      c.pendente += valor;
      aguardando.push(pagamentoOut_(p));
    }
  });

  const devedores = Object.keys(contas).map(k => {
    const c = contas[k];
    const saldo = round2_(c.comprado - c.pago);
    return {
      nome: c.nome,
      saldo: saldo,
      pendente: round2_(c.pendente),
      ultima_compra: c.ultima ? new Date(c.ultima).toISOString() : '',
      deve_desde: deveDesde_(c.compras, c.pago),
    };
  }).filter(d => d.saldo > 0.004 || d.pendente > 0.004)
    .sort((a, b) => b.saldo - a.saldo);

  aguardando.sort((a, b) => time_(a.data) - time_(b.data));

  return {
    devedores: devedores,
    total_a_receber: round2_(devedores.reduce((a, d) => a + Math.max(0, d.saldo), 0)),
    total_recebido_mes: round2_(recebidoMes),
    pagamentos_aguardando: aguardando,
  };
}

function actionAdminHistorico_(req) {
  const nome = validName_(req.nome);
  const k = key_(nome);
  const regs = readTable_('Registros').rows;
  const pags = readTable_('Pagamentos').rows;
  const conta = saldoDe_(nome, regs, pags);
  return {
    nome: nome,
    saldo: conta.saldo,
    pendente: conta.pendente,
    registros: regs.filter(r => key_(r.nome) === k)
      .sort((a, b) => time_(b.data) - time_(a.data))
      .map(registroOut_),
    pagamentos: pags.filter(p => key_(p.nome) === k)
      .sort((a, b) => time_(b.data) - time_(a.data))
      .map(pagamentoOut_),
  };
}

function actionAdminConfirmar_(req) {
  return mudarPagamento_(req.pagamento_id, 'confirmado', ['aguardando', 'rejeitado']);
}

function actionAdminRejeitar_(req) {
  return mudarPagamento_(req.pagamento_id, 'rejeitado', ['aguardando']);
}

function mudarPagamento_(id, novoStatus, statusPermitidos) {
  id = String(id || '').trim();
  if (!id) fail_('Pagamento inválido.');
  return withLock_(() => {
    const t = readTable_('Pagamentos');
    const p = t.rows.find(x => String(x.id) === id);
    if (!p) fail_('Pagamento não encontrado.');
    const atual = status_(p.status);
    if (statusPermitidos.indexOf(atual) < 0) fail_('Esse pagamento já está "' + atual + '".');
    setField_(t, p, 'status', novoStatus);
    if (novoStatus === 'confirmado') setField_(t, p, 'confirmado_em', new Date());
    SpreadsheetApp.flush();
    const conta = saldoDe_(p.nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return { id: id, status: novoStatus, nome: cleanName_(p.nome), saldo: conta.saldo, pendente: conta.pendente };
  });
}

function actionAdminPagamentoManual_(req) {
  const nomeInformado = validName_(req.nome);
  const valor = validValor_(req.valor);
  const obs = String(req.obs || '').trim().replace(/^[=+\-@]+/, '').slice(0, 100) || 'Dinheiro';
  return withLock_(() => {
    const nome = garantirPessoa_(nomeInformado, 'lista');
    const agora = new Date();
    const id = Utilities.getUuid();
    appendRows_(readTable_('Pagamentos'), [{
      id: id, data: agora, nome: nome, valor: valor,
      status: 'confirmado', confirmado_em: agora, obs: obs,
    }]);
    SpreadsheetApp.flush();
    const conta = saldoDe_(nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return { id: id, saldo: conta.saldo, pendente: conta.pendente };
  });
}

function actionAdminCancelarRegistro_(req) {
  const id = String(req.registro_id || '').trim();
  if (!id) fail_('Registro inválido.');
  return withLock_(() => {
    const t = readTable_('Registros');
    const r = t.rows.find(x => String(x.id) === id);
    if (!r) fail_('Registro não encontrado.');
    if (status_(r.status) === 'cancelado') fail_('Esse registro já está cancelado.');
    setField_(t, r, 'status', 'cancelado');
    SpreadsheetApp.flush();
    const conta = saldoDe_(r.nome, readTable_('Registros').rows, readTable_('Pagamentos').rows);
    return { id: id, saldo: conta.saldo, pendente: conta.pendente };
  });
}

/* ------------------------------------------------------------------ */
/* Regras de negócio                                                   */
/* ------------------------------------------------------------------ */

function saldoDe_(nome, regs, pags) {
  const k = key_(nome);
  let comprado = 0, pago = 0, pendente = 0;
  regs.forEach(r => {
    if (key_(r.nome) === k && status_(r.status) === 'ativo') comprado += money_(r.total);
  });
  pags.forEach(p => {
    if (key_(p.nome) !== k) return;
    const st = status_(p.status);
    if (st === 'confirmado') pago += money_(p.valor);
    else if (st === 'aguardando') pendente += money_(p.valor);
  });
  return { saldo: round2_(comprado - pago), pendente: round2_(pendente) };
}

/** Data da compra mais antiga ainda não quitada (pagamentos abatem as compras mais antigas primeiro). */
function deveDesde_(compras, pago) {
  let restante = pago;
  const ordenadas = compras.slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i < ordenadas.length; i++) {
    restante = round2_(restante - ordenadas[i].total);
    if (restante < -0.004) return ordenadas[i].t ? new Date(ordenadas[i].t).toISOString() : '';
  }
  return '';
}

/** Devolve o nome como está na aba Pessoas; se não existir, cadastra. */
function garantirPessoa_(nome, origem) {
  const t = readTable_('Pessoas');
  const k = key_(nome);
  const existente = t.rows.find(p => key_(p.nome) === k);
  if (existente) return cleanName_(existente.nome);
  appendRows_(t, [{ nome: nome, criado_em: new Date(), origem: origem || 'auto' }]);
  return nome;
}

function config_() {
  const c = {};
  readTable_('Config').rows.forEach(r => {
    const k = String(r.chave || '').trim();
    if (k) c[k] = r.valor;
  });
  return c;
}

function sabores_(soAtivos) {
  return readTable_('Sabores').rows
    .map(r => ({
      id: String(r.id == null ? '' : r.id).trim(),
      nome: String(r.nome == null ? '' : r.nome).trim(),
      preco: money_(r.preco),
      emoji: String(r.emoji == null ? '' : r.emoji).trim(),
      ativo: bool_(r.ativo),
    }))
    .filter(s => s.id && s.nome && s.preco > 0 && (!soAtivos || s.ativo));
}

function pessoas_() {
  const vistos = {};
  const out = [];
  readTable_('Pessoas').rows.forEach(r => {
    const nome = cleanName_(r.nome);
    const k = key_(nome);
    if (!k || vistos[k]) return;
    vistos[k] = true;
    out.push({ nome: nome, origem: String(r.origem || '') });
  });
  return out;
}

function registroOut_(r) {
  return {
    id: String(r.id),
    data: iso_(r.data),
    nome: cleanName_(r.nome),
    sabor_id: String(r.sabor_id),
    sabor_nome: String(r.sabor_nome),
    qtd: Number(r.qtd) || 0,
    preco_unit: money_(r.preco_unit),
    total: money_(r.total),
    status: status_(r.status),
  };
}

function pagamentoOut_(p) {
  return {
    id: String(p.id),
    data: iso_(p.data),
    nome: cleanName_(p.nome),
    valor: money_(p.valor),
    status: status_(p.status),
    confirmado_em: iso_(p.confirmado_em),
    obs: String(p.obs || ''),
  };
}

/* ------------------------------------------------------------------ */
/* Validação e utilidades                                              */
/* ------------------------------------------------------------------ */

function fail_(msg) {
  const e = new Error(msg);
  e.userFacing = true;
  throw e;
}

function validName_(nome) {
  const n = cleanName_(nome);
  if (n.length < 2 || n.length > 40) fail_('O nome precisa ter entre 2 e 40 letras.');
  if (/^[=+\-@]/.test(n)) fail_('Nome inválido.'); // evita virar fórmula na planilha
  return n;
}

function validDevice_(id) {
  const s = String(id || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(s)) fail_('Dispositivo inválido. Recarrega a página.');
  return s;
}

function validValor_(v) {
  const n = round2_(money_(v));
  if (!(n > 0) || n > MAX_PAGAMENTO) fail_('Valor inválido.');
  return n;
}

function cleanName_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Chave de comparação de nomes: ignora maiúsculas/minúsculas e espaços nas pontas. */
function key_(s) {
  return cleanName_(s).toLowerCase();
}

function status_(s) {
  return String(s || '').trim().toLowerCase();
}

function round2_(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

/** Aceita número ou texto ("6", "6.5", "6,50", "R$ 1.234,56"). */
function money_(v) {
  if (typeof v === 'number') return isFinite(v) ? round2_(v) : 0;
  let s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? round2_(n) : 0;
}

function bool_(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'VERDADEIRO' || s === 'SIM' || s === '1';
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function toDate_(v) {
  if (isDate_(v)) return v;
  if (v === '' || v == null) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function time_(v) {
  const d = toDate_(v);
  return d ? d.getTime() : 0;
}

function iso_(v) {
  const d = toDate_(v);
  return d ? d.toISOString() : '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    fail_('Muita gente ao mesmo tempo. Tenta de novo.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Se o cliente mandar request_id, repetir a mesma requisição (ex.: timeout + "tentar de novo")
 * devolve o resultado anterior em vez de gravar duas vezes. Chamar sempre dentro do lock.
 */
function idempotent_(req, fn) {
  const rid = String(req.request_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(rid)) return fn();
  const cache = CacheService.getScriptCache();
  const chave = 'req_' + req.action + '_' + rid;
  const salvo = cache.get(chave);
  if (salvo) return JSON.parse(salvo);
  const out = fn();
  try { cache.put(chave, JSON.stringify(out), 6 * 60 * 60); } catch (e) { /* cache é só otimização */ }
  return out;
}

/* ------------------------------------------------------------------ */
/* Acesso à planilha                                                   */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) fail_('Aba "' + name + '" não encontrada. Rode a função setup() no Apps Script.');
  return sh;
}

/** Lê uma aba inteira como objetos {cabeçalho: valor}, guardando o número da linha em _row. */
function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const linha = values[i];
    if (linha.every(v => v === '' || v === null)) continue;
    const o = { _row: i + 1 };
    headers.forEach((h, j) => { if (h) o[h] = linha[j]; });
    rows.push(o);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

function appendRows_(table, objs) {
  if (!objs.length) return;
  const data = objs.map(o => table.headers.map(h => (Object.prototype.hasOwnProperty.call(o, h) ? o[h] : '')));
  const inicio = table.sheet.getLastRow() + 1;
  table.sheet.getRange(inicio, 1, data.length, table.headers.length).setValues(data);
}

function setField_(table, row, field, value) {
  const col = table.headers.indexOf(field);
  if (col < 0) fail_('Coluna "' + field + '" não encontrada. Rode setup().');
  table.sheet.getRange(row._row, col + 1).setValue(value);
  row[field] = value;
}

/* ------------------------------------------------------------------ */
/* Setup (rodar manualmente uma vez)                                   */
/* ------------------------------------------------------------------ */

function setup() {
  const ss = SpreadsheetApp.getActive();
  const exemplos = {
    Config: [
      ['pix_chave', '45281715895'],
      ['pix_nome', 'VICTOR ANTONIO'],
      ['pix_cidade', 'SAO PAULO'],
      ['titulo', 'Cookies'],
      ['subtitulo', 'feitos com carinho · @docespimentas'],
    ],
    Sabores: [
      ['tradicional', 'Tradicional', 10, '🍪', true],
      ['redvelvet', 'Red Velvet', 12, '❤️', true],
      ['mm', 'M&M Tradicional', 12, '🍬', true],
      ['nutella', 'Nutella', 12, '🌰', true],
      ['kinder', 'Kinder Bueno', 12, '🍫', true],
      ['limao', 'Limão Siciliano', 12, '🍋', true],
      ['cacaublack', 'Cacau Black', 12, '🖤', true],
      ['ninhonutella', 'Ninho & Nutella', 12, '🥛', true],
      ['farinhalactea', 'Farinha Láctea', 12, '🌾', true],
    ],
    Pessoas: [
      ['Fulano', new Date(), 'lista'],
    ],
  };
  // colunas guardadas como texto puro (evita "+5511..." virar número e CPF perder zero à esquerda)
  const colunasTexto = {
    Config: ['chave', 'valor'],
    Sabores: ['id'],
    Pessoas: ['nome'],
    Registros: ['id', 'nome', 'sabor_id', 'device_id'],
    Pagamentos: ['id', 'nome', 'obs'],
  };

  Object.keys(SHEETS).forEach(name => {
    const headers = SHEETS[name];
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() > 0) return; // aba já existe com dados: não mexe

    (colunasTexto[name] || []).forEach(h => {
      sh.getRange(1, headers.indexOf(h) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);

    const linhas = exemplos[name];
    if (linhas) sh.getRange(2, 1, linhas.length, headers.length).setValues(linhas);
    if (name === 'Sabores') {
      sh.getRange(2, headers.indexOf('preco') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.00');
    }
    if (name === 'Registros') {
      sh.getRange(2, headers.indexOf('preco_unit') + 1, sh.getMaxRows() - 1, 2).setNumberFormat('0.00');
    }
    if (name === 'Pagamentos') {
      sh.getRange(2, headers.indexOf('valor') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.00');
    }
  });

  // remove a aba padrão vazia ("Página1"/"Sheet1"), se houver
  ss.getSheets().forEach(sh => {
    if (!SHEETS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_PIN')) {
    console.warn('Lembrete: crie a propriedade ADMIN_PIN em Configurações do projeto → Propriedades do script.');
  }
  console.log('Setup concluído.');
}
