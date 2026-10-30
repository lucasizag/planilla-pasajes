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

const sumar = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
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

test('pasajeros fijos: horario por día, ida y vuelta, y cancelaciones', async () => {
  const a = await login('chascomus');
  const dow = new Date(manana + 'T12:00:00Z').getUTCDay();
  const otroDow = (dow + 1) % 7;
  const pasado = sumar(manana, 1);
  // abro mañana antes de crear el fijo, para probar que se sincroniza
  await pedir(a, 'GET', `/dias/${manana}`);
  const r = await pedir(a, 'POST', '/fijos', {
    fijo: { nombre: 'Santiago Olmos', sube: 'Acas', baja: '55 / 8-9', sentido: 'CL', horarios: { [dow]: { ida: '06:30', vuelta: '12:30' }, [otroDow]: { ida: '07:45', vuelta: '' } } },
  });
  assert.equal(r.status, 200);
  const { fijo } = await r.json();
  const buscar = (dia) => dia.franjas.flatMap((f) => f.autos.flatMap((x) => x.lugares.map((p) => p && { ...p, sentido: f.sentido, desde: f.desde }))).filter((p) => p && p.nombre === 'Santiago Olmos');
  let { dia } = await (await pedir(a, 'GET', `/dias/${manana}`)).json();
  let tramos = buscar(dia);
  assert.equal(tramos.length, 2, 'ida y vuelta en el día ya abierto');
  const vuelta = tramos.find((t) => t.sentido === 'LC');
  assert.equal(vuelta.desde, '12:30');
  assert.equal(vuelta.sube, '55 / 8-9');
  assert.equal(vuelta.baja, 'Acas');
  // el otro día: solo ida a las 07:45 (horario que no existía: se crea)
  ({ dia } = await (await pedir(a, 'GET', `/dias/${pasado}`)).json());
  tramos = buscar(dia);
  assert.deepEqual(tramos.map((t) => t.desde), ['07:45']);

  // cancelar solo la vuelta de mañana
  let c = await pedir(a, 'POST', `/fijos/${fijo.id}/cancelar`, { fecha: manana, tramo: 'vuelta' });
  assert.equal(c.status, 200);
  ({ dia } = await (await pedir(a, 'GET', `/dias/${manana}`)).json());
  assert.deepEqual(buscar(dia).map((t) => t.sentido), ['CL']);
  // "cargar fijos" no la vuelve a poner
  const rc = await (await pedir(a, 'POST', `/dias/${manana}`, { op: { tipo: 'cargarFijos' } })).json();
  assert.equal(rc.resultado.agregados, 0);
  // cancelar también la ida → queda "ambos"
  c = await (await pedir(a, 'POST', `/fijos/${fijo.id}/cancelar`, { fecha: manana, tramo: 'ida' })).json();
  assert.equal(c.fijo.cancelaciones.find((x) => x.fecha === manana).tramo, 'ambos');
  ({ dia } = await (await pedir(a, 'GET', `/dias/${manana}`)).json());
  assert.equal(buscar(dia).length, 0);
  // reactivar la ida
  c = await (await pedir(a, 'POST', `/fijos/${fijo.id}/reactivar`, { fecha: manana, tramo: 'ida' })).json();
  assert.equal(c.fijo.cancelaciones.find((x) => x.fecha === manana).tramo, 'vuelta');
  ({ dia } = await (await pedir(a, 'GET', `/dias/${manana}`)).json());
  assert.deepEqual(buscar(dia).map((t) => t.sentido), ['CL']);
  // un día que se abre por primera vez respeta las cancelaciones
  const semana = sumar(manana, 7);
  await pedir(a, 'POST', `/fijos/${fijo.id}/cancelar`, { fecha: semana, tramo: 'ambos' });
  ({ dia } = await (await pedir(a, 'GET', `/dias/${semana}`)).json());
  assert.equal(buscar(dia).length, 0);
  // no se puede cancelar en el pasado
  assert.equal((await pedir(a, 'POST', `/fijos/${fijo.id}/cancelar`, { fecha: '2020-01-01', tramo: 'ida' })).status, 400);
  // al borrar el fijo, desaparece de los días abiertos
  await pedir(a, 'DELETE', `/fijos/${fijo.id}`);
  ({ dia } = await (await pedir(a, 'GET', `/dias/${pasado}`)).json());
  assert.equal(buscar(dia).length, 0);
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

test('choferes y nuevo viaje', async () => {
  const a = await login('chascomus');
  const r = await (await pedir(a, 'POST', '/choferes', { chofer: { nombre: 'Juan Pérez', movil: '12', auto: 'Toyota Corolla', patente: 'ab123cd' } })).json();
  assert.equal(r.chofer.patente, 'AB123CD');
  const F = '/dias/2026-10-21';
  // horario inexistente: se crea
  let v = await (await pedir(a, 'POST', F, { op: { tipo: 'nuevoViaje', sentido: 'CL', desde: '09:15', pasajero: { nombre: 'Ana' } } })).json();
  const fr = v.dia.franjas.find((f) => f.id === v.resultado.franjaId);
  assert.equal(fr.desde, '09:15');
  // se llena y agrega auto solo
  for (const n of ['B', 'C', 'D', 'E']) v = await (await pedir(a, 'POST', F, { op: { tipo: 'nuevoViaje', sentido: 'CL', desde: '09:15', pasajero: { nombre: n } } })).json();
  const fr2 = v.dia.franjas.find((f) => f.id === fr.id);
  assert.equal(fr2.autos.length, 2);
  v = await (await pedir(a, 'POST', F, { op: { tipo: 'asignarChofer', franjaId: fr.id, autoId: fr2.autos[0].id, choferId: r.chofer.id, choferNombre: 'Juan Pérez' } })).json();
  assert.equal(v.dia.franjas.find((f) => f.id === fr.id).autos[0].choferId, r.chofer.id);
  const del = await (await pedir(a, 'DELETE', `/choferes/${r.chofer.id}`)).json();
  assert.equal(del.choferes.length, 0);
});

test('sesión por token cuando el navegador no guarda la cookie, y motivo del 401', async () => {
  const r = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'laplata', clave: 'x' }) }));
  const { token } = await r.json();
  assert.ok(token);
  const conToken = await app(new Request(`${BASE}/yo`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(conToken.status, 200);
  const sin = await (await app(new Request(`${BASE}/yo`))).json();
  assert.equal(sin.motivo, 'sin-sesion');
  const mala = await (await app(new Request(`${BASE}/yo`, { headers: { authorization: 'Bearer abc.def' } }))).json();
  assert.equal(mala.motivo, 'firma');
  // dos sesiones del mismo usuario conviven
  const r2 = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'laplata', clave: 'x' }) }));
  const t2 = (await r2.json()).token;
  for (const t of [token, t2]) assert.equal((await app(new Request(`${BASE}/yo`, { headers: { authorization: `Bearer ${t}` } }))).status, 200);
});

