// Planilla de pasajes Chascomús ⇄ La Plata
// Sin frameworks: todo el estado vive en `E` y la pantalla se vuelve a dibujar con render().

const SENTIDOS = { CL: 'Chascomús → La Plata', LC: 'La Plata → Chascomús' };
const CORTO = { CL: 'CH → LP', LC: 'LP → CH' };
const DIAS_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const CADA_CUANTO = 15000; // ms entre actualizaciones mientras se usa la pantalla
const CADA_CUANTO_INACTIVO = 60000; // ms entre actualizaciones si nadie toca nada
const INACTIVO = 3 * 60000; // a partir de cuántos ms sin actividad se considera inactivo

const E = {
  usuario: null,
  hoy: null,
  vista: 'planilla',
  fecha: null,
  dia: null,
  etag: null,
  agenda: [],
  fijos: [],
  config: null,
  horariosEdit: null,
  conectado: true,
  ultimaSync: null,
  renderPendiente: false,
};

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const app = $('#app');
const modal = $('#modal');

// ---------- Utilidades ----------

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sumarMinutos(hora, min) {
  const [h, m] = hora.split(':').map(Number);
  const t = (h * 60 + m + min + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function fechaLarga(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  const [a, m, dd] = fecha.split('-');
  return { dia: DIAS_NOMBRE[d.getUTCDay()], numero: `${dd}/${m}/${a}` };
}

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3200);
}

async function api(metodo, ruta, cuerpo, headers = {}) {
  let r;
  try {
    r = await fetch('/api' + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...headers },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    marcarConexion(false);
    throw Object.assign(new Error('Sin conexión a internet. Revisá la conexión y probá de nuevo.'), { status: 0 });
  }
  marcarConexion(true);
  if (r.status === 304) return { sinCambios: true };
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/login') {
    E.usuario = null;
    mostrarLogin('Tu sesión terminó. Volvé a entrar.');
    throw Object.assign(new Error('Sesión vencida'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error(datos.error || 'Algo salió mal.'), { status: r.status });
  return datos;
}

function marcarConexion(ok) {
  if (ok) E.ultimaSync = new Date();
  if (E.conectado !== ok) {
    E.conectado = ok;
  }
  pintarEstado();
}

function pintarEstado() {
  const el = $('#estado');
  if (!el) return;
  el.className = 'estado' + (E.conectado ? '' : ' mal');
  el.innerHTML = E.conectado
    ? `<span class="punto"></span><span class="txt">Al día${E.ultimaSync ? ' · ' + E.ultimaSync.toLocaleTimeString('es-AR') : ''}</span>`
    : `<span class="punto"></span><span>Sin conexión</span>`;
}

// ---------- Rutas (#/planilla/2026-10-15, #/fijos, #/horarios) ----------

function leerRuta() {
  const [, vista, fecha] = location.hash.split('/');
  E.vista = ['planilla', 'fijos', 'horarios'].includes(vista) ? vista : 'planilla';
  if (E.vista === 'planilla') {
    const nueva = /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? fecha : E.hoy;
    if (nueva !== E.fecha) {
      E.fecha = nueva;
      E.dia = null;
      E.etag = null;
    }
  }
}

function ir(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', async () => {
  leerRuta();
  cerrarModal();
  await cargarVista();
});

// ---------- Login ----------

function mostrarLogin(mensaje = '') {
  cerrarModal();
  app.innerHTML = `
    <div class="login">
      <form id="form-login" autocomplete="on">
        <h1>Planilla de pasajes</h1>
        <p>Chascomús ⇄ La Plata</p>
        ${mensaje ? `<div class="error-form">${esc(mensaje)}</div>` : ''}
        <label class="campo"><span>Usuario</span><input name="usuario" autocomplete="username" required autocapitalize="none"></label>
        <label class="campo"><span>Contraseña</span><input name="clave" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primario" type="submit">Entrar</button>
      </form>
    </div>`;
  $('#form-login input').focus();
  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const boton = ev.target.querySelector('button');
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    try {
      await api('POST', '/login', { usuario: f.get('usuario'), clave: f.get('clave') });
      await iniciar();
    } catch (e) {
      mostrarLogin(e.message);
    }
  });
}

// ---------- Carga de datos ----------

async function iniciar() {
  try {
    const yo = await api('GET', '/yo');
    E.usuario = yo.usuario;
    E.hoy = yo.hoy;
  } catch (e) {
    if (e.status !== 401) app.innerHTML = `<p class="cargando">${esc(e.message)}</p>`;
    return;
  }
  leerRuta();
  cargarAgenda();
  await cargarVista();
}

async function cargarAgenda() {
  try {
    E.agenda = (await api('GET', '/agenda')).agenda || [];
  } catch {}
}

async function cargarVista() {
  if (!E.usuario) return;
  if (E.vista === 'planilla') {
    render();
    await traerDia(true);
  } else if (E.vista === 'fijos') {
    render();
    const [f, c] = await Promise.all([api('GET', '/fijos'), api('GET', '/config')]).catch((e) => (aviso(e.message, 'error'), [{}, {}]));
    E.fijos = f.fijos || [];
    E.config = c.config || E.config;
    render();
  } else if (E.vista === 'horarios') {
    render();
    const c = await api('GET', '/config').catch((e) => (aviso(e.message, 'error'), {}));
    E.config = c.config || E.config;
    E.horariosEdit = E.config ? structuredClone(E.config.horarios) : null;
    render();
  }
}

