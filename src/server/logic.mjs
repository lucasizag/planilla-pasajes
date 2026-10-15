// Lógica pura de la planilla: no sabe nada de HTTP ni de la base de datos.
// Todas las funciones reciben el documento del día y lo modifican en el lugar,
// o lanzan un ErrorNegocio con un mensaje listo para mostrar a la telefonista.

export const SENTIDOS = {
  CL: 'Chascomús → La Plata',
  LC: 'La Plata → Chascomús',
};

export const LUGARES_POR_AUTO = 4;

export class ErrorNegocio extends Error {
  constructor(mensaje, status = 409) {
    super(mensaje);
    this.status = status;
  }
}

export function nuevoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ---------- Horas ----------

export function validarHora(h) {
  if (typeof h !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) {
    throw new ErrorNegocio(`La hora "${h}" no es válida. Usá el formato 06:30.`, 400);
  }
  return h;
}

export function sumarMinutos(hora, minutos) {
  const [h, m] = hora.split(':').map(Number);
  const total = (h * 60 + m + minutos + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function validarFecha(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f) || isNaN(Date.parse(f + 'T12:00:00Z'))) {
    throw new ErrorNegocio('Fecha inválida.', 400);
  }
  return f;
}

export function diaDeSemana(fecha) {
  return new Date(fecha + 'T12:00:00Z').getUTCDay(); // 0 = domingo
}

// ---------- Config por defecto ----------

export function configPorDefecto() {
  const franjas = (lista) => lista.map((desde) => ({ desde, hasta: sumarMinutos(desde, 30) }));
  return {
    horarios: {
      CL: franjas(['06:00', '06:30', '07:00', '07:30', '08:00', '13:00', '17:00', '19:00']),
      LC: franjas(['10:00', '11:00', '12:30', '13:00', '16:00', '18:00', '19:00', '20:00']),
    },
  };
}

// ---------- Estructura del día ----------

function autoVacio() {
  return { id: nuevoId(), movil: '', lugares: Array(LUGARES_POR_AUTO).fill(null) };
}

function crearFranja(sentido, desde, hasta) {
  return { id: nuevoId(), sentido, desde, hasta: hasta || sumarMinutos(desde, 30), autos: [autoVacio()] };
}

function ordenarFranjas(dia) {
  dia.franjas.sort((a, b) => (a.sentido === b.sentido ? a.desde.localeCompare(b.desde) : a.sentido.localeCompare(b.sentido)));
}

export function crearDia(fecha, config, fijos) {
  const dia = { fecha, franjas: [], fijosQuitados: [], historial: [] };
  for (const sentido of Object.keys(SENTIDOS)) {
    for (const h of config.horarios?.[sentido] || []) dia.franjas.push(crearFranja(sentido, h.desde, h.hasta));
  }
  ordenarFranjas(dia);
  aplicarFijos(dia, fijos, 'sistema');
  return dia;
}

function buscarFranja(dia, franjaId) {
  const f = dia.franjas.find((x) => x.id === franjaId);
  if (!f) throw new ErrorNegocio('Ese horario ya no existe. Puede que la otra telefonista lo haya borrado.', 404);
  return f;
}

function buscarAuto(franja, autoId) {
  const a = franja.autos.find((x) => x.id === autoId);
  if (!a) throw new ErrorNegocio('Ese auto ya no existe en el horario.', 404);
  return a;
}

export function buscarPasajero(dia, pasajeroId) {
  for (const franja of dia.franjas) {
    for (const auto of franja.autos) {
      const lugar = auto.lugares.findIndex((p) => p && p.id === pasajeroId);
      if (lugar >= 0) return { franja, auto, lugar, pasajero: auto.lugares[lugar] };
    }
  }
  throw new ErrorNegocio('Ese pasajero ya no está en la planilla. Puede que lo hayan quitado o movido.', 404);
}

function primerLugarLibre(franja) {
  for (const auto of franja.autos) {
    const lugar = auto.lugares.findIndex((p) => p === null);
    if (lugar >= 0) return { auto, lugar };
  }
  return null;
}

function texto(v, max = 120) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function limpiarPasajero(datos) {
  const p = {
    nombre: texto(datos?.nombre, 80),
    telefono: texto(datos?.telefono, 40),
    sube: texto(datos?.sube),
    baja: texto(datos?.baja),
    obs: texto(datos?.obs, 200),
  };
  if (!p.nombre) throw new ErrorNegocio('Falta el nombre del pasajero.', 400);
  return p;
}

function registrar(dia, usuario, accion) {
  dia.historial = dia.historial || [];
  dia.historial.unshift({ en: new Date().toISOString(), por: usuario, accion });
  if (dia.historial.length > 150) dia.historial.length = 150;
}

function etiquetaFranja(f) {
  return `${f.sentido === 'CL' ? 'CH→LP' : 'LP→CH'} ${f.desde}`;
}

// ---------- Fijos ----------

