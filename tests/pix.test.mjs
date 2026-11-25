import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, gerarPix, normalizarChave, limparTexto } from '../js/pix.js';

/** Lê o BR Code em {id: valor} (um nível) para conferir os campos. */
function parse(code) {
  const out = {};
  let i = 0;
  while (i < code.length) {
    const id = code.slice(i, i + 2);
    const len = Number(code.slice(i + 2, i + 4));
    out[id] = code.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

test('CRC16-CCITT-FALSE: vetor de referência "123456789" = 29B1', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('CRC bate com o exemplo do manual do BR Code do Banco Central', () => {
  const semCrc =
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000' +
    '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(semCrc), '1D3D');
});

test('gera Pix com valor, nome, cidade e CRC válidos', () => {
  const code = gerarPix({ chave: '45281715895', nome: 'Victor Antônio', cidade: 'São Paulo', valor: 22 });
  const f = parse(code);
  assert.equal(f['00'], '01');
  assert.equal(f['26'], '0014br.gov.bcb.pix011145281715895');
  assert.equal(f['52'], '0000');
  assert.equal(f['53'], '986');
  assert.equal(f['54'], '22.00');
  assert.equal(f['58'], 'BR');
  assert.equal(f['59'], 'VICTOR ANTONIO');
  assert.equal(f['60'], 'SAO PAULO');
  assert.equal(f['62'], '0503***');
  assert.ok(code.includes('6304'));
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
  assert.match(code.slice(-4), /^[0-9A-F]{4}$/);
});

test('omite o campo 54 quando valor é 0', () => {
  const f = parse(gerarPix({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 0 }));
  assert.equal(f['54'], undefined);
});

test('valor quebrado com 2 casas', () => {
  const f = parse(gerarPix({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 12.5 }));
  assert.equal(f['54'], '12.50');
  const g = parse(gerarPix({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 0.1 + 0.2 }));
  assert.equal(g['54'], '0.30');
});

test('corta nome em 25 e cidade em 15, sem acento e sem emoji', () => {
  const f = parse(gerarPix({ chave: 'a@b.com', nome: 'José da Silva Sauro Júnior Neto 🍪', cidade: 'São José dos Campos', valor: 1 }));
  assert.ok(f['59'].length <= 25);
  assert.equal(f['59'], 'JOSE DA SILVA SAURO JUNIO');
  assert.equal(f['60'], 'SAO JOSE DOS CA');
  assert.equal(limparTexto('Ação ❤️ ok', 25), 'ACAO OK');
});

test('normaliza chaves', () => {
  assert.equal(normalizarChave('+55 (11) 99999-9999'), '+5511999999999');
  assert.equal(normalizarChave('5511999999999'), '+5511999999999');
  assert.equal(normalizarChave('452.817.158-95'), '45281715895');
  assert.equal(normalizarChave('45281715895'), '45281715895');
  assert.equal(normalizarChave(' Fulano@Email.com '), 'fulano@email.com');
  assert.equal(normalizarChave('123e4567-e12b-12d1-a456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
});

test('txid inválido vira ***', () => {
  const f = parse(gerarPix({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 1, txid: 'com espaço!' }));
  assert.equal(f['62'], '0503***');
});
