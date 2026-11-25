import { api, uuid, brl, esc, parseValor, valorInput } from './api.js';
import { gerarPix } from './pix.js';
import { qrSvg } from './qr.js';

const K = {
  nome: 'cookies.nome',
  device: 'cookies.device_id',
  init: 'cookies.init',       // cache do init (abre instantâneo na próxima visita)
  undo: 'cookies.undo',       // último registro, para "Desfazer"
  carrinho: 'cookies.carrinho',
};
const UNDO_MS = 10 * 60 * 1000;
const UNDO_MARGEM_MS = 15 * 1000; // some um pouco antes do servidor recusar
const MAX_QTD = 20;

const $ = id => document.getElementById(id);

const store = {
  get(area, k, json) {
    try { const v = area.getItem(k); return json ? JSON.parse(v) : v; } catch { return null; }
  },
  set(area, k, v) {
    try { area.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* modo privado etc. */ }
  },
  del(area, k) { try { area.removeItem(k); } catch { /* */ } },
};
const ls = localStorage;
const ss = sessionStorage;

const state = {
  init: null,
  nome: store.get(ls, K.nome) || '',
  carrinho: carregarCarrinho(), // { sabor_id: qtd }
  tela: null,
  depoisDoNome: 'pedido',
  enviando: false,
  reqRegistrar: null,           // request_id reaproveitado no "tentar de novo" (evita duplicar)
  conta: null,                  // { saldo, pendente }
  acabouDeRegistrar: false,
  valorEditado: false,
  pixCodigo: null,
  enviandoPaguei: false,
  reqPaguei: null,
};

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

function deviceId() {
  let d = store.get(ls, K.device);
  if (!d || !/^[A-Za-z0-9-]{8,64}$/.test(d)) {
    d = uuid();
    store.set(ls, K.device, d);
  }
  return d;
}

function carregarCarrinho() {
  const c = store.get(ss, K.carrinho, true);
  const out = {};
  if (c && typeof c === 'object') {
    for (const [id, q] of Object.entries(c)) {
      if (Number.isInteger(q) && q > 0 && q <= MAX_QTD) out[id] = q;
    }
  }
  return out;
}
const salvarCarrinho = () => store.set(ss, K.carrinho, state.carrinho);

const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limparNome = s => String(s).replace(/\s+/g, ' ').trim();
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