export function fijoAplicaA(fijo, fecha) {
  return fijo.activo !== false && Array.isArray(fijo.dias) && fijo.dias.includes(diaDeSemana(fecha));
}

function fijoPresente(dia, fijoId) {
  return dia.franjas.some((f) => f.autos.some((a) => a.lugares.some((p) => p && p.fijoId === fijoId)));
}

// Agrega a la planilla los fijos que corresponden a ese día y todavía no están.
// No vuelve a poner los que la telefonista sacó a mano ese día (fijosQuitados).
export function aplicarFijos(dia, fijos, usuario) {
  let agregados = 0;
  const quitados = new Set(dia.fijosQuitados || []);
  for (const fijo of fijos || []) {
    if (!fijoAplicaA(fijo, dia.fecha) || quitados.has(fijo.id) || fijoPresente(dia, fijo.id)) continue;
    let franja = dia.franjas.find((f) => f.sentido === fijo.sentido && f.desde === fijo.desde);
    if (!franja) {
      franja = crearFranja(fijo.sentido, fijo.desde, fijo.hasta);
      dia.franjas.push(franja);
      ordenarFranjas(dia);
    }
    let libre = primerLugarLibre(franja);
    if (!libre) {
      franja.autos.push(autoVacio());
      libre = primerLugarLibre(franja);
    }
    libre.auto.lugares[libre.lugar] = {
      id: nuevoId(),
      nombre: fijo.nombre,
      telefono: fijo.telefono || '',
      sube: fijo.sube || '',
      baja: fijo.baja || '',
      obs: fijo.obs || '',
      fijoId: fijo.id,
      por: usuario,
      en: new Date().toISOString(),
    };
    agregados++;
  }
  if (agregados && usuario !== 'sistema') registrar(dia, usuario, `cargó ${agregados} pasajero(s) fijo(s)`);
  return agregados;
}

// Saca del día las apariciones de un fijo que nadie tocó a mano (para resincronizar).
export function quitarFijoNoEditado(dia, fijoId) {
  let quitados = 0;
  for (const f of dia.franjas) {
    for (const a of f.autos) {
      a.lugares = a.lugares.map((p) => {
        if (p && p.fijoId === fijoId && !p.editado) {
          quitados++;
          return null;
        }
        return p;
      });
    }
  }
  return quitados;
}

export function fijoPresenteEditado(dia, fijoId) {
  return dia.franjas.some((f) => f.autos.some((a) => a.lugares.some((p) => p && p.fijoId === fijoId && p.editado)));
}