async function traerDia(forzar = false) {
  if (E.vista !== 'planilla' || !E.fecha) return;
  const fecha = E.fecha;
  try {
    const r = await api('GET', `/dias/${fecha}`, null, !forzar && E.etag ? { 'if-none-match': E.etag } : {});
    if (fecha !== E.fecha || r.sinCambios) return;
    E.dia = r.dia;
    E.etag = r.etag;
    renderSeguro();
  } catch (e) {
    if (forzar && e.status !== 401) aviso(e.message, 'error');
  }
}

function aplicarRespuesta(r) {
  if (r?.dia && r.dia.fecha === E.fecha) {
    E.dia = r.dia;
    E.etag = r.etag;
    renderSeguro();
  }
}

// No redibujar mientras alguien escribe el número de móvil.
function renderSeguro() {
  const activo = document.activeElement;
  if (activo && activo.matches?.('input[data-movil]')) {
    E.renderPendiente = true;
    return;
  }
  render();
}

// Actualización automática, pensada para gastar pocos créditos de Netlify:
// - cada 15 s mientras alguien está usando la pantalla,
// - cada 60 s si nadie toca nada hace más de 3 minutos,
// - nada si la pestaña está minimizada u oculta.
// Al volver a la pestaña o mover el mouse después de un rato, se actualiza al instante.
// (El control de cupo lo hace el servidor al guardar, así que no depende de esto.)
let ultimaActividad = Date.now();
let ultimaConsulta = 0;
function consultarSiToca(forzar = false) {
  if (!E.usuario || document.hidden || E.vista !== 'planilla') return;
  const inactivo = Date.now() - ultimaActividad > INACTIVO;
  const intervalo = inactivo ? CADA_CUANTO_INACTIVO : CADA_CUANTO;
  if (forzar || Date.now() - ultimaConsulta >= intervalo) {
    ultimaConsulta = Date.now();
    traerDia();
  }
}
setInterval(consultarSiToca, 5000);
for (const ev of ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']) {
  window.addEventListener(
    ev,
    () => {
      const veniaInactivo = Date.now() - ultimaActividad > INACTIVO;
      ultimaActividad = Date.now();
      if (veniaInactivo) consultarSiToca(true);
    },
    { passive: true },
  );
}
document.addEventListener('visibilitychange', () => consultarSiToca(true));
setInterval(() => E.usuario && !document.hidden && cargarAgenda(), 5 * 60000);

// ---------- Pantalla ----------

function render() {
  if (!E.usuario) return;
  const scroll = window.scrollY;
  app.innerHTML = `
    <header class="barra">
      <div class="marca">
        <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1f3a8a"/><path d="M14 38h36l-4-12H18z" fill="#fff"/><circle cx="22" cy="42" r="5" fill="#fff"/><circle cx="42" cy="42" r="5" fill="#fff"/></svg>
        <span>Pasajes CH ⇄ LP</span>
      </div>
      <nav class="pestanas">
        <button data-ir="#/planilla/${E.fecha || E.hoy}" ${E.vista === 'planilla' ? 'aria-current="page"' : ''}>Planilla</button>
        <button data-ir="#/fijos" ${E.vista === 'fijos' ? 'aria-current="page"' : ''}>Pasajeros fijos</button>
        <button data-ir="#/horarios" ${E.vista === 'horarios' ? 'aria-current="page"' : ''}>Horarios</button>
      </nav>
      <div class="espacio"></div>
      <div id="estado" class="estado"></div>
      <span class="usuario">Usuario: <b>${esc(E.usuario)}</b></span>
      <button class="btn-texto" data-accion="salir">Salir</button>
    </header>
    <main class="contenido">${
      E.vista === 'planilla' ? vistaPlanilla() : E.vista === 'fijos' ? vistaFijos() : vistaHorarios()
    }</main>`;
  pintarEstado();
  window.scrollTo(0, scroll);
  E.renderPendiente = false;
}

// ---------- Planilla del día ----------

function contarSentido(sentido) {
  let pasajeros = 0;
  for (const f of E.dia.franjas) if (f.sentido === sentido) for (const a of f.autos) pasajeros += a.lugares.filter(Boolean).length;
  return pasajeros;
}

function vistaPlanilla() {
  const { dia, numero } = fechaLarga(E.fecha);
  const esHoy = E.fecha === E.hoy;
  const pasado = E.fecha < E.hoy;
  let cuerpo;
  if (!E.dia) {
    cuerpo = `<p class="cargando">Cargando la planilla…</p>`;
  } else {
    cuerpo = ['CL', 'LC']
      .map((s) => {
        const franjas = E.dia.franjas.filter((f) => f.sentido === s);
        const n = contarSentido(s);
        return `
        <section class="sentido ${s}">
          <div class="sentido-titulo">
            <h2>${SENTIDOS[s].toUpperCase()}</h2>
            <span class="resumen">${n} pasajero${n === 1 ? '' : 's'}</span>
            <button class="btn btn-chico no-imprimir" data-accion="nueva-franja" data-sentido="${s}">+ Agregar horario</button>
          </div>
          <div class="grilla">
            ${franjas.length ? franjas.map(vistaFranja).join('') : `<div class="vacio-sentido">No hay horarios cargados para este sentido.</div>`}
          </div>
        </section>`;
      })
      .join('');
  }
  return `
    <div class="navfecha">
      <button class="btn btn-flecha" data-ir="#/planilla/${sumarDias(E.fecha, -1)}" title="Día anterior" aria-label="Día anterior">‹</button>
      <div class="fecha-grande">${dia} ${numero}${esHoy ? '<span class="chip-hoy">HOY</span>' : pasado ? '<span class="chip-pasado">PASADO</span>' : ''}</div>
      <button class="btn btn-flecha" data-ir="#/planilla/${sumarDias(E.fecha, 1)}" title="Día siguiente" aria-label="Día siguiente">›</button>
      ${esHoy ? '' : `<button class="btn" data-ir="#/planilla/${E.hoy}">Ir a hoy</button>`}
      <input type="date" value="${E.fecha}" data-accion="elegir-fecha" aria-label="Elegir fecha">
      <div class="acciones">
        <button class="btn" data-accion="cargar-fijos" title="Agrega los pasajeros fijos que viajan este día y todavía no están">Cargar fijos</button>
        <button class="btn" data-accion="historial">Movimientos</button>
        <button class="btn" data-accion="imprimir">Imprimir</button>
      </div>
    </div>
    <h1 class="solo-impresion">Planilla del ${dia.toLowerCase()} ${numero}</h1>
    ${cuerpo}`;
}

