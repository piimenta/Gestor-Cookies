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

/** Mensagem de cobrança do WhatsApp. deveDesde = compra mais antiga ainda não paga. */
function msgCobranca(nome, saldo, deveDesde) {
  const d = dias(deveDesde);
  const tempo = d >= 2 ? ` fazem ${d} dias` : d === 1 ? ' faz 1 dia' : '';
  return `Boa tarde, ${nome}, tudo bem?? Vi que você ta devendo ${brl(saldo)} em cookies${tempo}, ` +
    `quando puder, por favor, faça o pagamento! Obrigado!!\nlink para pagar: ${SITE_URL}`;
}
const linkWhats = msg => `https://wa.me/?text=${encodeURIComponent(msg)}`;

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
      const msg = msgCobranca(d.nome, d.saldo, d.deve_desde);
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
          <a class="btn btn-sm btn-sec" href="${linkWhats(msg)}" target="_blank" rel="noopener">💬 Cobrar no WhatsApp</a>
        </div>` : ''}
      </div>`;
    }).join('')
    : '<p class="vazio">Ninguém devendo. 🎉</p>';

  const cli = resumo.clientes || [];
  $('resumo-clientes').textContent = `Todos os clientes (${cli.length})`;
  $('clientes').innerHTML = cli.length
    ? cli.map(c => `
      <div class="item item-cliente">
        <div class="item-main">
          <button type="button" class="link item-nome" data-acao="hist" data-nome="${esc(c.nome)}">${esc(c.nome)}</button>
          <div class="item-sub">${c.ultima_compra ? `Última compra ${fmtDia.format(new Date(c.ultima_compra))} (${haDias(dias(c.ultima_compra))})` : 'Sem compras'}${c.pendente > 0 ? ` · ${brl(c.pendente)} aguardando` : ''}</div>
        </div>
        <div class="item-valor">${c.saldo > 0.004 ? brl(c.saldo) : c.saldo < -0.004 ? `crédito ${brl(-c.saldo)}` : '—'}</div>
        <button type="button" class="btn btn-mini btn-perigo" data-acao="remover" data-nome="${esc(c.nome)}" data-saldo="${c.saldo}" aria-label="Remover ${esc(c.nome)}">🗑️</button>
      </div>`).join('')
    : '<p class="vazio">Nenhum cliente ainda.</p>';

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
    toast(/Ação desconhecida/.test(e.message)
      ? 'Essa função é nova: cole o Code.gs atualizado no Apps Script e implante uma Nova versão.'
      : e.message);
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
  } else if (acao === 'apagar-reg') {
    if (!confirm(`Apagar a compra "${b.dataset.desc}"?\n\nEla some da planilha e sai da conta da pessoa.`)) return;
    executar(b, () => adm('adminApagarRegistro', { registro_id: id }), 'Compra apagada 🗑️');
  } else if (acao === 'apagar-pag') {
    const aviso = b.dataset.status === 'confirmado' ? '\n\nAtenção: é um pagamento CONFIRMADO, então a dívida da pessoa volta a subir.' : '';
    if (!confirm(`Apagar o pagamento "${b.dataset.desc}"?${aviso}`)) return;
    executar(b, () => adm('adminApagarPagamento', { pagamento_id: id }), 'Pagamento apagado 🗑️');
  } else if (acao === 'limpar-hist') {
    if (!confirm(`Limpar o histórico de ${nome}?\n\nApaga TODAS as compras e pagamentos (a conta fica zerada). A pessoa continua na lista.`)) return;
    executar(b, () => adm('adminLimparHistorico', { nome }), `Histórico de ${nome} apagado 🧹`);
  } else if (acao === 'remover') {
    const saldo = Number(b.dataset.saldo) || 0;
    const deve = saldo > 0.004 ? `\n\nAtenção: ${nome} ainda deve ${brl(saldo)}. Essa dívida será apagada.` : '';
    if (!confirm(`Remover ${nome}?\n\nTira da lista de nomes e apaga todas as compras e pagamentos.${deve}`)) return;
    executar(b, async () => {
      await adm('adminRemoverPessoa', { nome });
      if ($('dlg-hist').open) $('dlg-hist').close();
    }, `${nome} removido 🗑️`);
  } else if (acao === 'limpar-cancelados') {
    if (!confirm('Apagar da planilha todas as compras canceladas e pagamentos rejeitados?')) return;
    executar(b, async () => {
      const r = await adm('adminLimparCancelados');
      toast(`Apagados: ${r.registros} compra(s) e ${r.pagamentos} pagamento(s).`);
    });
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
  const dev = resumo?.devedores.find(x => x.nome.toLowerCase() === h.nome.toLowerCase());
  const msg = msgCobranca(h.nome, h.saldo, dev?.deve_desde);
  $('hist-acoes').innerHTML = `
    <button type="button" class="btn btn-sm btn-ok" data-acao="dinheiro" data-nome="${esc(h.nome)}" data-saldo="${h.saldo}">💵 Recebi em dinheiro</button>
    ${h.saldo > 0 ? `<a class="btn btn-sm btn-sec" href="${linkWhats(msg)}" target="_blank" rel="noopener">💬 Cobrar no WhatsApp</a>` : ''}`;

  const regs = h.registros.map(r => `
    <div class="item">
      <div class="item-main">
        <div>${r.qtd}× ${esc(r.sabor_nome)} <span class="tag tag-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="item-sub">${dataCurta(r.data)} · ${brl(r.preco_unit)} cada</div>
      </div>
      <div class="item-valor">${brl(r.total)}</div>
      <button type="button" class="btn btn-mini btn-perigo" data-acao="apagar-reg" data-id="${esc(r.id)}" data-desc="${esc(`${r.qtd}× ${r.sabor_nome} — ${brl(r.total)}`)}">🗑️ Apagar</button>
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
      <button type="button" class="btn btn-mini btn-perigo" data-acao="apagar-pag" data-id="${esc(p.id)}" data-status="${esc(p.status)}" data-desc="${esc(`${brl(p.valor)} (${p.status}) de ${dataCurta(p.data)}`)}">🗑️ Apagar</button>
    </div>`).join('') || '<p class="vazio">Nenhum pagamento.</p>';

  $('hist-corpo').innerHTML = `<h3>Cookies</h3>${regs}<h3>Pagamentos</h3>${pags}
    <div class="zona-perigo">
      <button type="button" class="btn btn-sm btn-perigo" data-acao="limpar-hist" data-nome="${esc(h.nome)}">🧹 Limpar histórico</button>
      <button type="button" class="btn btn-sm btn-perigo" data-acao="remover" data-nome="${esc(h.nome)}" data-saldo="${h.saldo}">🗑️ Remover cliente</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* adicionar cliente                                                   */
/* ------------------------------------------------------------------ */

$('form-cliente').addEventListener('submit', e => {
  e.preventDefault();
  const nome = $('novo-cliente').value.replace(/\s+/g, ' ').trim();
  if (nome.length < 2) return toast('Digite o nome (mínimo 2 letras).');
  executar($('btn-add-cliente'), async () => {
    await adm('adminAdicionarPessoa', { nome });
    $('novo-cliente').value = '';
  }, `${nome} adicionado ✅`);
});

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
