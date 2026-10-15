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

let manejar;

export default async (req) => {
  if (!manejar) {
    manejar = crearApp({
      store: getStore({ name: 'planilla', consistency: 'strong' }),
      entorno: { USUARIOS: leerVariable('USUARIOS'), SESSION_SECRET: leerVariable('SESSION_SECRET') },
    });
  }
  return manejar(req);
};

export const config = { path: '/api/*' };
