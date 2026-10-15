// Servidor local para probar sin Netlify: sirve /public y la API con una base en memoria.
// Usuarios de prueba: chascomus / prueba  y  laplata / prueba
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { crearApp } from './src/server/app.mjs';
import { storeEnMemoria } from './src/server/datos.mjs';
import { hashearClave } from './src/server/auth.mjs';

const PUERTO = Number(process.env.PORT || 8888);
const hash = hashearClave('prueba');
const manejar = crearApp({
  store: storeEnMemoria(),
  entorno: { USUARIOS: `chascomus:${hash},laplata:${hash}`, SESSION_SECRET: 'secreto-de-desarrollo' },
});

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await manejar(
      new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }),
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const ruta = normalize(join('public', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!ruta.startsWith('public')) return res.writeHead(403).end();
  try {
    const contenido = await readFile(ruta);
    res.writeHead(200, { 'content-type': tipos[extname(ruta)] || 'application/octet-stream' });
    res.end(contenido);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(PUERTO, () => console.log(`Planilla en http://localhost:${PUERTO}  (usuarios: chascomus / laplata, clave: prueba)`));