test('dos copias de la función comparten la clave de sesión aunque sus variables difieran', async () => {
  const store = storeEnMemoria();
  const copiaA = crearApp({ store, entorno: { USUARIOS: `laplata:${h}`, SESSION_SECRET: 'uno' } });
  const copiaB = crearApp({ store, entorno: { USUARIOS: `laplata:${h}`, SESSION_SECRET: 'otro-distinto' } });
  // arrancan las dos a la vez (como dos instancias frías en Netlify)
  const [r] = await Promise.all([
    copiaA(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'laplata', clave: 'x' }) })),
    copiaB(new Request(`${BASE}/diagnostico`)),
  ]);
  const { token } = await r.json();
  const dA = await (await copiaA(new Request(`${BASE}/diagnostico`))).json();
  const dB = await (await copiaB(new Request(`${BASE}/diagnostico`, { headers: { authorization: `Bearer ${token}` } }))).json();
  assert.equal(dA.huellaClave, dB.huellaClave);
  assert.equal(dB.token, 'ok');
  assert.equal((await copiaB(new Request(`${BASE}/yo`, { headers: { authorization: `Bearer ${token}` } }))).status, 200);
});

test('la sesión sirve aunque un programa borre la cookie y el encabezado Authorization', async () => {
  const r = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'laplata', clave: 'x' }) }));
  const { token } = await r.json();
  const fijo = { nombre: 'Prueba Vías', sentido: 'CL', horarios: { 3: { ida: '06:00', vuelta: '12:00' } } };
  // solo X-Sesion
  let res = await app(new Request(`${BASE}/fijos`, { method: 'POST', headers: { 'x-sesion': token }, body: JSON.stringify({ fijo }) }));
  assert.equal(res.status, 200);
  const { fijo: creado } = await res.json();
  // solo en el cuerpo
  res = await app(new Request(`${BASE}/fijos/${creado.id}`, { method: 'PUT', body: JSON.stringify({ fijo: { ...fijo, nombre: 'Prueba Vías 2' }, _sesion: token }) }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).fijo.nombre, 'Prueba Vías 2');
  // nada: 401 y dice qué llegó
  res = await app(new Request(`${BASE}/fijos/${creado.id}`, { method: 'PUT', body: JSON.stringify({ fijo }) }));
  assert.equal(res.status, 401);
  assert.deepEqual((await res.json()).recibido, []);
  // una vía inválida y otra válida: entra
  res = await app(new Request(`${BASE}/yo`, { headers: { authorization: 'Bearer basura.x', 'x-sesion': token } }));
  assert.equal(res.status, 200);
  await app(new Request(`${BASE}/fijos/${creado.id}`, { method: 'DELETE', headers: { 'x-sesion': token } }));
});

