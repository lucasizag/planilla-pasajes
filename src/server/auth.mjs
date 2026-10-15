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
  const [tipo, sal, hash] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const calculado = scryptSync(String(clave), sal, 32);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export function leerUsuarios(texto) {
  const usuarios = new Map();
  for (const parte of String(texto || '').split(',')) {
    const i = parte.indexOf(':');
    if (i <= 0) continue;
    usuarios.set(parte.slice(0, i).trim().toLowerCase(), parte.slice(i + 1).trim());
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
