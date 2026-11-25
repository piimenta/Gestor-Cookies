import { API_URL } from './config.js';

const TIMEOUT_MS = 25000; // o Apps Script às vezes demora para "acordar"

/**
 * Chama a API do Apps Script.
 * IMPORTANTE: não definir Content-Type. Vai como text/plain (simple request, sem preflight CORS).
 */
export async function api(action, payload = {}) {
  if (!API_URL || !API_URL.startsWith('https://')) {
    throw new Error('API não configurada (edite js/config.js).');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ ...payload, action }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'A conexão demorou demais.' : 'Sem conexão com o servidor.');
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Resposta inválida do servidor.');
  }
  if (!json.ok) throw new Error(json.error || 'Erro desconhecido.');
  return json.data;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = v => fmtBRL.format(Number(v) || 0);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Lê "12,50" / "12.50" / "R$ 12,50" → 12.5 (NaN se inválido). */
export function parseValor(str) {
  let s = String(str || '').replace(/[^\d,.]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const valorInput = v => (Number(v) || 0).toFixed(2).replace('.', ',');