function vistaFranja(f) {
  const total = f.autos.length * 4;
  const ocupados = f.autos.reduce((n, a) => n + a.lugares.filter(Boolean).length, 0);
  const lleno = ocupados >= total;
  return `
  <article class="franja" data-franja="${f.id}">
    <header class="franja-cab">
      <span class="franja-hora">${esc(f.desde)} <small>a ${esc(f.hasta)}</small></span>
      <span class="ocupacion ${lleno ? 'lleno' : ''}">${lleno ? 'COMPLETO' : `${ocupados} de ${total}`}</span>
      <button class="btn-texto no-imprimir" data-accion="editar-franja" data-franja="${f.id}" title="Cambiar o borrar este horario" aria-label="Cambiar horario">✎</button>
    </header>
    ${f.autos
      .map(
        (a, i) => `
      <div class="auto-cab">
        <b>Auto ${i + 1}</b>
        <label>Móvil <input data-movil data-franja="${f.id}" data-auto="${a.id}" value="${esc(a.movil)}" placeholder="—" aria-label="Número de móvil del auto ${i + 1}"></label>
        ${f.autos.length > 1 && !a.lugares.some(Boolean) ? `<button class="btn-texto" data-accion="quitar-auto" data-franja="${f.id}" data-auto="${a.id}">Quitar auto</button>` : ''}
      </div>
      ${a.lugares.map((p, j) => vistaLugar(f, a, j, p)).join('')}`,
      )
      .join('')}
    <footer class="franja-pie">
      <button class="btn btn-chico" data-accion="agregar-auto" data-franja="${f.id}">+ Otro auto</button>
    </footer>
  </article>`;
}

function vistaLugar(f, a, j, p) {
  if (!p) {
    return `<button class="lugar libre" data-accion="nuevo-pasajero" data-franja="${f.id}" data-auto="${a.id}" data-lugar="${j}">
      <span class="num">${j + 1}</span><span class="texto-libre">Libre <span class="mas">+ Cargar</span></span></button>`;
  }
  const recorrido = p.sube || p.baja ? `${esc(p.sube || '—')} <span class="flecha">→</span> ${esc(p.baja || '—')}` : '';
  return `<button class="lugar" data-accion="editar-pasajero" data-pasajero="${p.id}" id="p-${p.id}">
    <span class="num">${j + 1}</span>
    <span>
      <span class="nombre">${esc(p.nombre)}${p.fijoId ? '<span class="etiqueta fijo">Fijo</span>' : ''}</span>
      ${recorrido ? `<div class="detalle">${recorrido}</div>` : ''}
      ${p.telefono ? `<div class="detalle">Tel: ${esc(p.telefono)}</div>` : ''}
      ${p.obs ? `<div class="obs">${esc(p.obs)}</div>` : ''}
    </span>
  </button>`;
}

function buscarFranja(id) {
  return E.dia?.franjas.find((f) => f.id === id);
}

function ubicarPasajero(id) {
  for (const f of E.dia?.franjas || [])
    for (const [i, a] of f.autos.entries()) {
      const j = a.lugares.findIndex((p) => p && p.id === id);
      if (j >= 0) return { franja: f, auto: a, nAuto: i + 1, lugar: j, pasajero: a.lugares[j] };
    }
  return null;
}

function libres(f) {
  return f.autos.reduce((n, a) => n + a.lugares.filter((x) => !x).length, 0);
}