let retryFn = null;
function erro(msg, retry) {
  $('erro-msg').textContent = msg;
  $('erro-retry').hidden = !retry;
  retryFn = retry || null;
  $('erro').hidden = false;
  $('erro').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function limparErro() {
  $('erro').hidden = true;
  retryFn = null;
}

/* ------------------------------------------------------------------ */
/* navegação                                                           */
/* ------------------------------------------------------------------ */

function mostrar(tela) {
  state.tela = tela;
  $('carregando').hidden = true;
  for (const t of ['nome', 'pedido', 'conta']) $('tela-' + t).hidden = t !== tela;
  $('barra').hidden = tela !== 'pedido';
  $('btn-conta').hidden = tela === 'conta';
  renderDesfazer();
}

function irInicio() {
  if (location.hash === '#conta') {
    history.replaceState(null, '', location.pathname + location.search);
    return abrirConta();
  }
  if (!state.nome) return abrirNome('pedido');
  abrirPedido();
}

/* ------------------------------------------------------------------ */
/* carregamento                                                        */
/* ------------------------------------------------------------------ */

async function boot() {
  limparErro();
  deviceId();
  const cache = store.get(ls, K.init, true);
  if (!state.init && cache && Array.isArray(cache.sabores)) {
    aplicarInit(cache);
    irInicio();
  }
  try {
    const data = await api('init');
    store.set(ls, K.init, data);
    const primeiraVez = !state.init;
    aplicarInit(data);
    if (primeiraVez) irInicio();
  } catch (e) {
    if (!state.init) {
      $('carregando').hidden = true;
      erro(`Não consegui carregar. (${e.message})`, boot);
    }
  }
}

function aplicarInit(data) {
  state.init = data;
  $('titulo').textContent = data.titulo || 'Cookies';
  $('subtitulo').textContent = data.subtitulo || 'feitos com carinho';
  document.title = `${data.titulo || 'Cookies'} 🍪`;
  // tira do carrinho sabores que saíram do cardápio
  const ids = new Set(data.sabores.map(s => s.id));
  for (const id of Object.keys(state.carrinho)) if (!ids.has(id)) delete state.carrinho[id];
  salvarCarrinho();
  if (state.tela === 'pedido') renderPedido();
  if (state.tela === 'nome') renderNomes();
  if (state.tela === 'conta') renderPix();
}

/* ------------------------------------------------------------------ */
/* passo 1: nome                                                       */
/* ------------------------------------------------------------------ */

function abrirNome(depois) {
  state.depoisDoNome = depois || 'pedido';
  mostrar('nome');
  $('busca-nome').value = '';
  renderNomes();
  $('busca-nome').focus();
}

function renderNomes() {
  const q = $('busca-nome').value;
  const nq = semAcento(q);
  const pessoas = state.init?.pessoas || [];
  let lista = nq ? pessoas.filter(p => semAcento(p).includes(nq)) : pessoas.length <= 12 ? pessoas : [];
  if (nq) lista = lista.slice().sort((a, b) => semAcento(b).startsWith(nq) - semAcento(a).startsWith(nq));
  lista = lista.slice(0, 8);

  const digitado = limparNome(q);
  const exato = pessoas.some(p => p.toLowerCase() === digitado.toLowerCase());
  let html = lista.map(p => `<li><button type="button" data-nome="${esc(p)}">${esc(p)}</button></li>`).join('');
  if (digitado.length >= 2 && !exato) {
    html += `<li><button type="button" class="novo" data-novo="1">➕ Não estou na lista — sou “${esc(digitado)}”</button></li>`;
  }
  $('lista-nomes').innerHTML = html;
}

function escolherNome(nome) {
  nome = limparNome(nome);
  if (nome.length < 2 || nome.length > 40) return toast('O nome precisa ter entre 2 e 40 letras.');
  if (/^[=+\-@]/.test(nome)) return toast('Nome inválido.');
  if (nome === nome.toLowerCase()) nome = nome.replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
  if (semAcento(nome) !== semAcento(state.nome)) {
    state.conta = null;
    state.reqRegistrar = null;
  }
  state.nome = nome;
  store.set(ls, K.nome, nome);
  if (state.depoisDoNome === 'conta') abrirConta();
  else abrirPedido();
}

$('busca-nome').addEventListener('input', renderNomes);
$('busca-nome').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const botoes = $('lista-nomes').querySelectorAll('button');
  if (botoes.length === 1) botoes[0].click();
});
$('lista-nomes').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  escolherNome(b.dataset.novo ? $('busca-nome').value : b.dataset.nome);
});
$('btn-trocar').addEventListener('click', () => abrirNome('pedido'));
$('btn-trocar-2').addEventListener('click', () => abrirNome('conta'));

/* ------------------------------------------------------------------ */
/* passo 2: o que pegou                                                */
/* ------------------------------------------------------------------ */

function abrirPedido() {
  state.acabouDeRegistrar = false;
  mostrar('pedido');
  renderPedido();
}

function renderPedido() {
  $('ola-nome').textContent = state.nome;
  const sabores = state.init?.sabores || [];
  $('sabores').innerHTML = sabores.length
    ? sabores.map(s => `
      <div class="sabor" data-id="${esc(s.id)}">
        <span class="sabor-emoji" aria-hidden="true">${esc(s.emoji || '🍪')}</span>
        <div>
          <span class="sabor-nome">${esc(s.nome)}</span>
          <span class="sabor-preco">${brl(s.preco)}</span>
        </div>
        <div class="contador">
          <button type="button" class="menos" data-delta="-1" aria-label="Menos ${esc(s.nome)}">−</button>
          <output aria-live="polite">0</output>
          <button type="button" class="mais" data-delta="1" aria-label="Mais ${esc(s.nome)}">+</button>
        </div>
      </div>`).join('')
    : '<div class="card"><p>Nenhum sabor disponível agora 😢</p></div>';
  atualizarPedido();
}

