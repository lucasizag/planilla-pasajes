import { getStore } from '@netlify/blobs';
import { crearApp } from '../../src/server/app.mjs';

let manejar;

export default async (req) => {
  if (!manejar) {
    manejar = crearApp({
      store: getStore({ name: 'planilla', consistency: 'strong' }),
      entorno: { USUARIOS: Netlify.env.get('USUARIOS'), SESSION_SECRET: Netlify.env.get('SESSION_SECRET') },
    });
  }
  return manejar(req);
};

export const config = { path: '/api/*' };
