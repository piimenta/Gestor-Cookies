// Gerador de BR Code Pix estático ("copia e cola"), padrão EMV do Banco Central.

const enc = new TextEncoder();

/** CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF, sem reflexão, sem XOR final. Retorna 4 hex maiúsculos. */
export function crc16(str) {
  let crc = 0xffff;
  for (const byte of enc.encode(str)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function campo(id, valor) {
  const len = enc.encode(valor).length;
  if (len > 99) throw new Error(`Campo Pix ${id} muito longo`);
  return id + String(len).padStart(2, '0') + valor;
}

/** Remove acentos e qualquer caractere fora do ASCII imprimível; MAIÚSCULO; corta no limite. */
export function limparTexto(str, max) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/**
 * Normaliza a chave Pix:
 * - telefone "+55 (11) 99999-9999" → "+5511999999999" (e "5511999999999" ganha o "+")
 * - CPF/CNPJ com pontuação → só dígitos
 * - e-mail e chave aleatória ficam como estão
 */
export function normalizarChave(chave) {
  let c = String(chave || '').trim();
  if (c.startsWith('+')) return '+' + c.replace(/\D/g, '');
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(c) || /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(c)) return c.replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(c)) return '+' + c; // telefone sem o "+" (12–13 dígitos começando com 55)
  if (c.includes('@')) return c.toLowerCase();
  return c;
}

export function gerarPix({ chave, nome, cidade, valor, txid = '***' }) {
  const k = normalizarChave(chave);
  if (!k) throw new Error('Chave Pix não configurada');
  const n = limparTexto(nome, 25) || 'RECEBEDOR';
  const c = limparTexto(cidade, 15) || 'BRASIL';
  const t = /^[A-Za-z0-9]{1,25}$/.test(txid) ? txid : '***';

  let payload =
    campo('00', '01') +
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', k)) +
    campo('52', '0000') +
    campo('53', '986');
  const v = Math.round(Number(valor) * 100) / 100;
  if (v > 0) payload += campo('54', v.toFixed(2));
  payload +=
    campo('58', 'BR') +
    campo('59', n) +
    campo('60', c) +
    campo('62', campo('05', t)) +
    '6304';
  return payload + crc16(payload);
}
