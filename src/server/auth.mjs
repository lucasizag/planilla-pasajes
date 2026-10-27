import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Las cuentas vienen de la variable de entorno USUARIOS, con este formato:
//   chascomus:scrypt$<sal>$<hash>,laplata:scrypt$<sal>$<hash>
// Los hashes se generan con:  npm run clave -- "la-contraseña"

export function hashearClave(clave) {
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync(clave, sal, 32).toString('hex');
  return `scrypt$${sal}$${hash}`;
}

export function verificarClave(clave, guardado) {
  guardado = String(guardado || '');
  if (!guardado.startsWith('scrypt$')) {
    // Contraseña escrita tal cual en la variable (más simple de configurar).
    if (!guardado) return false;
    const a = createHmac('sha256', 'cmp').update(String(clave)).digest();
    const b = createHmac('sha256', 'cmp').update(guardado).digest();
    return timingSafeEqual(a, b);
  }
  const [tipo, sal, hash] = guardado.split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const calculado = scryptSync(String(clave), sal, 32);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export function leerUsuarios(texto) {
  const usuarios = new Map();
  // Acepta separadores coma, punto y coma o salto de línea; "usuario:clave" o "usuario=clave"; con o sin comillas.
  for (let parte of String(texto || '').split(/[,;\n\r]+/)) {
    parte = parte.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    const i = parte.search(/[:=]/);
    if (i <= 0) continue;
    const usuario = parte.slice(0, i).trim().toLowerCase();
    const clave = parte.slice(i + 1).trim();
    if (usuario && clave) usuarios.set(usuario, clave);
  }
  return usuarios;
}

const DURACION = 1000 * 60 * 60 * 24 * 30; // 30 días

function firmar(payload, secreto) {
  return createHmac('sha256', secreto).update(payload).digest('base64url');
}

export function crearSesion(usuario, secreto) {
  const payload = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + DURACION })).toString('base64url');
  return `${payload}.${firmar(payload, secreto)}`;
}

// Igual que leerSesion, pero explica por qué falla (para diagnosticar).
export function revisarSesion(token, secreto) {
  if (!secreto) return { motivo: 'sin-secreto' };
  if (!token) return { motivo: 'sin-sesion' };
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return { motivo: 'formato' };
  const esperada = firmar(payload, secreto);
  if (esperada.length !== firma.length || !timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return { motivo: 'firma' };
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > Date.now() ? { usuario: u } : { motivo: 'vencida' };
  } catch {
    return { motivo: 'formato' };
  }
}

export function leerSesion(token, secreto) {
  if (!token || !secreto) return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = firmar(payload, secreto);
  if (esperada.length !== firma.length || !timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}

export function leerCookie(req, nombre) {
  const header = req.headers.get('cookie') || '';
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieSesion(token, segura) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${DURACION / 1000}`];
  if (segura) flags.push('Secure');
  return `sesion=${encodeURIComponent(token)}; ${flags.join('; ')}`;
}

export function cookieBorrar(segura) {
  return `sesion=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${segura ? '; Secure' : ''}`;
}
