import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp, hoyArgentina } from '../src/server/app.mjs';
import { storeEnMemoria } from '../src/server/datos.mjs';
import { hashearClave } from '../src/server/auth.mjs';

const h = hashearClave('x');
const app = crearApp({ store: storeEnMemoria(), entorno: { USUARIOS: `chascomus:${h},laplata:${h}`, SESSION_SECRET: 's' } });
const BASE = 'https://planilla.test/api';

async function login(usuario) {
  const r = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario, clave: 'x' }) }));
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const pedir = (cookie, metodo, ruta, cuerpo) =>
  app(new Request(`${BASE}${ruta}`, { method: metodo, headers: { cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }));

const manana = (() => { const d = new Date(hoyArgentina() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

test('login incorrecto y sin sesión', async () => {
  const r = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'chascomus', clave: 'mal' }) }));
  assert.equal(r.status, 401);
  assert.equal((await pedir('', 'GET', '/dias/2026-10-15')).status, 401);
});

test('el día se crea con los horarios y se comparte entre las dos', async () => {
  const a = await login('chascomus');
  const b = await login('laplata');
  const { dia } = await (await pedir(a, 'GET', '/dias/2026-10-16')).json();
  assert.ok(dia.franjas.length > 0);
  const franja = dia.franjas.find((f) => f.sentido === 'CL');
  const auto = franja.autos[0];
  const r = await pedir(a, 'POST', '/dias/2026-10-16', { op: { tipo: 'agregarPasajero', franjaId: franja.id, autoId: auto.id, lugar: 0, pasajero: { nombre: 'María Emilia', sube: 'Castelli 90', baja: '51 / 17-18' } } });
  assert.equal(r.status, 200);
  const visto = await (await pedir(b, 'GET', '/dias/2026-10-16')).json();
  assert.equal(visto.dia.franjas.find((f) => f.id === franja.id).autos[0].lugares[0].nombre, 'María Emilia');
  // 304 cuando no hay cambios
  const r304 = await app(new Request(`${BASE}/dias/2026-10-16`, { headers: { cookie: b, 'if-none-match': visto.etag } }));
  assert.equal(r304.status, 304);
  // agenda
  const { agenda } = await (await pedir(b, 'GET', '/agenda')).json();
  assert.equal(agenda[0].viajes.CL.sube, 'Castelli 90');
});

test('no se puede vender dos veces el mismo lugar, aunque carguen a la vez', async () => {
  const a = await login('chascomus');
  const b = await login('laplata');
  const { dia } = await (await pedir(a, 'GET', '/dias/2026-10-17')).json();
  const franja = dia.franjas[0];
  const op = (nombre) => ({ op: { tipo: 'agregarPasajero', franjaId: franja.id, autoId: franja.autos[0].id, lugar: 2, pasajero: { nombre } } });
  const [r1, r2] = await Promise.all([pedir(a, 'POST', '/dias/2026-10-17', op('Uno')), pedir(b, 'POST', '/dias/2026-10-17', op('Dos'))]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const perdedor = r1.status === 409 ? r1 : r2;
  assert.match((await perdedor.json()).error, /acaba de ocupar/);

  // Muchas cargas simultáneas en lugares distintos: no se pierde ninguna.
  const muchos = await Promise.all(
    Array.from({ length: 10 }, (_, i) => pedir(i % 2 ? a : b, 'POST', '/dias/2026-10-17', { op: { tipo: 'agregarPasajero', franjaId: dia.franjas[1].id, pasajero: { nombre: 'P' + i } } })),
  );
  const ok = muchos.filter((r) => r.status === 200).length;
  const { dia: fin } = await (await pedir(a, 'GET', '/dias/2026-10-17')).json();
  const f1 = fin.franjas.find((f) => f.id === dia.franjas[1].id);
  const ocupados = f1.autos.flatMap((x) => x.lugares).filter(Boolean).length;
  assert.equal(ok, 4); // un auto, 4 lugares
  assert.equal(ocupados, 4);
});

test('pasajeros fijos: se cargan solos en los días que corresponden', async () => {
  const a = await login('chascomus');
  const dow = new Date(manana + 'T12:00:00Z').getUTCDay();
  // creo el día de mañana antes de cargar el fijo, para probar la sincronización
  await pedir(a, 'GET', `/dias/${manana}`);
  const r = await pedir(a, 'POST', '/fijos', { fijo: { nombre: 'Santiago Olmos', sube: 'Acas', baja: '55 / 8-9', sentido: 'CL', desde: '06:30', dias: [dow] } });
  assert.equal(r.status, 200);
  const { dia } = await (await pedir(a, 'GET', `/dias/${manana}`)).json();
  const p = dia.franjas.flatMap((f) => f.autos.flatMap((x) => x.lugares)).find((x) => x && x.nombre === 'Santiago Olmos');
  assert.ok(p && p.fijoId, 'el fijo aparece en el día ya abierto');
  // el día siguiente a mañana (otro día de semana) no lo tiene
  const otro = new Date(manana + 'T12:00:00Z'); otro.setUTCDate(otro.getUTCDate() + 1);
  const { dia: d2 } = await (await pedir(a, 'GET', `/dias/${otro.toISOString().slice(0, 10)}`)).json();
  assert.ok(!d2.franjas.some((f) => f.autos.some((x) => x.lugares.some((q) => q && q.nombre === 'Santiago Olmos'))));
  // si lo quito un día, "cargar fijos" no lo vuelve a poner
  await pedir(a, 'POST', `/dias/${manana}`, { op: { tipo: 'quitarPasajero', pasajeroId: p.id } });
  const rc = await (await pedir(a, 'POST', `/dias/${manana}`, { op: { tipo: 'cargarFijos' } })).json();
  assert.equal(rc.resultado.agregados, 0);
  // al borrar el fijo, desaparece de los días futuros
  const { fijo } = await r.json();
  await pedir(a, 'DELETE', `/fijos/${fijo.id}`);
  const { fijos } = await (await pedir(a, 'GET', '/fijos')).json();
  assert.equal(fijos.length, 0);
});

test('operaciones de franjas y autos', async () => {
  const a = await login('chascomus');
  const F = '/dias/2026-10-20';
  await pedir(a, 'GET', F);
  let r = await (await pedir(a, 'POST', F, { op: { tipo: 'agregarFranja', sentido: 'LC', desde: '21:15' } })).json();
  const fr = r.resultado.franja;
  assert.equal(fr.hasta, '21:45');
  r = await (await pedir(a, 'POST', F, { op: { tipo: 'agregarAuto', franjaId: fr.id } })).json();
  assert.equal(r.dia.franjas.find((f) => f.id === fr.id).autos.length, 2);
  r = await (await pedir(a, 'POST', F, { op: { tipo: 'agregarPasajero', franjaId: fr.id, pasajero: { nombre: 'Ana' } } })).json();
  const res = await pedir(a, 'POST', F, { op: { tipo: 'quitarFranja', franjaId: fr.id } });
  assert.equal(res.status, 409);
  const bad = await pedir(a, 'POST', F, { op: { tipo: 'agregarFranja', sentido: 'LC', desde: '25:00' } });
  assert.equal(bad.status, 400);
});
