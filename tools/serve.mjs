// Servidor estático para teste local: `npm run dev` (ou `node tools/serve.mjs 5500`).
// Sem dependências. Serve a raiz do projeto (inclusive apps-script/Code.gs, usado pelo modo teste).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let PORT = Number(process.argv[2] || process.env.PORT || 5500);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gs': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (caminho.endsWith('/')) caminho += 'index.html';
    const arquivo = normalize(join(ROOT, caminho));
    if (!arquivo.startsWith(ROOT) || arquivo.split(sep).includes('.git')) throw Object.assign(new Error(), { code: 'ENOENT' });
    if ((await stat(arquivo)).isDirectory()) throw Object.assign(new Error(), { code: 'ENOENT' });
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(corpo);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.code === 'ENOENT' ? 'Não encontrado' : 'Erro');
  }
  console.log(res.statusCode, req.method, req.url);
});

// porta ocupada (ex.: um container Docker)? tenta a próxima
server.on('error', e => {
  if (e.code !== 'EADDRINUSE' || PORT > 5520) throw e;
  console.log(`Porta ${PORT} ocupada, tentando ${PORT + 1}…`);
  server.listen(++PORT);
});

server.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n🍪 Cookies rodando em:\n`);
  console.log(`   Cliente:  http://localhost:${PORT}/`);
  console.log(`   Painel:   http://localhost:${PORT}/admin.html   (PIN do modo teste: 1234)`);
  console.log(`   Cartaz:   http://localhost:${PORT}/qr.html`);
  for (const ip of ips) console.log(`   No celular (mesma rede): http://${ip}:${PORT}/?demo`);
  console.log(`\nCtrl+C para parar.\n`);
});
