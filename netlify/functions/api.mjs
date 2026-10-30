import { getStore } from '@netlify/blobs';
import { crearApp } from '../../src/server/app.mjs';

// Lee la variable de entorno de Netlify, con process.env como respaldo.
const leerVariable = (k) => {
  try {
    const v = globalThis.Netlify?.env?.get(k);
    if (v) return v.trim();
  } catch {}
  return (process.env[k] || '').trim();
};

// IMPORTANTE: la conexión a Netlify Blobs se abre de nuevo en cada operación.
// Netlify da una credencial que vence; si se reutiliza la misma conexión en una
// función que queda "despierta", después de un rato falla con "Token expired".
const abrir = () => getStore({ name: 'planilla', consistency: 'strong' });
const store = {
  getWithMetadata: (...a) => abrir().getWithMetadata(...a),
  setJSON: (...a) => abrir().setJSON(...a),
  list: (...a) => abrir().list(...a),
  delete: (...a) => abrir().delete(...a),
};

let manejar;

export default async (req) => {
  if (!manejar) {
    manejar = crearApp({
      store,
      entorno: { USUARIOS: leerVariable('USUARIOS'), SESSION_SECRET: leerVariable('SESSION_SECRET') },
    });
  }
  return manejar(req);
};

export const config = { path: '/api/*' };