function totais() {
  let qtd = 0, total = 0;
  for (const s of state.init?.sabores || []) {
    const q = state.carrinho[s.id] || 0;
    qtd += q;
    total += q * s.preco;
  }
  return { qtd, total: Math.round(total * 100) / 100 };
}

function atualizarPedido() {
  for (const el of $('sabores').querySelectorAll('.sabor')) {
    const q = state.carrinho[el.dataset.id] || 0;
    el.querySelector('output').textContent = q;
    el.classList.toggle('ativo', q > 0);
    el.querySelector('.menos').disabled = q === 0 || state.enviando;
    el.querySelector('.mais').disabled = q >= MAX_QTD || state.enviando;
  }
  const { qtd, total } = totais();
  $('total').textContent = brl(total);
  $('barra-qtd').textContent = qtd ? plural(qtd, 'cookie', 'cookies') : 'Total';
  const btn = $('btn-confirmar');
  btn.disabled = qtd === 0 || state.enviando;
  btn.textContent = state.enviando ? 'Enviando…' : 'Confirmar';
}

$('sabores').addEventListener('click', e => {
  const b = e.target.closest('button[data-delta]');
  if (!b || state.enviando) return;
  const id = b.closest('.sabor').dataset.id;
  const q = Math.max(0, Math.min(MAX_QTD, (state.carrinho[id] || 0) + Number(b.dataset.delta)));
  if (q) state.carrinho[id] = q;
  else delete state.carrinho[id];
  state.reqRegistrar = null; // pedido mudou: é uma nova requisição
  salvarCarrinho();
  atualizarPedido();
});

async function confirmar() {
  if (state.enviando) return;
  const validos = new Set((state.init?.sabores || []).map(s => s.id));
  const itens = Object.entries(state.carrinho)
    .filter(([id, q]) => q > 0 && validos.has(id))
    .map(([sabor_id, qtd]) => ({ sabor_id, qtd }));
  if (!itens.length) return;

  limparErro();
  state.enviando = true;
  state.reqRegistrar ||= uuid();
  atualizarPedido();
  try {
    const r = await api('registrar', {
      nome: state.nome,
      itens,
      device_id: deviceId(),
      request_id: state.reqRegistrar,
    });
    if (r.nome && r.nome !== state.nome) {
      state.nome = r.nome; // grafia "oficial" da planilha
      store.set(ls, K.nome, r.nome);
    }
    store.set(ls, K.undo, { ids: r.registros, ts: Date.now(), qtd: r.qtd, total: r.total, itens, nome: state.nome });
    state.carrinho = {};
    salvarCarrinho();
    state.reqRegistrar = null;
    state.conta = { saldo: r.saldo, pendente: r.pendente };
    state.enviando = false;
    abrirConta(true);
  } catch (e) {
    erro(`Não consegui salvar, tenta de novo. (${e.message})`, confirmar);
  } finally {
    state.enviando = false;
    atualizarPedido();
  }
}
$('btn-confirmar').addEventListener('click', confirmar);

/* ------------------------------------------------------------------ */
/* desfazer                                                            */
/* ------------------------------------------------------------------ */

function undoAtual() {
  const u = store.get(ls, K.undo, true);
  if (!u || !Array.isArray(u.ids) || !u.ids.length) return null;
  if (Date.now() - u.ts > UNDO_MS - UNDO_MARGEM_MS) {
    store.del(ls, K.undo);
    return null;
  }
  return u;
}

function renderDesfazer() {
  const u = undoAtual();
  const mostrarBox = !!u && (state.tela === 'pedido' || state.tela === 'conta');
  $('desfazer-box').hidden = !mostrarBox;
  if (!mostrarBox) return;
  const resto = Math.max(1, Math.ceil((UNDO_MS - UNDO_MARGEM_MS - (Date.now() - u.ts)) / 60000));
  const desc = `${plural(u.qtd, 'cookie', 'cookies')} (${brl(u.total)})`;
  $('desfazer-msg').textContent = state.acabouDeRegistrar
    ? `✅ Anotado! Você pegou ${desc}.`
    : `Último registro: ${desc}.`;
  $('btn-desfazer').textContent = `Desfazer (${resto} min)`;
}
setInterval(renderDesfazer, 15000);