test('vía alternativa: guardar mandando el pedido como GET, solo con token', async () => {
  const r = await app(new Request(`${BASE}/login`, { method: 'POST', body: JSON.stringify({ usuario: 'laplata', clave: 'x' }) }));
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const { token } = await r.json();
  const F = '2026-11-03';
  const { dia } = await (await app(new Request(`${BASE}/dias/${F}`, { headers: { 'x-sesion': token } }))).json();
  const franja = dia.franjas.find((f) => f.sentido === 'LC');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const op = { op: { tipo: 'agregarPasajero', franjaId: franja.id, autoId: franja.autos[0].id, lugar: 0, pasajero: { nombre: 'CATALINA SURDO', sube: '45 / 6 - 7 N. 569 DEPTO. 3', baja: 'CAPELLAN CALDERON 100' } } };
  const q = (extra) => `${BASE}/via-get?m=POST&r=${encodeURIComponent(`/dias/${F}`)}&b=${b64(op)}${extra}`;
  // con solo la cookie: no (protección contra ataques desde otros sitios)
  assert.equal((await app(new Request(q(''), { headers: { cookie } }))).status, 401);
  // con token: guarda
  const ok = await app(new Request(q(`&s=${token}`)));
  assert.equal(ok.status, 200);
  const res = await ok.json();
  assert.equal(res.resultado.pasajero.nombre, 'CATALINA SURDO');
  // rutas prohibidas
  assert.equal((await app(new Request(`${BASE}/via-get?m=POST&r=/login&s=${token}`))).status, 400);
  assert.equal((await app(new Request(`${BASE}/via-get?m=GET&r=/yo&s=${token}`))).status, 400);
  // reportes
  await app(new Request(`${BASE}/reporte?d=${b64({ paso: 'prueba', metodo: 'POST', ruta: '/dias/x', status: 401 })}`));
  const { reportes } = await (await app(new Request(`${BASE}/reportes`, { headers: { 'x-sesion': token } }))).json();
  assert.equal(reportes[0].paso, 'prueba');
});