async function operar(op, { mensaje, resaltar } = {}) {
  const r = await api('POST', `/dias/${E.fecha}`, { op });
  aplicarRespuesta(r);
  if (mensaje) aviso(typeof mensaje === 'function' ? mensaje(r) : mensaje);
  const id = resaltar === true ? r.resultado?.pasajero?.id : resaltar;
  if (id) {
    const el = document.getElementById('p-' + id);
    if (el) {
      el.classList.add('resaltado');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  return r;
}

// ---------- Modal ----------

function abrirModal(html, alAbrir) {
  modal.innerHTML = `<div class="modal-caja" role="dialog" aria-modal="true">${html}</div>`;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  alAbrir?.(modal);
  const primero = modal.querySelector('[autofocus]') || modal.querySelector('input, select, textarea, button');
  primero?.focus();
}

function cerrarModal() {
  modal.hidden = true;
  modal.innerHTML = '';
  document.body.style.overflow = '';
  if (E.renderPendiente) render();
}

modal.addEventListener('mousedown', (ev) => {
  if (ev.target === modal) cerrarModal();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !modal.hidden && !$('.sugerencias ul:not([hidden])', modal)) cerrarModal();
});

function cabeceraModal(titulo, subtitulo = '') {
  return `<div class="modal-cab"><div><h2>${titulo}</h2>${subtitulo ? `<p>${subtitulo}</p>` : ''}</div>
    <button class="btn-texto" data-accion="cerrar" aria-label="Cerrar">×</button></div>`;
}

function mostrarErrorModal(mensaje, extra = '') {
  const caja = $('.error-form', modal);
  if (caja) {
    caja.hidden = false;
    caja.innerHTML = esc(mensaje) + extra;
    caja.scrollIntoView({ block: 'nearest' });
  }
}

// Botón de dos pasos en lugar de confirm(): primer toque pide confirmación.
function confirmarDosPasos(boton, texto) {
  if (boton.dataset.listo) return true;
  boton.dataset.listo = '1';
  boton.dataset.original = boton.textContent;
  boton.textContent = texto;
  boton.classList.add('confirmar');
  setTimeout(() => {
    if (boton.isConnected) {
      delete boton.dataset.listo;
      boton.textContent = boton.dataset.original;
      boton.classList.remove('confirmar');
    }
  }, 4000);
  return false;
}

// ---------- Formulario de pasajero ----------

function camposPasajero(p = {}) {
  return `
    <div class="error-form" hidden></div>
    <div class="sugerencias">
      <label class="campo"><span>Nombre y apellido</span>
        <input name="nombre" value="${esc(p.nombre)}" required autocomplete="off" autofocus placeholder="Escribí y aparecen los conocidos">
      </label>
      <ul role="listbox" hidden></ul>
    </div>
    <label class="campo"><span>Teléfono</span><input name="telefono" value="${esc(p.telefono)}" inputmode="tel" autocomplete="off"></label>
    <div class="fila-campos">
      <label class="campo"><span>Sube en</span><input name="sube" value="${esc(p.sube)}" autocomplete="off" placeholder="Ej: Castelli 90"></label>
      <label class="campo"><span>Baja en</span><input name="baja" value="${esc(p.baja)}" autocomplete="off" placeholder="Ej: 51 / 17-18"></label>
    </div>
    <label class="campo"><span>Observaciones</span><input name="obs" value="${esc(p.obs)}" autocomplete="off" placeholder="Opcional"></label>`;
}

function datosForm(form) {
  const f = new FormData(form);
  return { nombre: f.get('nombre'), telefono: f.get('telefono'), sube: f.get('sube'), baja: f.get('baja'), obs: f.get('obs') };
}

// Autocompletar con la agenda (pasajeros que ya viajaron) y los fijos.
function activarSugerencias(form, sentido) {
  const input = form.elements.nombre;
  const tel = form.elements.telefono;
  const lista = $('.sugerencias ul', form);
  let opciones = [];
  let marcado = -1;

  const fuentes = () => {
    const vistos = new Set();
    const res = [];
    for (const a of E.agenda) {
      const k = normalizar(a.nombre);
      if (vistos.has(k)) continue;
      vistos.add(k);
      res.push(a);
    }
    return res;
  };

  const recorridoPara = (item) => {
    if (item.viajes?.[sentido]) return item.viajes[sentido];
    const otro = item.viajes?.[sentido === 'CL' ? 'LC' : 'CL'];
    return otro ? { sube: otro.baja, baja: otro.sube } : null;
  };

  const mostrar = (texto) => {
    const q = normalizar(texto);
    const qTel = texto.replace(/\D/g, '');
    if (q.length < 2) {
      lista.hidden = true;
      return;
    }
    opciones = fuentes()
      .filter((a) => normalizar(a.nombre).includes(q) || (qTel.length >= 3 && (a.telefono || '').replace(/\D/g, '').includes(qTel)))
      .slice(0, 8);
    marcado = -1;
    if (!opciones.length) {
      lista.hidden = true;
      return;
    }
    lista.innerHTML = opciones
      .map((a, i) => {
        const r = recorridoPara(a);
        return `<li role="option" data-i="${i}"><b>${esc(a.nombre)}</b>${a.telefono ? ` · ${esc(a.telefono)}` : ''}
          ${r ? `<small>${esc(r.sube || '—')} → ${esc(r.baja || '—')}</small>` : ''}</li>`;
      })
      .join('');
    lista.hidden = false;
  };

  const elegir = (i) => {
    const a = opciones[i];
    if (!a) return;
    const r = recorridoPara(a);
    form.elements.nombre.value = a.nombre;
    if (a.telefono) form.elements.telefono.value = a.telefono;
    if (r) {
      form.elements.sube.value = r.sube || '';
      form.elements.baja.value = r.baja || '';
    }
    lista.hidden = true;
    form.elements.obs.focus();
  };

  const marcar = (i) => {
    marcado = i;
    lista.querySelectorAll('li').forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
  };

  input.addEventListener('input', () => mostrar(input.value));
  tel.addEventListener('input', () => {
    if (!input.value.trim()) mostrar(tel.value);
  });
  input.addEventListener('keydown', (ev) => {
    if (lista.hidden) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      marcar(Math.min(marcado + 1, opciones.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      marcar(Math.max(marcado - 1, 0));
    } else if (ev.key === 'Enter' && marcado >= 0) {
      ev.preventDefault();
      elegir(marcado);
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      lista.hidden = true;
    }
  });
  lista.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li');
    if (li) {
      ev.preventDefault();
      elegir(Number(li.dataset.i));
    }
  });
  input.addEventListener('blur', () => setTimeout(() => (lista.hidden = true), 150));
}