export function limpiarFijo(datos) {
  const base = limpiarPasajero(datos);
  if (!SENTIDOS[datos?.sentido]) throw new ErrorNegocio('Elegí el sentido del viaje.', 400);
  const desde = validarHora(datos.desde);
  const hasta = datos.hasta ? validarHora(datos.hasta) : sumarMinutos(desde, 30);
  const dias = [...new Set((datos.dias || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if (!dias.length) throw new ErrorNegocio('Marcá al menos un día de la semana.', 400);
  return { ...base, sentido: datos.sentido, desde, hasta, dias, activo: datos.activo !== false };
}

// ---------- Operaciones sobre el día ----------

export function aplicarOperacion(dia, op, usuario, fijos) {
  switch (op?.tipo) {
    case 'agregarPasajero': {
      const franja = buscarFranja(dia, op.franjaId);
      const datos = limpiarPasajero(op.pasajero);
      let auto, lugar;
      if (op.autoId != null && op.lugar != null) {
        auto = buscarAuto(franja, op.autoId);
        lugar = Number(op.lugar);
        if (!(lugar >= 0 && lugar < auto.lugares.length)) throw new ErrorNegocio('Lugar inválido.', 400);
        const ocupado = auto.lugares[lugar];
        if (ocupado) {
          throw new ErrorNegocio(
            `Ese lugar lo acaba de ocupar ${ocupado.nombre} (lo cargó ${ocupado.por}). Elegí otro lugar libre.`,
          );
        }
      } else {
        const libre = primerLugarLibre(franja);
        if (!libre) throw new ErrorNegocio(`El horario ${franja.desde} está completo. Agregá otro auto.`);
        ({ auto, lugar } = libre);
      }
      const pasajero = { id: nuevoId(), ...datos, fijoId: null, por: usuario, en: new Date().toISOString() };
      auto.lugares[lugar] = pasajero;
      registrar(dia, usuario, `cargó a ${datos.nombre} en ${etiquetaFranja(franja)}`);
      return { pasajero };
    }
    case 'editarPasajero': {
      const { franja, pasajero } = buscarPasajero(dia, op.pasajeroId);
      Object.assign(pasajero, limpiarPasajero(op.pasajero), { editado: true });
      registrar(dia, usuario, `modificó a ${pasajero.nombre} en ${etiquetaFranja(franja)}`);
      return { pasajero };
    }
    case 'quitarPasajero': {
      const { franja, auto, lugar, pasajero } = buscarPasajero(dia, op.pasajeroId);
      auto.lugares[lugar] = null;
      if (pasajero.fijoId) {
        dia.fijosQuitados = [...new Set([...(dia.fijosQuitados || []), pasajero.fijoId])];
      }
      registrar(dia, usuario, `quitó a ${pasajero.nombre} de ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'moverPasajero': {
      const origen = buscarPasajero(dia, op.pasajeroId);
      const destino = buscarFranja(dia, op.franjaId);
      let auto, lugar;
      if (op.autoId != null && op.lugar != null) {
        auto = buscarAuto(destino, op.autoId);
        lugar = Number(op.lugar);
        if (auto.lugares[lugar]) throw new ErrorNegocio(`Ese lugar ya lo ocupa ${auto.lugares[lugar].nombre}.`);
      } else {
        const libre = primerLugarLibre(destino);
        if (!libre) throw new ErrorNegocio(`El horario ${destino.desde} está completo. Agregale otro auto primero.`);
        ({ auto, lugar } = libre);
      }
      origen.auto.lugares[origen.lugar] = null;
      origen.pasajero.editado = true;
      auto.lugares[lugar] = origen.pasajero;
      registrar(dia, usuario, `pasó a ${origen.pasajero.nombre} de ${etiquetaFranja(origen.franja)} a ${etiquetaFranja(destino)}`);
      return {};
    }
    case 'agregarAuto': {
      const franja = buscarFranja(dia, op.franjaId);
      franja.autos.push(autoVacio());
      registrar(dia, usuario, `agregó un auto en ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'quitarAuto': {
      const franja = buscarFranja(dia, op.franjaId);
      const auto = buscarAuto(franja, op.autoId);
      if (auto.lugares.some(Boolean)) throw new ErrorNegocio('No se puede quitar un auto que tiene pasajeros.');
      if (franja.autos.length === 1) throw new ErrorNegocio('El horario tiene que tener al menos un auto.');
      franja.autos = franja.autos.filter((a) => a.id !== auto.id);
      registrar(dia, usuario, `quitó un auto de ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'movil': {
      const franja = buscarFranja(dia, op.franjaId);
      const auto = buscarAuto(franja, op.autoId);
      auto.movil = texto(op.movil, 30);
      registrar(dia, usuario, `asignó móvil "${auto.movil || '—'}" en ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'agregarFranja': {
      if (!SENTIDOS[op.sentido]) throw new ErrorNegocio('Sentido inválido.', 400);
      const desde = validarHora(op.desde);
      const hasta = op.hasta ? validarHora(op.hasta) : sumarMinutos(desde, 30);
      const franja = crearFranja(op.sentido, desde, hasta);
      dia.franjas.push(franja);
      ordenarFranjas(dia);
      registrar(dia, usuario, `agregó el horario ${etiquetaFranja(franja)}`);
      return { franja };
    }
    case 'editarFranja': {
      const franja = buscarFranja(dia, op.franjaId);
      franja.desde = validarHora(op.desde);
      franja.hasta = op.hasta ? validarHora(op.hasta) : sumarMinutos(franja.desde, 30);
      ordenarFranjas(dia);
      registrar(dia, usuario, `cambió el horario a ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'quitarFranja': {
      const franja = buscarFranja(dia, op.franjaId);
      if (franja.autos.some((a) => a.lugares.some(Boolean))) {
        throw new ErrorNegocio('Ese horario tiene pasajeros. Quitalos o pasalos a otro horario antes de borrarlo.');
      }
      dia.franjas = dia.franjas.filter((f) => f.id !== franja.id);
      registrar(dia, usuario, `borró el horario ${etiquetaFranja(franja)}`);
      return {};
    }
    case 'cargarFijos': {
      if (op.incluirQuitados) dia.fijosQuitados = [];
      const agregados = aplicarFijos(dia, fijos, usuario);
      return { agregados };
    }
    default:
      throw new ErrorNegocio('Operación desconocida.', 400);
  }
}

// ---------- Agenda de pasajeros (para autocompletar) ----------

export function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function actualizarAgenda(agenda, pasajero, sentido) {
  const lista = Array.isArray(agenda) ? agenda : [];
  const clave = normalizar(pasajero.nombre);
  if (!clave) return lista;
  let item = lista.find((x) => normalizar(x.nombre) === clave);
  if (!item) {
    item = { nombre: pasajero.nombre, telefono: '', viajes: {}, usos: 0 };
    lista.push(item);
  }
  item.nombre = pasajero.nombre;
  if (pasajero.telefono) item.telefono = pasajero.telefono;
  item.viajes = item.viajes || {};
  if (pasajero.sube || pasajero.baja) item.viajes[sentido] = { sube: pasajero.sube, baja: pasajero.baja };
  item.usos = (item.usos || 0) + 1;
  item.ultimo = new Date().toISOString();
  lista.sort((a, b) => (b.usos || 0) - (a.usos || 0));
  if (lista.length > 3000) lista.length = 3000;
  return lista;
}
