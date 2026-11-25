import { api, brl, esc, parseValor, valorInput } from './api.js';

// O PIN nunca fica no código: a pessoa digita, ele vai em cada requisição e o Apps Script confere.
const K_PIN = 'cookies.admin_pin';
const SITE_URL = location.origin + '/#conta'; // link da cobrança já abre a tela de pagar

const $ = id => document.getElementById(id);
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

let pin = sessionStorage.getItem(K_PIN) || '';
let resumo = null;
let histNome = null;

/* ------------------------------------------------------------------ */

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function erro(msg) {
  $('erro-msg').textContent = msg;
  $('erro').hidden = !msg;
}

const dias = iso => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const haDias = d => (d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`);
const dataCurta = iso => (iso ? fmtData.format(new Date(iso)) : '—');

const adm = (action, payload = {}) => api(action, { ...payload, pin });

function isErroPin(msg) {
  return /PIN|tentativas/i.test(msg);
}

/* ------------------------------------------------------------------ */
/* login                                                               */
/* ------------------------------------------------------------------ */

function mostrarLogin(msg) {
  $('tela-pin').hidden = false;
  $('tela-painel').hidden = true;
  $('topo-acoes').hidden = true;
  erro(msg || '');
  $('pin').value = '';
  $('pin').focus();
}

$('form-pin').addEventListener('submit', async e => {
  e.preventDefault();
  pin = $('pin').value.trim();
  if (!pin) return;
  const btn = $('btn-entrar');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  await carregar();
  btn.disabled = false;
  btn.textContent = 'Entrar';
});

$('btn-sair').addEventListener('click', () => {
  sessionStorage.removeItem(K_PIN);
  pin = '';
  mostrarLogin();
});

/* ------------------------------------------------------------------ */
/* resumo                                                              */
/* ------------------------------------------------------------------ */

async function carregar() {
  const btn = $('btn-atualizar');
  btn.disabled = true;
  try {
    resumo = await adm('adminResumo');
    sessionStorage.setItem(K_PIN, pin);
    erro('');
    $('tela-pin').hidden = true;
    $('tela-painel').hidden = false;
    $('topo-acoes').hidden = false;
    render();
  } catch (e) {
    if (isErroPin(e.message)) {
      sessionStorage.removeItem(K_PIN);
      mostrarLogin(e.message);
    } else {
      erro(`Não consegui carregar. (${e.message})`);
      if (!resumo) $('tela-pin').hidden = false;
    }
  } finally {
    btn.disabled = false;
  }
}
$('btn-atualizar').addEventListener('click', carregar);

function render() {
  $('total-receber').textContent = brl(resumo.total_a_receber);
  $('total-mes').textContent = brl(resumo.total_recebido_mes);

  const ag = resumo.pagamentos_aguardando;
  $('box-aguardando').classList.toggle('destaque', ag.length > 0);
  $('aguardando').innerHTML = ag.length
    ? ag.map(p => `
      <div class="item">
        <div class="item-main">
          <div class="item-nome">${esc(p.nome)}</div>
          <div class="item-sub">${dataCurta(p.data)}${p.obs ? ' · ' + esc(p.obs) : ''}</div>
        </div>
        <div class="item-valor">${brl(p.valor)}</div>
        <div class="item-acoes">
          <button type="button" class="btn btn-sm btn-ok" data-acao="confirmar" data-id="${esc(p.id)}">✅ Confirmar</button>
          <button type="button" class="btn btn-sm btn-sec" data-acao="rejeitar" data-id="${esc(p.id)}" data-desc="${esc(p.nome + ' — ' + brl(p.valor))}">❌ Rejeitar</button>
        </div>
      </div>`).join('')
    : '<p class="vazio">Nada para confirmar. 👌</p>';

  const dev = resumo.devedores;
  $('devedores').innerHTML = dev.length
    ? dev.map(d => {
      const dUlt = dias(d.ultima_compra);
      const dDeve = dias(d.deve_desde);
      const atrasado = d.saldo > 0 && dDeve !== null && dDeve > 7;
      const msg = `Oi ${d.nome}! Tá devendo ${brl(d.saldo)} dos cookies 🍪 Paga por aqui: ${SITE_URL}`;
      const sub = [
        d.ultima_compra ? `Última compra ${fmtDia.format(new Date(d.ultima_compra))} (${haDias(dUlt)})` : 'Sem compras',
        atrasado ? `<span class="tag-atraso">deve desde ${fmtDia.format(new Date(d.deve_desde))} (${dDeve} dias)</span>` : '',
        d.pendente > 0 ? `<span class="tag tag-aguardando">${brl(d.pendente)} aguardando</span>` : '',
      ].filter(Boolean).join(' · ');
      return `
      <div class="item ${atrasado ? 'atrasado' : ''}">
        <div class="item-main">
          <button type="button" class="link item-nome" data-acao="hist" data-nome="${esc(d.nome)}">${atrasado ? '⚠️ ' : ''}${esc(d.nome)}</button>
          <div class="item-sub">${sub}</div>
        </div>
        <div class="item-valor">${brl(d.saldo)}</div>
        ${d.saldo > 0 ? `
        <div class="item-acoes">
          <button type="button" class="btn btn-sm btn-ok" data-acao="dinheiro" data-nome="${esc(d.nome)}" data-saldo="${d.saldo}">💵 Recebi em dinheiro</button>
          <a class="btn btn-sm btn-sec" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 Cobrar no WhatsApp</a>
        </div>` : ''}
      </div>`;
    }).join('')
    : '<p class="vazio">Ninguém devendo. 🎉</p>';

  $('atualizado').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ------------------------------------------------------------------ */
/* ações                                                               */
/* ------------------------------------------------------------------ */

async function executar(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await carregar();
    if (histNome && $('dlg-hist').open) await abrirHistorico(histNome);
  } catch (e) {
    if (isErroPin(e.message)) {
      sessionStorage.removeItem(K_PIN);
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      return mostrarLogin(e.message);
    }
    toast(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const { acao, id, nome } = b.dataset;
  if (acao === 'confirmar') {
    executar(b, () => adm('adminConfirmar', { pagamento_id: id }), 'Pagamento confirmado ✅');
  } else if (acao === 'rejeitar') {
    if (!confirm(`Rejeitar o pagamento de ${b.dataset.desc || 'esta pessoa'}? A dívida continua.`)) return;
    executar(b, () => adm('adminRejeitar', { pagamento_id: id }), 'Pagamento rejeitado');
  } else if (acao === 'cancelar') {
    if (!confirm(`Cancelar o registro "${b.dataset.desc}"? Isso tira o valor da conta da pessoa.`)) return;
    executar(b, () => adm('adminCancelarRegistro', { registro_id: id }), 'Registro cancelado');
  } else if (acao === 'hist') {
    abrirHistorico(nome);
  } else if (acao === 'dinheiro') {
    abrirDinheiro(nome, Number(b.dataset.saldo) || 0);
  }
});

/* ------------------------------------------------------------------ */
/* histórico                                                           */
/* ------------------------------------------------------------------ */

async function abrirHistorico(nome) {
  histNome = nome;
  const dlg = $('dlg-hist');
  $('hist-nome').textContent = nome;
  $('hist-saldo').textContent = '';
  $('hist-acoes').innerHTML = '';
  if (!dlg.open) {
    $('hist-corpo').innerHTML = '<p class="vazio">Carregando…</p>';
    dlg.showModal();
  }
  let h;
  try {
    h = await adm('adminHistorico', { nome });
  } catch (e) {
    $('hist-corpo').innerHTML = `<p class="vazio">Erro: ${esc(e.message)}</p>`;
    return;
  }
  if (histNome !== nome) return;
  $('hist-saldo').textContent = `Deve ${brl(h.saldo)}${h.pendente > 0 ? ` · ${brl(h.pendente)} aguardando` : ''}`;
  const msg = `Oi ${h.nome}! Tá devendo ${brl(h.saldo)} dos cookies 🍪 Paga por aqui: ${SITE_URL}`;
  $('hist-acoes').innerHTML = `
    <button type="button" class="btn btn-sm btn-ok" data-acao="dinheiro" data-nome="${esc(h.nome)}" data-saldo="${h.saldo}">💵 Recebi em dinheiro</button>
    ${h.saldo > 0 ? `<a class="btn btn-sm btn-sec" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">💬 Cobrar no WhatsApp</a>` : ''}`;

  const regs = h.registros.map(r => `
    <div class="item">
      <div class="item-main">
        <div>${r.qtd}× ${esc(r.sabor_nome)} <span class="tag tag-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="item-sub">${dataCurta(r.data)} · ${brl(r.preco_unit)} cada</div>
      </div>
      <div class="item-valor">${brl(r.total)}</div>
      ${r.status === 'ativo' ? `<button type="button" class="btn btn-sm btn-sec" data-acao="cancelar" data-id="${esc(r.id)}" data-desc="${esc(`${r.qtd}× ${r.sabor_nome} — ${brl(r.total)}`)}">Cancelar</button>` : ''}
    </div>`).join('') || '<p class="vazio">Nenhum registro.</p>';

  const pags = h.pagamentos.map(p => `
    <div class="item">
      <div class="item-main">
        <div><span class="tag tag-${esc(p.status)}">${esc(p.status)}</span> ${esc(p.obs)}</div>
        <div class="item-sub">${dataCurta(p.data)}${p.confirmado_em ? ' · confirmado ' + dataCurta(p.confirmado_em) : ''}</div>
      </div>
      <div class="item-valor">${brl(p.valor)}</div>
      ${p.status === 'aguardando' ? `
        <div class="item-acoes">
          <button type="button" class="btn btn-sm btn-ok" data-acao="confirmar" data-id="${esc(p.id)}">✅ Confirmar</button>
          <button type="button" class="btn btn-sm btn-sec" data-acao="rejeitar" data-id="${esc(p.id)}" data-desc="${esc(h.nome + ' — ' + brl(p.valor))}">❌ Rejeitar</button>
        </div>` : ''}
      ${p.status === 'rejeitado' ? `<button type="button" class="btn btn-sm btn-sec" data-acao="confirmar" data-id="${esc(p.id)}">Confirmar mesmo assim</button>` : ''}
    </div>`).join('') || '<p class="vazio">Nenhum pagamento.</p>';

  $('hist-corpo').innerHTML = `<h3>Cookies</h3>${regs}<h3>Pagamentos</h3>${pags}`;
}

/* ------------------------------------------------------------------ */
/* pagamento em dinheiro                                               */
/* ------------------------------------------------------------------ */

let dinNome = null;
function abrirDinheiro(nome, saldo) {
  dinNome = nome;
  $('din-nome').textContent = `${nome} · deve ${brl(saldo)}`;
  $('din-valor').value = saldo > 0 ? valorInput(saldo) : '';
  $('din-obs').value = '';
  $('dlg-dinheiro').showModal();
  $('din-valor').select();
}

$('form-dinheiro').addEventListener('submit', e => {
  e.preventDefault();
  const valor = parseValor($('din-valor').value);
  if (!(valor > 0)) return toast('Valor inválido.');
  const obs = $('din-obs').value.trim() || 'Dinheiro';
  executar($('din-salvar'), async () => {
    await adm('adminPagamentoManual', { nome: dinNome, valor, obs });
    $('dlg-dinheiro').close();
  }, `Pagamento de ${brl(valor)} registrado 💵`);
});

/* ------------------------------------------------------------------ */
/* diálogos                                                            */
/* ------------------------------------------------------------------ */

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-fechar]')) return dlg.close();
    if (e.target !== dlg) return;
    // clique no fundo escuro (fora da caixa) fecha; clique no padding da caixa não
    const r = dlg.getBoundingClientRect();
    const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (fora) dlg.close();
  });
}
$('dlg-hist').addEventListener('close', () => { histNome = null; });

/* ------------------------------------------------------------------ */

if (pin) carregar();
else mostrarLogin();