function abrirNuevoPasajero(franjaId, autoId, lugar) {
  const f = buscarFranja(franjaId);
  if (!f) return;
  const nAuto = f.autos.findIndex((a) => a.id === autoId) + 1;
  abrirModal(
    `<form id="form-pasajero">
      ${cabeceraModal('Cargar pasajero', `<span class="etiqueta-sentido ${f.sentido}">${CORTO[f.sentido]}</span> ${esc(f.desde)} a ${esc(f.hasta)} · Auto ${nAuto}, lugar ${lugar + 1}`)}
      <div class="modal-cuerpo">${camposPasajero()}</div>
      <div class="modal-pie">
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-pasajero', m);
      activarSugerencias(form, f.sentido);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const boton = form.querySelector('[type=submit]');
        boton.disabled = true;
        const pasajero = datosForm(form);
        try {
          await operar({ tipo: 'agregarPasajero', franjaId, autoId, lugar, pasajero }, { mensaje: `${pasajero.nombre} cargado`, resaltar: true });
          cerrarModal();
          cargarAgenda();
        } catch (e) {
          boton.disabled = false;
          if (e.status === 409) {
            await traerDia(true);
            const fr = buscarFranja(franjaId);
            const hayLugar = fr && libres(fr) > 0;
            mostrarErrorModal(
              e.message,
              `<div style="margin-top:8px"><button type="button" class="btn btn-chico" data-accion="cargar-en-libre">${
                hayLugar ? 'Cargarlo en otro lugar libre de este horario' : 'El horario se llenó: agregar otro auto y cargarlo ahí'
              }</button></div>`,
            );
            $('[data-accion="cargar-en-libre"]', m)?.addEventListener('click', async () => {
              try {
                if (!hayLugar) await operar({ tipo: 'agregarAuto', franjaId });
                await operar({ tipo: 'agregarPasajero', franjaId, pasajero }, { mensaje: `${pasajero.nombre} cargado`, resaltar: true });
                cerrarModal();
              } catch (e2) {
                mostrarErrorModal(e2.message);
              }
            });
          } else mostrarErrorModal(e.message);
        }
      });
    },
  );
}

function opcionesFranjas(filtro, excluirId) {
  return E.dia.franjas
    .filter((f) => f.id !== excluirId && filtro(f))
    .map((f) => {
      const n = libres(f);
      return `<option value="${f.id}">${CORTO[f.sentido]} · ${f.desde} a ${f.hasta} — ${n ? `${n} libre${n > 1 ? 's' : ''}` : 'completo'}</option>`;
    })
    .join('');
}

function abrirEditarPasajero(id) {
  const u = ubicarPasajero(id);
  if (!u) return;
  const { franja: f, pasajero: p } = u;
  const otro = f.sentido === 'CL' ? 'LC' : 'CL';
  const opcMover = opcionesFranjas(() => true, f.id);
  const opcVuelta = opcionesFranjas((x) => x.sentido === otro);
  abrirModal(
    `<form id="form-pasajero">
      ${cabeceraModal(esc(p.nombre), `<span class="etiqueta-sentido ${f.sentido}">${CORTO[f.sentido]}</span> ${esc(f.desde)} a ${esc(f.hasta)} · Auto ${u.nAuto}, lugar ${u.lugar + 1} · cargado por ${esc(p.por)} ${p.en ? 'a las ' + horaCorta(p.en) : ''}`)}
      <div class="modal-cuerpo">
        ${p.fijoId ? `<div class="aviso-fijo">Es un <b>pasajero fijo</b>. Lo que cambies acá vale solo para este día. Para cambiarlo siempre, andá a "Pasajeros fijos".</div>` : ''}
        ${camposPasajero(p)}
        <div class="acciones-extra">
          ${opcVuelta ? `<div class="fila"><span>Cargar la vuelta en</span><select name="vuelta">${opcVuelta}</select><button type="button" class="btn" data-accion="cargar-vuelta">Cargar vuelta</button></div>` : ''}
          ${opcMover ? `<div class="fila"><span>Pasar a otro horario</span><select name="mover">${opcMover}</select><button type="button" class="btn" data-accion="mover">Pasar</button></div>` : ''}
        </div>
      </div>
      <div class="modal-pie">
        <button type="button" class="btn btn-peligro" data-accion="quitar">Quitar del viaje</button>
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar cambios</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-pasajero', m);
      activarSugerencias(form, f.sentido);
      const conError = (fn) => async (ev) => {
        ev.preventDefault?.();
        try {
          await fn(ev);
        } catch (e) {
          if (e.status === 404 || e.status === 409) traerDia(true);
          mostrarErrorModal(e.message);
        }
      };
      form.addEventListener(
        'submit',
        conError(async () => {
          await operar({ tipo: 'editarPasajero', pasajeroId: id, pasajero: datosForm(form) }, { mensaje: 'Cambios guardados', resaltar: id });
          cerrarModal();
          cargarAgenda();
        }),
      );
      $('[data-accion="quitar"]', m).addEventListener(
        'click',
        conError(async (ev) => {
          if (!confirmarDosPasos(ev.currentTarget, '¿Seguro? Tocá de nuevo')) return;
          await operar({ tipo: 'quitarPasajero', pasajeroId: id }, { mensaje: `${p.nombre} quitado del viaje` });
          cerrarModal();
        }),
      );
      $('[data-accion="mover"]', m)?.addEventListener(
        'click',
        conError(async () => {
          const destino = form.elements.mover.value;
          await operar({ tipo: 'moverPasajero', pasajeroId: id, franjaId: destino }, { mensaje: `${p.nombre} pasado de horario`, resaltar: id });
          cerrarModal();
        }),
      );
      $('[data-accion="cargar-vuelta"]', m)?.addEventListener(
        'click',
        conError(async () => {
          const d = datosForm(form);
          const pasajero = { ...d, sube: d.baja, baja: d.sube };
          await operar({ tipo: 'agregarPasajero', franjaId: form.elements.vuelta.value, pasajero }, { mensaje: `Vuelta de ${d.nombre} cargada`, resaltar: true });
          cerrarModal();
        }),
      );
    },
  );
}

// ---------- Horarios del día ----------