async function desfazer() {
  const u = undoAtual();
  if (!u) return renderDesfazer();
  if (!confirm(`Desfazer o registro de ${plural(u.qtd, 'cookie', 'cookies')} (${brl(u.total)})?`)) return;
  const btn = $('btn-desfazer');
  btn.disabled = true;
  limparErro();
  try {
    const r = await api('desfazer', { ids: u.ids, device_id: deviceId() });
    store.del(ls, K.undo);
    // devolve a seleção para a pessoa corrigir
    state.carrinho = {};
    for (const it of u.itens || []) state.carrinho[it.sabor_id] = it.qtd;
    salvarCarrinho();
    state.conta = { saldo: r.saldo, pendente: r.pendente };
    abrirPedido();
    toast('Desfeito! Ajuste e confirme de novo.');
  } catch (e) {
    if (/minutos|mesmo celular|não encontrado/i.test(e.message)) store.del(ls, K.undo);
    erro(`Não consegui desfazer. (${e.message})`, null);
  } finally {
    btn.disabled = false;
    renderDesfazer();
  }
}
$('btn-desfazer').addEventListener('click', desfazer);

/* ------------------------------------------------------------------ */
/* passo 3: conta e Pix                                                */
/* ------------------------------------------------------------------ */

function abrirConta(depoisDeRegistrar = false) {
  if (!state.nome) return abrirNome('conta');
  state.acabouDeRegistrar = depoisDeRegistrar;
  $('conta-nome').textContent = state.nome;
  $('paguei-ok').hidden = true;
  mostrar('conta');
  renderSaldo();
  preencherValor();
  carregarSaldo();
  window.scrollTo({ top: 0 });
}

async function carregarSaldo() {
  const nome = state.nome;
  $('ultimos').innerHTML = '<li>Carregando…</li>';
  try {
    const r = await api('saldo', { nome });
    if (nome !== state.nome) return;
    const mudou = !state.conta || state.conta.saldo !== r.saldo || state.conta.pendente !== r.pendente;
    state.conta = { saldo: r.saldo, pendente: r.pendente };
    renderSaldo();
    if (mudou && !state.valorEditado) preencherValor();
    renderUltimos(r.ultimos || []);
  } catch (e) {
    $('ultimos').innerHTML = '<li>Não consegui carregar.</li>';
    if (!state.conta) erro(`Não consegui carregar sua conta. (${e.message})`, carregarSaldo);
  }
}

function renderSaldo() {
  const c = state.conta;
  const extra = $('saldo-extra');
  const pend = $('saldo-pendente');
  if (!c) {
    $('saldo-valor').textContent = '…';
    extra.hidden = pend.hidden = true;
    return;
  }
  $('saldo-valor').textContent = brl(Math.max(0, c.saldo));
  if (c.saldo < -0.004) {
    extra.textContent = `Você tem ${brl(-c.saldo)} de crédito 🙌`;
    extra.hidden = false;
  } else if (c.saldo < 0.005 && !(c.pendente > 0)) {
    extra.textContent = 'Tudo pago! 🎉';
    extra.hidden = false;
  } else {
    extra.hidden = true;
  }
  pend.hidden = !(c.pendente > 0);
  pend.textContent = `${brl(c.pendente)} aguardando confirmação`;
}

function renderUltimos(lista) {
  $('ultimos').innerHTML = lista.length
    ? lista.map(r => `
      <li class="${r.status === 'cancelado' ? 'cancelado' : ''}">
        <span>${esc(fmtData.format(new Date(r.data)))} · ${r.qtd}× ${esc(r.sabor_nome)}${r.status === 'cancelado' ? ' (cancelado)' : ''}</span>
        <strong>${brl(r.total)}</strong>
      </li>`).join('')
    : '<li>Nenhum registro ainda.</li>';
}

