import {
  ErrorNegocio,
  actualizarAgenda,
  aplicarFijos,
  aplicarOperacion,
  configPorDefecto,
  crearDia,
  limpiarCancelacion,
  limpiarFijo,
  normalizarFijo,
  quitarTramosFijo,
  registrar,
  limpiarChofer,
  nuevoId,
  sumarMinutos,
  validarFecha,
  validarHora,
  SENTIDOS,
} from './logic.mjs';
import { actualizar, leer, leerOCrear } from './datos.mjs';
import { cookieBorrar, cookieSesion, crearSesion, leerCookie, leerSesion, leerUsuarios, verificarClave } from './auth.mjs';

export function hoyArgentina(fecha = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(fecha);
}

function json(cuerpo, status = 200, headers = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearApp({ store, entorno }) {
  const env = (k) => entorno[k];

  const cargarConfig = async () => (await leer(store, 'config')).datos || configPorDefecto();
  const cargarFijos = async () => ((await leer(store, 'fijos')).datos || []).map(normalizarFijo);

  const crearDiaNuevo = (fecha) => async () => crearDia(fecha, await cargarConfig(), await cargarFijos());

  // Actualiza los días ya abiertos desde hoy en adelante para que reflejen la ficha del fijo.
  // Los tramos que una telefonista modificó a mano en un día se respetan.
  async function sincronizarFijoEnDias(fijoId, fijo, soloFecha = null) {
    const desde = hoyArgentina();
    const { blobs } = await store.list({ prefix: 'dias/' });
    const claves = blobs.map((b) => b.key).filter((k) => (soloFecha ? k.slice(5) === soloFecha : k.slice(5) >= desde));
    for (const clave of claves) {
      await actualizar(
        store,
        clave,
        (dia) => {
          if (!dia) return;
          quitarTramosFijo(dia, fijoId, { soloNoEditados: true });
          if (fijo) aplicarFijos(dia, [fijo], 'sistema');
        },
        () => null,
      );
    }
  }

  async function guardarEnAgenda(pasajero, sentido) {
    try {
      // actualizarAgenda modifica la lista en el lugar
      await actualizar(store, 'agenda', (agenda) => { actualizarAgenda(agenda, pasajero, sentido); }, () => []);
    } catch (e) {
      console.error('agenda', e);
    }
  }

  async function rutas(req, usuario, partes) {
    const metodo = req.method;
    const cuerpo = async () => {
      try {
        return await req.json();
      } catch {
        throw new ErrorNegocio('Datos inválidos.', 400);
      }
    };

    // /api/yo
    if (partes[0] === 'yo' && metodo === 'GET') return json({ usuario, hoy: hoyArgentina() });

    // /api/dias/:fecha
    if (partes[0] === 'dias' && partes[1]) {
      const fecha = validarFecha(partes[1]);
      const clave = `dias/${fecha}`;
      if (metodo === 'GET') {
        const { datos, etag } = await leerOCrear(store, clave, crearDiaNuevo(fecha));
        if (etag && req.headers.get('if-none-match') === etag) {
          return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-store' } });
        }
        return json({ dia: datos, etag }, 200, etag ? { etag } : {});
      }
      if (metodo === 'POST') {
        const { op } = await cuerpo();
        const fijos = op?.tipo === 'cargarFijos' ? await cargarFijos() : [];
        const r = await actualizar(store, clave, (dia) => aplicarOperacion(dia, op, usuario, fijos), crearDiaNuevo(fecha));
        if (['agregarPasajero', 'editarPasajero', 'nuevoViaje'].includes(op.tipo) && r.resultado?.pasajero) {
          const franja = r.datos.franjas.find((f) => f.autos.some((a) => a.lugares.some((p) => p && p.id === r.resultado.pasajero.id)));
          if (franja) await guardarEnAgenda(r.resultado.pasajero, franja.sentido);
        }
        return json({ dia: r.datos, etag: r.etag, resultado: r.resultado }, 200, r.etag ? { etag: r.etag } : {});
      }
    }

    // /api/fijos
    if (partes[0] === 'fijos') {
      if (metodo === 'GET' && !partes[1]) return json({ fijos: await cargarFijos() });
      if (metodo === 'POST' && !partes[1]) {
        const { fijo } = await cuerpo();
        const nuevo = { id: nuevoId(), ...limpiarFijo(fijo), cancelaciones: [], creadoPor: usuario, creadoEn: new Date().toISOString() };
        await actualizar(store, 'fijos', (lista) => { lista.push(nuevo); }, () => []);
        await sincronizarFijoEnDias(nuevo.id, nuevo);
        return json({ fijo: nuevo, fijos: await cargarFijos() });
      }
      // Cancelar o reactivar un viaje puntual: /api/fijos/:id/cancelar  y  /api/fijos/:id/reactivar
      if (partes[1] && (partes[2] === 'cancelar' || partes[2] === 'reactivar') && metodo === 'POST') {
        const id = partes[1];
        const hoy = hoyArgentina();
        const { fecha, tramo } = limpiarCancelacion(await cuerpo(), partes[2] === 'cancelar' ? hoy : null);
        let fijo = null;
        await actualizar(store, 'fijos', (lista) => {
          const i = lista.findIndex((f) => f.id === id);
          if (i < 0) throw new ErrorNegocio('Ese pasajero fijo ya no existe.', 404);
          const f = normalizarFijo(lista[i]);
          // limpia cancelaciones de hace más de 30 días
          const limite = new Date(hoy + 'T12:00:00Z');
          limite.setUTCDate(limite.getUTCDate() - 30);
          let canc = (f.cancelaciones || []).filter((c) => c.fecha >= limite.toISOString().slice(0, 10));
          const previa = canc.find((c) => c.fecha === fecha);
          canc = canc.filter((c) => c.fecha !== fecha);
          let queda = null;
          if (partes[2] === 'cancelar') {
            queda = previa && previa.tramo !== tramo ? 'ambos' : tramo;
          } else if (previa && tramo !== 'ambos' && previa.tramo === 'ambos') {
            queda = tramo === 'ida' ? 'vuelta' : 'ida';
          } else if (previa && tramo !== 'ambos' && previa.tramo !== tramo) {
            queda = previa.tramo;
          }
          if (queda) canc.push({ fecha, tramo: queda, por: usuario, en: new Date().toISOString() });
          canc.sort((a, b) => a.fecha.localeCompare(b.fecha));
          lista[i] = { ...f, cancelaciones: canc };
          fijo = lista[i];
        }, () => []);
        // Si ese día ya está abierto, se actualiza la planilla.
        const { datos: diaExistente } = await leer(store, `dias/${fecha}`);
        if (diaExistente) {
          await actualizar(store, `dias/${fecha}`, (dia) => {
            const etiqueta = tramo === 'ambos' ? 'ida y vuelta' : tramo;
            if (partes[2] === 'cancelar') {
              const n = quitarTramosFijo(dia, id, { tramo });
              registrar(dia, usuario, `canceló el viaje de ${fijo.nombre} (${etiqueta})${n ? '' : ' — no estaba en la planilla'}`);
            } else {
              dia.fijosQuitados = (dia.fijosQuitados || []).filter((k) => k !== id && !(k.startsWith(id + ':') && (tramo === 'ambos' || k.endsWith(':' + tramo))));
              const n = aplicarFijos(dia, [fijo], 'sistema');
              registrar(dia, usuario, `reactivó el viaje de ${fijo.nombre} (${etiqueta})${n ? '' : ' — no se agregó nada'}`);
            }
          }, () => null);
        }
        return json({ fijo, fijos: await cargarFijos() });
      }
      if (partes[1] && !partes[2] && (metodo === 'PUT' || metodo === 'DELETE')) {
        const id = partes[1];
        let resultado = null;
        if (metodo === 'PUT') {
          const { fijo } = await cuerpo();
          const limpio = limpiarFijo(fijo);
          await actualizar(store, 'fijos', (lista) => {
            const i = lista.findIndex((f) => f.id === id);
            if (i < 0) throw new ErrorNegocio('Ese pasajero fijo ya no existe.', 404);
            const { dias, desde, hasta, ...anterior } = normalizarFijo(lista[i]);
            void dias, desde, hasta;
            lista[i] = { ...anterior, ...limpio, modificadoPor: usuario, modificadoEn: new Date().toISOString() };
            resultado = lista[i];
          }, () => []);
        } else {
          await actualizar(store, 'fijos', (lista) => {
            const i = lista.findIndex((f) => f.id === id);
            if (i >= 0) lista.splice(i, 1);
          }, () => []);
        }
        await sincronizarFijoEnDias(id, resultado);
        return json({ fijo: resultado, fijos: await cargarFijos() });
      }
    }

    // /api/choferes
    if (partes[0] === 'choferes') {
      const lista = async () => (await leer(store, 'choferes')).datos || [];
      if (metodo === 'GET' && !partes[1]) return json({ choferes: await lista() });
      if (metodo === 'POST' && !partes[1]) {
        const { chofer } = await cuerpo();
        const nuevo = { id: nuevoId(), ...limpiarChofer(chofer) };
        await actualizar(store, 'choferes', (l) => { l.push(nuevo); }, () => []);
        return json({ chofer: nuevo, choferes: await lista() });
      }
      if (partes[1] && metodo === 'PUT') {
        const { chofer } = await cuerpo();
        const limpio = limpiarChofer(chofer);
        await actualizar(store, 'choferes', (l) => {
          const i = l.findIndex((c) => c.id === partes[1]);
          if (i < 0) throw new ErrorNegocio('Ese chofer ya no existe.', 404);
          l[i] = { ...l[i], ...limpio };
        }, () => []);
        return json({ choferes: await lista() });
      }
      if (partes[1] && metodo === 'DELETE') {
        await actualizar(store, 'choferes', (l) => {
          const i = l.findIndex((c) => c.id === partes[1]);
          if (i >= 0) l.splice(i, 1);
        }, () => []);
        return json({ choferes: await lista() });
      }
    }

    // /api/config
    if (partes[0] === 'config') {
      if (metodo === 'GET') return json({ config: await cargarConfig() });
      if (metodo === 'PUT') {
        const { config } = await cuerpo();
        const horarios = {};
        for (const s of Object.keys(SENTIDOS)) {
          const vistos = new Set();
          horarios[s] = (config?.horarios?.[s] || [])
            .map((h) => {
              const desde = validarHora(h.desde);
              return { desde, hasta: h.hasta ? validarHora(h.hasta) : sumarMinutos(desde, 30) };
            })
            .filter((h) => (vistos.has(h.desde) ? false : vistos.add(h.desde)))
            .sort((a, b) => a.desde.localeCompare(b.desde));
        }
        const r = await actualizar(store, 'config', (c) => { c.horarios = horarios; }, configPorDefecto);
        return json({ config: r.datos });
      }
    }

    // /api/agenda
    if (partes[0] === 'agenda' && metodo === 'GET') {
      return json({ agenda: (await leer(store, 'agenda')).datos || [] });
    }

    return json({ error: 'No encontrado' }, 404);
  }

  return async function manejar(req) {
    const url = new URL(req.url);
    const partes = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const segura = url.protocol === 'https:';
    const secreto = env('SESSION_SECRET');

    try {
      if (partes[0] === 'login' && req.method === 'POST') {
        const usuarios = leerUsuarios(env('USUARIOS'));
        const faltan = [];
        if (usuarios.size === 0) faltan.push(env('USUARIOS') ? 'USUARIOS tiene un formato inválido' : 'falta USUARIOS');
        if (!secreto) faltan.push('falta SESSION_SECRET');
        if (faltan.length) {
          return json({ error: `El sistema todavía no está configurado: ${faltan.join(' y ')}. Revisá las variables en Netlify y volvé a desplegar.` }, 500);
        }
        let datos = {};
        try {
          datos = await req.json();
        } catch {}
        const nombre = String(datos.usuario || '').trim().toLowerCase();
        if (!usuarios.has(nombre) || !verificarClave(datos.clave || '', usuarios.get(nombre))) {
          await espera(800);
          return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
        }
        return json({ usuario: nombre }, 200, { 'set-cookie': cookieSesion(crearSesion(nombre, secreto), segura) });
      }
      if (partes[0] === 'logout') {
        return json({ ok: true }, 200, { 'set-cookie': cookieBorrar(segura) });
      }

      const usuario = leerSesion(leerCookie(req, 'sesion'), secreto);
      if (!usuario || !leerUsuarios(env('USUARIOS')).has(usuario)) {
        return json({ error: 'Tenés que iniciar sesión.' }, 401);
      }

      // Protección básica contra pedidos desde otros sitios.
      if (req.method !== 'GET') {
        const origen = req.headers.get('origin');
        if (origen && new URL(origen).host !== url.host) return json({ error: 'Origen no permitido.' }, 403);
      }

      return await rutas(req, usuario, partes);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return json({ error: status >= 500 && !e.status ? 'Error inesperado. Probá de nuevo.' : e.message }, status);
    }
  };
}