function abrirFranja(sentido, franjaId) {
  const f = franjaId ? buscarFranja(franjaId) : null;
  const s = f ? f.sentido : sentido;
  const vacia = f && !f.autos.some((a) => a.lugares.some(Boolean));
  abrirModal(
    `<form id="form-franja">
      ${cabeceraModal(f ? 'Cambiar horario' : 'Agregar horario', `<span class="etiqueta-sentido ${s}">${CORTO[s]}</span> solo para este día`)}
      <div class="modal-cuerpo">
        <div class="error-form" hidden></div>
        <div class="fila-campos">
          <label class="campo"><span>Desde</span><input type="time" name="desde" value="${f ? f.desde : ''}" required autofocus></label>
          <label class="campo"><span>Hasta</span><input type="time" name="hasta" value="${f ? f.hasta : ''}"></label>
        </div>
        <p class="ayuda" style="margin:0">Si dejás "Hasta" vacío se pone media hora después. Para cambiar los horarios de todos los días, usá la pestaña "Horarios".</p>
      </div>
      <div class="modal-pie">
        ${f ? `<button type="button" class="btn btn-peligro" data-accion="borrar-franja" ${vacia ? '' : 'disabled title="Tiene pasajeros"'}>Borrar horario</button>` : ''}
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">${f ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-franja', m);
      form.elements.desde.addEventListener('change', () => {
        if (form.elements.desde.value && (!form.elements.hasta.value || !f)) form.elements.hasta.value = sumarMinutos(form.elements.desde.value, 30);
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const desde = form.elements.desde.value;
        const hasta = form.elements.hasta.value || '';
        try {
          if (f) await operar({ tipo: 'editarFranja', franjaId: f.id, desde, hasta }, { mensaje: 'Horario cambiado' });
          else await operar({ tipo: 'agregarFranja', sentido: s, desde, hasta }, { mensaje: `Horario ${desde} agregado` });
          cerrarModal();
        } catch (e) {
          mostrarErrorModal(e.message);
        }
      });
      $('[data-accion="borrar-franja"]', m)?.addEventListener('click', async (ev) => {
        if (!confirmarDosPasos(ev.currentTarget, '¿Seguro? Tocá de nuevo')) return;
        try {
          await operar({ tipo: 'quitarFranja', franjaId: f.id }, { mensaje: 'Horario borrado' });
          cerrarModal();
        } catch (e) {
          mostrarErrorModal(e.message);
        }
      });
    },
  );
}

function abrirHistorial() {
  const h = E.dia?.historial || [];
  abrirModal(`
    ${cabeceraModal('Movimientos del día', 'Quién cargó, cambió o quitó cada cosa')}
    <div class="modal-cuerpo">
      ${h.length ? `<ul class="historial">${h.map((x) => `<li><time>${horaCorta(x.en)}</time><b>${esc(x.por)}</b> ${esc(x.accion)}</li>`).join('')}</ul>` : '<p class="vacio">Todavía no hubo movimientos este día.</p>'}
    </div>
    <div class="modal-pie"><button class="btn btn-primario" data-accion="cerrar">Cerrar</button></div>`);
}

// ---------- Pasajeros fijos ----------

function vistaFijos() {
  const tabla = (s) => {
    const lista = E.fijos.filter((f) => f.sentido === s).sort((a, b) => a.desde.localeCompare(b.desde) || a.nombre.localeCompare(b.nombre));
    return `
    <div class="tabla-caja ${s}">
      <h2>${SENTIDOS[s]}</h2>
      ${
        lista.length
          ? `<table>
        <thead><tr><th>Horario</th><th>Pasajero</th><th>Sube → Baja</th><th>Días</th><th></th></tr></thead>
        <tbody>${lista
          .map(
            (f) => `
          <tr class="${f.activo === false ? 'inactivo' : ''}">
            <td class="hora">${esc(f.desde)}</td>
            <td><span class="nombre">${esc(f.nombre)}</span>${f.telefono ? `<br><small>${esc(f.telefono)}</small>` : ''}${f.activo === false ? '<br><small><b>Pausado</b></small>' : ''}${f.obs ? `<br><small>${esc(f.obs)}</small>` : ''}</td>
            <td>${esc(f.sube || '—')} → ${esc(f.baja || '—')}</td>
            <td><div class="dias">${ORDEN_SEMANA.map((d) => `<span class="${f.dias.includes(d) ? 'si' : ''}" title="${DIAS_NOMBRE[d]}">${DIAS_LETRA[d]}</span>`).join('')}</div></td>
            <td><button class="btn btn-chico" data-accion="editar-fijo" data-fijo="${f.id}">Editar</button></td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>`
          : `<p class="vacio">No hay pasajeros fijos en este sentido.</p>`
      }
    </div>`;
  };
  return `
    <div class="titulo-vista">
      <h1>Pasajeros fijos</h1>
      <button class="btn btn-primario" data-accion="nuevo-fijo">+ Nuevo pasajero fijo</button>
    </div>
    <p class="ayuda">Los pasajeros fijos se cargan una sola vez y aparecen solos en la planilla de cada día que viajan. Los cambios que hagas acá se aplican desde mañana; para el día de hoy usá el botón <b>"Cargar fijos"</b> en la planilla.</p>
    ${tabla('CL')}${tabla('LC')}`;
}

function opcionesHorario(sentido, elegido) {
  const lista = (E.config?.horarios?.[sentido] || []).map((h) => h.desde);
  if (elegido && !lista.includes(elegido)) lista.push(elegido);
  lista.sort();
  return lista.map((h) => `<option value="${h}" ${h === elegido ? 'selected' : ''}>${h}</option>`).join('') + `<option value="otro">Otro horario…</option>`;
}

function abrirFijo(id) {
  const f = id ? E.fijos.find((x) => x.id === id) : null;
  const s = f?.sentido || 'CL';
  const dias = f?.dias || [1, 2, 3, 4, 5];
  abrirModal(
    `<form id="form-fijo">
      ${cabeceraModal(f ? 'Editar pasajero fijo' : 'Nuevo pasajero fijo', 'Se carga solo en la planilla los días marcados')}
      <div class="modal-cuerpo">
        ${camposPasajero(f || {})}
        <div class="campo"><span>Sentido</span>
          <div class="opciones-sentido">
            <label><input type="radio" name="sentido" value="CL" ${s === 'CL' ? 'checked' : ''}><span>Chascomús → La Plata</span></label>
            <label><input type="radio" name="sentido" value="LC" ${s === 'LC' ? 'checked' : ''}><span>La Plata → Chascomús</span></label>
          </div>
        </div>
        <div class="fila-campos">
          <label class="campo"><span>Horario</span><select name="desde">${opcionesHorario(s, f?.desde)}</select></label>
          <label class="campo" data-otro hidden><span>Otro horario</span><input type="time" name="desdeOtro"></label>
        </div>
        <div class="campo"><span>Días que viaja</span>
          <div class="selector-dias">
            ${ORDEN_SEMANA.map((d) => `<label title="${DIAS_NOMBRE[d]}"><input type="checkbox" name="dias" value="${d}" ${dias.includes(d) ? 'checked' : ''}><span>${DIAS_LETRA[d]}</span></label>`).join('')}
            <button type="button" class="btn btn-chico" data-accion="lun-vie">Lunes a viernes</button>
          </div>
        </div>
        ${
          f
            ? `<label class="check"><input type="checkbox" name="activo" ${f.activo !== false ? 'checked' : ''}> Activo (destildalo para pausarlo, por ejemplo en vacaciones)</label>`
            : `<div class="caja-vuelta">
            <label class="check" style="margin:0"><input type="checkbox" name="conVuelta"> También tiene vuelta</label>
            <div data-vuelta hidden style="margin-top:12px">
              <label class="campo" style="margin:0"><span>Horario de la vuelta (<span data-sentido-vuelta></span>)</span><select name="desdeVuelta"></select></label>
              <p class="ayuda" style="margin:6px 0 0">La vuelta se carga con las direcciones al revés, los mismos días.</p>
            </div>
          </div>`
        }
      </div>
      <div class="modal-pie">
        ${f ? `<button type="button" class="btn btn-peligro" data-accion="borrar-fijo">Borrar</button>` : ''}
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-fijo', m);
      const sentidoActual = () => form.querySelector('[name=sentido]:checked').value;
      activarSugerencias(form, sentidoActual());
      const refrescarHorarios = () => {
        const sa = sentidoActual();
        const previo = form.elements.desde.value;
        form.elements.desde.innerHTML = opcionesHorario(sa, previo !== 'otro' ? previo : null);
        const vuelta = form.elements.desdeVuelta;
        if (vuelta) {
          const otro = sa === 'CL' ? 'LC' : 'CL';
          vuelta.innerHTML = opcionesHorario(otro);
          $('[data-sentido-vuelta]', form).textContent = SENTIDOS[otro];
        }
        $('[data-otro]', form).hidden = form.elements.desde.value !== 'otro';
      };
      refrescarHorarios();
      form.querySelectorAll('[name=sentido]').forEach((r) => r.addEventListener('change', refrescarHorarios));
      form.elements.desde.addEventListener('change', () => ($('[data-otro]', form).hidden = form.elements.desde.value !== 'otro'));
      form.elements.conVuelta?.addEventListener('change', (ev) => ($('[data-vuelta]', form).hidden = !ev.target.checked));
      $('[data-accion="lun-vie"]', form).addEventListener('click', () =>
        form.querySelectorAll('[name=dias]').forEach((c) => (c.checked = ['1', '2', '3', '4', '5'].includes(c.value))),
      );

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = datosForm(form);
        const sa = sentidoActual();
        const desde = form.elements.desde.value === 'otro' ? form.elements.desdeOtro.value : form.elements.desde.value;
        const diasSel = [...form.querySelectorAll('[name=dias]:checked')].map((c) => Number(c.value));
        const fijo = { ...d, sentido: sa, desde, dias: diasSel, activo: f ? form.elements.activo.checked : true };
        const boton = form.querySelector('[type=submit]');
        boton.disabled = true;
        try {
          let r;
          if (f) r = await api('PUT', `/fijos/${f.id}`, { fijo });
          else {
            r = await api('POST', '/fijos', { fijo });
            if (form.elements.conVuelta?.checked) {
              const desdeV = form.elements.desdeVuelta.value;
              if (desdeV && desdeV !== 'otro') {
                r = await api('POST', '/fijos', { fijo: { ...fijo, sentido: sa === 'CL' ? 'LC' : 'CL', desde: desdeV, sube: d.baja, baja: d.sube } });
              }
            }
          }
          E.fijos = r.fijos;
          cerrarModal();
          render();
          aviso(f ? 'Pasajero fijo actualizado' : 'Pasajero fijo guardado');
        } catch (e) {
          boton.disabled = false;
          mostrarErrorModal(e.message);
        }
      });
      $('[data-accion="borrar-fijo"]', m)?.addEventListener('click', async (ev) => {
        if (!confirmarDosPasos(ev.currentTarget, '¿Seguro? Tocá de nuevo')) return;
        try {
          const r = await api('DELETE', `/fijos/${f.id}`);
          E.fijos = r.fijos;
          cerrarModal();
          render();
          aviso('Pasajero fijo borrado');
        } catch (e) {
          mostrarErrorModal(e.message);
        }
      });
    },
  );
}

// ---------- Horarios habituales ----------

function vistaHorarios() {
  if (!E.horariosEdit) return `<p class="cargando">Cargando…</p>`;
  const col = (s) => `
    <div class="tabla-caja ${s}">
      <h2>${SENTIDOS[s]}</h2>
      <ul class="lista-horas">
        ${E.horariosEdit[s].length ? E.horariosEdit[s].map((h, i) => `<li>${h.desde} <small>a ${h.hasta}</small><button class="btn-texto" data-accion="borrar-hora" data-sentido="${s}" data-i="${i}">Quitar</button></li>`).join('') : '<li><small>Sin horarios</small></li>'}
      </ul>
      <form class="agregar-hora" data-sentido="${s}">
        <input type="time" name="desde" required aria-label="Nuevo horario">
        <button class="btn">+ Agregar</button>
      </form>
    </div>`;
  const cambiado = JSON.stringify(E.horariosEdit) !== JSON.stringify(E.config?.horarios);
  return `
    <div class="titulo-vista">
      <h1>Horarios habituales</h1>
      <button class="btn btn-primario" data-accion="guardar-horarios" ${cambiado ? '' : 'disabled'}>${cambiado ? 'Guardar cambios' : 'Guardado'}</button>
    </div>
    <p class="ayuda">Son los horarios que aparecen cada vez que se abre un día nuevo en la planilla. Cada horario dura media hora (por ejemplo 06:00 a 06:30). Los días que ya se abrieron no cambian: para agregar o mover un horario de un día puntual, hacelo desde la planilla.</p>
    <div class="horarios-col">${col('CL')}${col('LC')}</div>`;
}

// ---------- Eventos ----------

document.addEventListener('click', async (ev) => {
  const irA = ev.target.closest('[data-ir]');
  if (irA) {
    ir(irA.dataset.ir);
    return;
  }
  const el = ev.target.closest('[data-accion]');
  if (!el) return;
  const a = el.dataset.accion;
  try {
    switch (a) {
      case 'cerrar':
        ev.preventDefault();
        cerrarModal();
        break;
      case 'salir':
        await api('POST', '/logout');
        E.usuario = null;
        mostrarLogin();
        break;
      case 'nuevo-pasajero':
        abrirNuevoPasajero(el.dataset.franja, el.dataset.auto, Number(el.dataset.lugar));
        break;
      case 'editar-pasajero':
        abrirEditarPasajero(el.dataset.pasajero);
        break;
      case 'agregar-auto':
        el.disabled = true;
        await operar({ tipo: 'agregarAuto', franjaId: el.dataset.franja }, { mensaje: 'Auto agregado (4 lugares más)' });
        break;
      case 'quitar-auto':
        await operar({ tipo: 'quitarAuto', franjaId: el.dataset.franja, autoId: el.dataset.auto }, { mensaje: 'Auto quitado' });
        break;
      case 'nueva-franja':
        abrirFranja(el.dataset.sentido);
        break;
      case 'editar-franja':
        abrirFranja(null, el.dataset.franja);
        break;
      case 'cargar-fijos': {
        el.disabled = true;
        await operar(
          { tipo: 'cargarFijos' },
          { mensaje: (r) => (r.resultado?.agregados ? `Se cargaron ${r.resultado.agregados} pasajero(s) fijo(s)` : 'Ya estaban cargados todos los fijos de este día') },
        );
        el.disabled = false;
        break;
      }
      case 'historial':
        abrirHistorial();
        break;
      case 'imprimir':
        window.print();
        break;
      case 'nuevo-fijo':
        abrirFijo();
        break;
      case 'editar-fijo':
        abrirFijo(el.dataset.fijo);
        break;
      case 'borrar-hora':
        E.horariosEdit[el.dataset.sentido].splice(Number(el.dataset.i), 1);
        render();
        break;
      case 'guardar-horarios': {
        const r = await api('PUT', '/config', { config: { horarios: E.horariosEdit } });
        E.config = r.config;
        E.horariosEdit = structuredClone(r.config.horarios);
        render();
        aviso('Horarios guardados');
        break;
      }
    }
  } catch (e) {
    if (e.status !== 401) {
      aviso(e.message, 'error');
      if (E.vista === 'planilla') traerDia(true);
    }
    if (el.isConnected) el.disabled = false;
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('[data-accion="elegir-fecha"]') && t.value) ir(`#/planilla/${t.value}`);
  if (t.matches('input[data-movil]')) {
    try {
      await operar({ tipo: 'movil', franjaId: t.dataset.franja, autoId: t.dataset.auto, movil: t.value }, { mensaje: 'Móvil guardado' });
    } catch (e) {
      aviso(e.message, 'error');
    }
  }
});

document.addEventListener('focusout', (ev) => {
  if (ev.target.matches?.('input[data-movil]') && E.renderPendiente) setTimeout(() => !document.activeElement?.matches('input[data-movil]') && render(), 50);
});

document.addEventListener('keydown', (ev) => {
  if (ev.target.matches?.('input[data-movil]') && ev.key === 'Enter') ev.target.blur();
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('.agregar-hora');
  if (!form) return;
  ev.preventDefault();
  const s = form.dataset.sentido;
  const desde = form.elements.desde.value;
  if (!desde) return;
  if (!E.horariosEdit[s].some((h) => h.desde === desde)) {
    E.horariosEdit[s].push({ desde, hasta: sumarMinutos(desde, 30) });
    E.horariosEdit[s].sort((a, b) => a.desde.localeCompare(b.desde));
  }
  render();
  $(`.agregar-hora[data-sentido="${s}"] input`)?.focus();
});

window.addEventListener('beforeunload', (ev) => {
  if (E.vista === 'horarios' && E.horariosEdit && JSON.stringify(E.horariosEdit) !== JSON.stringify(E.config?.horarios)) ev.preventDefault();
});

iniciar();