function pixConfigurado() {
  const p = state.init?.pix;
  return !!(p && p.chave && !/SUA_CHAVE/i.test(p.chave));
}

function preencherValor() {
  const c = state.conta;
  const aPagar = c ? Math.round((c.saldo - c.pendente) * 100) / 100 : 0;
  $('valor-pix').value = aPagar > 0 ? valorInput(aPagar) : '';
  state.valorEditado = false;
  renderPix();
}

function renderPix() {
  const ok = pixConfigurado();
  $('pix-off').hidden = ok;
  $('pix-on').hidden = !ok;
  if (!ok) return;
  const pix = state.init.pix;
  const v = parseValor($('valor-pix').value);
  const valido = v > 0 && v <= 10000;
  let codigo = null;
  if (valido) {
    try { codigo = gerarPix({ ...pix, valor: v }); } catch { codigo = null; }
  }
  state.pixCodigo = codigo;
  const svg = codigo ? qrSvg(codigo, { label: `QR code Pix de ${brl(v)}` }) : null;
  $('pix-qr').hidden = !svg;
  $('pix-qr').innerHTML = svg || '';
  $('pix-info').hidden = !codigo;
  $('pix-info').textContent = codigo
    ? (svg ? `${brl(v)} para ${pix.nome}` : 'QR indisponível agora — use o copia e cola.')
    : '';
  $('btn-copiar').disabled = !codigo;
  $('btn-paguei').disabled = !valido || state.enviandoPaguei;
}

let pixTimer;
$('valor-pix').addEventListener('input', () => {
  state.valorEditado = true;
  $('paguei-ok').hidden = true;
  clearTimeout(pixTimer);
  pixTimer = setTimeout(renderPix, 200);
});
$('valor-pix').addEventListener('blur', () => {
  const v = parseValor($('valor-pix').value);
  if (v > 0) $('valor-pix').value = valorInput(v);
  renderPix();
});

async function copiar() {
  if (!state.pixCodigo) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(state.pixCodigo);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = state.pixCodigo;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  const b = $('btn-copiar');
  b.textContent = ok ? '✔ Copiado!' : 'Não deu pra copiar 😕';
  setTimeout(() => { b.textContent = '📋 Copiar Pix copia e cola'; }, 2000);
  if (ok) toast('Copiado! Agora é só colar no app do banco.');
}
$('btn-copiar').addEventListener('click', copiar);

async function enviarPaguei(v) {
  if (state.enviandoPaguei) return;
  if (!state.reqPaguei || state.reqPaguei.valor !== v) state.reqPaguei = { valor: v, id: uuid() };
  state.enviandoPaguei = true;
  const btn = $('btn-paguei');
  btn.textContent = 'Enviando…';
  renderPix();
  limparErro();
  try {
    const r = await api('jaPaguei', { nome: state.nome, valor: v, request_id: state.reqPaguei.id });
    state.reqPaguei = null;
    state.conta = { saldo: r.saldo, pendente: r.pendente };
    state.enviandoPaguei = false;
    renderSaldo();
    preencherValor();
    $('paguei-ok').hidden = false;
  } catch (e) {
    erro(`Não consegui avisar o pagamento, tenta de novo. (${e.message})`, () => enviarPaguei(v));
  } finally {
    state.enviandoPaguei = false;
    btn.textContent = '✅ Já paguei';
    renderPix();
  }
}
$('btn-paguei').addEventListener('click', () => {
  const v = parseValor($('valor-pix').value);
  if (!(v > 0)) return;
  if (!confirm(`Confirma que você pagou ${brl(v)} por Pix?`)) return;
  enviarPaguei(v);
});

/* ------------------------------------------------------------------ */
/* botões gerais                                                       */
/* ------------------------------------------------------------------ */

$('btn-conta').addEventListener('click', () => abrirConta());
$('btn-voltar').addEventListener('click', () => {
  if (!state.nome) return abrirNome('pedido');
  abrirPedido();
  window.scrollTo({ top: 0 });
});
$('erro-retry').addEventListener('click', () => {
  const f = retryFn;
  limparErro();
  if (f) f();
});

boot();
