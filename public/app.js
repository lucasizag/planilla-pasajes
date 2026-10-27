// Remisería · Chascomús ⇄ La Plata
// Sin frameworks: todo el estado vive en `E` y la pantalla se vuelve a dibujar con render().

// Versión de la página. Tiene que coincidir con VERSION en src/server/app.mjs.
const VERSION = '7';

const SENTIDOS = { CL: 'Chascomús → La Plata', LC: 'La Plata → Chascomús' };
const CORTO = { CL: 'CH → LP', LC: 'LP → CH' };
const DIAS_LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const DURACION_VIAJE = 90; // minutos estimados de viaje, para el estado "En viaje"
const CADA_CUANTO = 15000; // ms entre actualizaciones mientras se usa la pantalla
const CADA_CUANTO_INACTIVO = 60000; // ms entre actualizaciones si nadie toca nada
const INACTIVO = 3 * 60000; // a partir de cuántos ms sin actividad se considera inactivo
const VISTAS_CON_DIA = ['inicio', 'sentido', 'hoy', 'nuevo'];

const E = {
  usuario: null,
  hoy: null,
  vista: 'inicio',
  sentido: 'CL',
  fecha: null,
  dia: null,
  etag: null,
  agenda: [],
  fijos: [],
  choferes: [],
  config: null,
  horariosEdit: null,
  nuevo: { sentido: null, ultimo: null },
  conectado: true,
  ultimaSync: null,
  renderPendiente: false,
};

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const app = $('#app');
const modal = $('#modal');

// ---------- Íconos ----------

const ICONO = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-5H7l-2 5z"/><path d="M5 12h14"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>',
  ida: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>',
  vuelta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5"/><path d="M11 6l-6 6 6 6"/></svg>',
  personas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.2 4.6 2 5.3 5"/></svg>',
  mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>',
  chofer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-2 1.9-3 3.5-3s2.9 1 3.5 3"/><path d="M15 10h3M15 14h3"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  grafico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M8 16v-4M12 16V8M16 16v-6"/></svg>',
  pin: '<svg width="40" height="46" viewBox="0 0 40 46" aria-hidden="true"><path d="M20 2C10 2 3 9.5 3 19c0 12 17 25 17 25s17-13 17-25C37 9.5 30 2 20 2z" fill="#7fb4ff"/><path d="M20 4.5c-8.6 0-14.5 6.4-14.5 14.5 0 9.8 12.6 20.6 14.5 22.2 1.9-1.6 14.5-12.4 14.5-22.2C34.5 10.9 28.6 4.5 20 4.5z" fill="#2b3170"/><g transform="translate(10.5 9.5) scale(.8)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15h18v-5l-2.5-5h-13L3 10z"/><path d="M3 10h18"/><circle cx="7" cy="15" r="2"/><circle cx="17" cy="15" r="2"/></g></svg>',
};

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

function minutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function fechaLarga(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  const [a, m, dd] = fecha.split('-');
  return { dia: DIAS_NOMBRE[d.getUTCDay()], numero: `${dd}/${m}/${a}`, texto: `${DIAS_NOMBRE[d.getUTCDay()].toLowerCase()} ${Number(dd)} de ${MESES[Number(m) - 1]} de ${a}` };
}

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
}

function ahoraMinutos() {
  const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  return minutos(t);
}

function nombreSucursal(u) {
  return { chascomus: 'Chascomús', laplata: 'La Plata' }[u] || (u ? u.charAt(0).toUpperCase() + u.slice(1) : '');
}

function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = texto;
  const cont = $('#avisos');
  while (cont.children.length >= 3) cont.firstChild.remove();
  cont.append(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3000);
}

// Token de sesión de respaldo, para navegadores que no guardan la cookie
// (por ejemplo el navegador interno de WhatsApp). Vive en memoria y, si se puede, en localStorage.
let tokenSesion = null;
try {
  tokenSesion = localStorage.getItem('sesion');
} catch {}
function guardarToken(t) {
  tokenSesion = t || null;
  try {
    if (t) localStorage.setItem('sesion', t);
    else localStorage.removeItem('sesion');
  } catch {}
}

const MOTIVOS = {
  'sin-sesion': 'el navegador no envió la sesión',
  firma: 'la sesión no es válida (cambió la configuración del sistema)',
  vencida: 'la sesión venció',
  formato: 'la sesión está dañada',
  'usuario-inexistente': 'el usuario ya no existe',
  'sin-secreto': 'falta configurar SESSION_SECRET',
};

async function api(metodo, ruta, cuerpo, headers = {}, reintento = false) {
  let r;
  try {
    r = await fetch('/api' + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(tokenSesion ? { authorization: `Bearer ${tokenSesion}` } : {}), ...headers },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    marcarConexion(false);
    throw Object.assign(new Error('Sin conexión a internet. Revisá la conexión y probá de nuevo.'), { status: 0 });
  }
  marcarConexion(true);
  revisarVersion(r.headers.get('x-version'));
  if (r.status === 304) return { sinCambios: true };
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/login' && !reintento && (tokenSesion || E.usuario)) {
    // Un 401 suelto puede ser pasajero: se reintenta una vez antes de cerrar la sesión.
    await new Promise((res) => setTimeout(res, 800));
    return api(metodo, ruta, cuerpo, headers, true);
  }
  if (r.status === 401 && ruta !== '/login') {
    if (!E.usuario && $('#form-login')) throw Object.assign(new Error('Sesión vencida'), { status: 401 });
    const yaLogueado = !!E.usuario;
    E.usuario = null;
    guardarToken(null);
    // Al abrir la página sin sesión, se muestra el login sin mensaje de error.
    if (ruta === '/yo' && !yaLogueado) mostrarLogin();
    else mostrarLogin(`Tu sesión terminó. Volvé a entrar.${datos.motivo ? ` (Motivo: ${MOTIVOS[datos.motivo] || datos.motivo})` : ''}`);
    throw Object.assign(new Error('Sesión vencida'), { status: 401 });
  }
  if (!r.ok) throw Object.assign(new Error(datos.error || 'Algo salió mal.'), { status: r.status });
  return datos;
}

// Si el servidor se actualizó y esta pestaña tiene la página vieja, se recarga sola (una vez).
function revisarVersion(v) {
  if (!v || v === VERSION) return;
  let yaRecargo = false;
  try {
    yaRecargo = sessionStorage.getItem('recargaVersion') === v;
    sessionStorage.setItem('recargaVersion', v);
  } catch {}
  if (!yaRecargo) location.reload();
}

function marcarConexion(ok) {
  if (ok) E.ultimaSync = new Date();
  E.conectado = ok;
  pintarEstado();
}

function pintarEstado() {
  const el = $('#estado');
  if (!el) return;
  el.className = 'estado' + (E.conectado ? '' : ' mal');
  el.innerHTML = E.conectado
    ? `<span class="punto"></span><span class="txt">Al día${E.ultimaSync ? ' · ' + E.ultimaSync.toLocaleTimeString('es-AR', { hour12: false }) : ''}</span>`
    : `<span class="punto"></span><span>Sin conexión</span>`;
}

// ---------- Rutas ----------
// #/inicio  #/sentido/CL/2026-10-15  #/hoy/2026-10-15  #/nuevo  #/fijos  #/choferes  #/horarios

function leerRuta() {
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const vista = ['inicio', 'sentido', 'hoy', 'nuevo', 'fijos', 'choferes', 'horarios'].includes(partes[0]) ? partes[0] : 'inicio';
  const anterior = E.vista;
  E.vista = vista;
  let fecha = E.hoy;
  if (vista === 'sentido') {
    E.sentido = partes[1] === 'LC' ? 'LC' : 'CL';
    if (/^\d{4}-\d{2}-\d{2}$/.test(partes[2] || '')) fecha = partes[2];
  } else if (vista === 'hoy') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(partes[1] || '')) fecha = partes[1];
  } else if (vista === 'nuevo') {
    // Al entrar a "Nuevo viaje" arranca en hoy; si ya estaba ahí, conserva la fecha elegida.
    fecha = anterior === 'nuevo' && E.fecha ? E.fecha : E.hoy;
  }
  if (fecha !== E.fecha) {
    E.fecha = fecha;
    E.dia = null;
    E.etag = null;
  }
}

function ir(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', async () => {
  leerRuta();
  cerrarModal();
  window.scrollTo(0, 0);
  await cargarVista();
});

// ---------- Login ----------

function mostrarLogin(mensaje = '') {
  cerrarModal();
  app.innerHTML = `
    <div class="login">
      <form id="form-login" autocomplete="on">
        <div class="logo-login">${ICONO.pin}<div><h1>Remisería</h1><p>Chascomús ⇄ La Plata</p></div></div>
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
      const r = await api('POST', '/login', { usuario: f.get('usuario'), clave: f.get('clave') });
      guardarToken(r.token);
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
  // Por defecto, cada sucursal arranca con su sentido en "Nuevo viaje".
  E.nuevo.sentido = E.usuario === 'laplata' ? 'LC' : 'CL';
  leerRuta();
  cargarAgenda();
  cargarListas();
  await cargarVista();
}

async function cargarAgenda() {
  try {
    E.agenda = (await api('GET', '/agenda')).agenda || [];
  } catch {}
}

async function cargarListas() {
  try {
    const [f, c, ch] = await Promise.all([api('GET', '/fijos'), api('GET', '/config'), api('GET', '/choferes')]);
    E.fijos = f.fijos || [];
    E.config = c.config || null;
    E.choferes = ch.choferes || [];
    if (E.vista === 'horarios' && !E.horariosEdit && E.config) E.horariosEdit = structuredClone(E.config.horarios);
    renderSeguro();
  } catch {}
}

async function cargarVista() {
  if (!E.usuario) return;
  render();
  if (VISTAS_CON_DIA.includes(E.vista)) await traerDia(true);
  else if (E.vista === 'horarios') {
    const c = await api('GET', '/config').catch((e) => (aviso(e.message, 'error'), {}));
    E.config = c.config || E.config;
    E.horariosEdit = E.config ? structuredClone(E.config.horarios) : null;
    render();
  } else if (E.vista === 'fijos' || E.vista === 'choferes') {
    await cargarListas();
  }
}

async function traerDia(forzar = false) {
  if (!VISTAS_CON_DIA.includes(E.vista) || !E.fecha) return;
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

// No redibujar mientras alguien está escribiendo en un formulario de la página.
function renderSeguro() {
  const activo = document.activeElement;
  if (activo && app.contains(activo) && activo.matches?.('input, textarea, select') && !activo.closest('.navfecha')) {
    E.renderPendiente = true;
    return;
  }
  render();
}

// Actualización automática, pensada para gastar pocos créditos de Netlify:
// cada 15 s mientras alguien usa la pantalla, cada 60 s si nadie toca nada hace 3 minutos,
// y nada si la pestaña está oculta. El control de cupo lo hace el servidor al guardar.
let ultimaActividad = Date.now();
let ultimaConsulta = 0;
function consultarSiToca(forzar = false) {
  if (!E.usuario || document.hidden || !VISTAS_CON_DIA.includes(E.vista)) return;
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
// Refresca los estados "En viaje / Finalizado" aunque no haya cambios.
setInterval(() => E.usuario && !document.hidden && (E.vista === 'inicio' || E.vista === 'hoy') && renderSeguro(), 60000);

// ---------- Estructura general ----------

function render() {
  if (!E.usuario) return;
  const scroll = window.scrollY;
  const menu = [
    ['inicio', '#/inicio', 'Inicio'],
    ['CL', `#/sentido/CL/${E.fecha || E.hoy}`, 'Chascomús → La Plata'],
    ['LC', `#/sentido/LC/${E.fecha || E.hoy}`, 'La Plata → Chascomús'],
    ['hoy', `#/hoy/${E.fecha || E.hoy}`, 'Viajes del día'],
    ['nuevo', '#/nuevo', 'Nuevo viaje'],
    ['fijos', '#/fijos', 'Pasajeros fijos'],
    ['choferes', '#/choferes', 'Choferes'],
    ['horarios', '#/horarios', 'Horarios'],
  ];
  const actual = E.vista === 'sentido' ? E.sentido : E.vista;
  const vistas = { inicio: vistaInicio, sentido: vistaSentido, hoy: vistaHoy, nuevo: vistaNuevo, fijos: vistaFijos, choferes: vistaChoferes, horarios: vistaHorarios };
  app.innerHTML = `
    <header class="top">
      <a class="marca" href="#/inicio">${ICONO.pin}<span><b>Remisería</b><small>Sistema de gestión · Chascomús ⇄ La Plata</small></span></a>
      <div class="espacio"></div>
      <div id="estado" class="estado"></div>
      <div class="hola">
        <div class="avatar" aria-hidden="true">${esc(nombreSucursal(E.usuario).charAt(0))}</div>
        <div><b>Hola, ${esc(nombreSucursal(E.usuario))}</b><small>Sucursal ${esc(nombreSucursal(E.usuario))}</small></div>
      </div>
      <button class="btn-texto" data-accion="salir">Salir</button>
    </header>
    <nav class="menu" aria-label="Secciones">
      ${menu.map(([k, href, txt]) => `<a href="${href}" ${k === actual ? 'aria-current="page"' : ''}>${txt}</a>`).join('')}
    </nav>
    <main class="contenido">${vistas[E.vista]()}</main>
    <footer class="pie">Remisería · Chascomús ⇄ La Plata · versión ${VERSION}</footer>`;
  pintarEstado();
  window.scrollTo(0, scroll);
  E.renderPendiente = false;
  if (E.vista === 'nuevo') prepararNuevo();
}

function navFecha(base, extra = '') {
  const { dia, numero } = fechaLarga(E.fecha);
  const esHoy = E.fecha === E.hoy;
  const pasado = E.fecha < E.hoy;
  return `
    <div class="navfecha">
      <a class="btn btn-flecha" href="${base}/${sumarDias(E.fecha, -1)}" title="Día anterior" aria-label="Día anterior">‹</a>
      <div class="fecha-grande">${dia} ${numero}${esHoy ? '<span class="chip-hoy">HOY</span>' : pasado ? '<span class="chip-pasado">PASADO</span>' : ''}</div>
      <a class="btn btn-flecha" href="${base}/${sumarDias(E.fecha, 1)}" title="Día siguiente" aria-label="Día siguiente">›</a>
      ${esHoy ? '' : `<a class="btn" href="${base}/${E.hoy}">Ir a hoy</a>`}
      <input type="date" value="${E.fecha}" data-fecha-base="${base}" aria-label="Elegir fecha">
      <div class="acciones">${extra}</div>
    </div>`;
}

// ---------- Datos derivados ----------

function choferPorId(id) {
  return E.choferes.find((c) => c.id === id) || null;
}

function textoChofer(auto) {
  const c = auto.choferId ? choferPorId(auto.choferId) : null;
  if (c) return { ok: true, texto: `${c.nombre}${c.movil ? ` · Móvil ${c.movil}` : ''}`, detalle: [c.auto, c.patente].filter(Boolean).join(' · '), telefono: c.telefono };
  if (auto.choferId) return { ok: true, texto: 'Chofer borrado de la lista', detalle: '' };
  if (auto.movil) return { ok: true, texto: auto.movil, detalle: '' };
  return { ok: false, texto: 'Sin chofer asignado', detalle: '' };
}

function estadoViaje(franja) {
  if (E.fecha !== E.hoy) return E.fecha > E.hoy ? { clase: 'programado', texto: 'Programado' } : { clase: 'finalizado', texto: 'Finalizado' };
  const ahora = ahoraMinutos();
  const inicio = minutos(franja.desde);
  if (ahora < inicio) return { clase: 'pendiente', texto: 'Pendiente' };
  if (ahora < inicio + DURACION_VIAJE) return { clase: 'en-viaje', texto: 'En viaje' };
  return { clase: 'finalizado', texto: 'Finalizado' };
}

// Cada auto con pasajeros es una "salida".
function salidasDelDia(sentido) {
  const res = [];
  for (const f of E.dia?.franjas || []) {
    if (sentido && f.sentido !== sentido) continue;
    f.autos.forEach((a, i) => {
      const pasajeros = a.lugares.filter(Boolean);
      if (pasajeros.length) res.push({ franja: f, auto: a, nAuto: i + 1, pasajeros });
    });
  }
  return res.sort((x, y) => x.franja.desde.localeCompare(y.franja.desde) || x.franja.sentido.localeCompare(y.franja.sentido) || x.nAuto - y.nAuto);
}

function contarPasajeros(sentido) {
  return salidasDelDia(sentido).reduce((n, s) => n + s.pasajeros.length, 0);
}

function libres(f) {
  return f.autos.reduce((n, a) => n + a.lugares.filter((x) => !x).length, 0);
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

// ---------- Inicio (dashboard) ----------

function vistaInicio() {
  const fl = fechaLarga(E.hoy);
  const tiles = [
    ['t-cl', `#/sentido/CL/${E.hoy}`, ICONO.ida, 'Chascomús → La Plata', 'Planilla de ida'],
    ['t-lc', `#/sentido/LC/${E.hoy}`, ICONO.vuelta, 'La Plata → Chascomús', 'Planilla de vuelta'],
    ['t-nuevo', '#/nuevo', ICONO.mas, 'Nuevo viaje', 'Cargar un pasajero'],
    ['t-hoy', `#/hoy/${E.hoy}`, ICONO.calendario, 'Viajes de hoy', 'Las dos sucursales'],
    ['t-fijos', '#/fijos', ICONO.personas, 'Pasajeros fijos', 'Clientes recurrentes'],
    ['t-choferes', '#/choferes', ICONO.chofer, 'Choferes', 'Autos y patentes'],
    ['t-horarios', '#/horarios', ICONO.reloj, 'Horarios', 'Salidas habituales'],
  ];
  const listo = !!E.dia && E.fecha === E.hoy;
  const salidas = listo ? salidasDelDia() : [];
  const nCL = listo ? contarPasajeros('CL') : 0;
  const nLC = listo ? contarPasajeros('LC') : 0;
  const sinChofer = salidas.filter((s) => !textoChofer(s.auto).ok).length;
  const enViaje = salidas.filter((s) => estadoViaje(s.franja).clase === 'en-viaje').length;
  const pendientes = salidas.filter((s) => estadoViaje(s.franja).clase === 'pendiente').length;
  const fijosActivos = E.fijos.filter((f) => f.activo !== false).length;
  const choferesActivos = E.choferes.filter((c) => c.activo !== false).length;

  return `
    <section class="banner">
      <div>
        <h1>Bienvenida, ${esc(nombreSucursal(E.usuario))}</h1>
        <p>Hoy es ${fl.texto} · Gestioná los viajes de hoy de forma rápida y sencilla</p>
      </div>
      <span class="pildora-grande">${listo ? `${nCL + nLC} pasajero${nCL + nLC === 1 ? '' : 's'} hoy` : 'Cargando…'}</span>
    </section>

    <h2 class="titulo-seccion">Accesos rápidos</h2>
    <div class="tiles">
      ${tiles.map(([c, href, ic, t, s]) => `<a class="tile ${c}" href="${href}">${ic}<b>${t}</b><small>${s}</small></a>`).join('')}
    </div>

    <div class="inicio-cols">
      <section>
        <div class="titulo-fila">
          <h2 class="titulo-seccion">Salidas de hoy</h2>
          ${listo ? `<span class="chip">${salidas.length} salida${salidas.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="salidas">
          ${!listo ? '<p class="cargando">Cargando…</p>' : salidas.length ? salidas.map(tarjetaSalida).join('') : `<div class="tarjeta sin-viajes">Todavía no hay pasajeros cargados para hoy.<br><br><a class="btn btn-naranja" href="#/nuevo">+ Cargar un viaje</a></div>`}
        </div>
      </section>
      <aside>
        <h2 class="titulo-seccion espaciador" aria-hidden="true">.</h2>
        <div class="resumen">
          <h2>${ICONO.grafico.replace('<svg', '<svg width="30" height="30"')} Resumen del día</h2>
          <div class="stat s1"><div class="icono">${ICONO.personas}</div><div><h3>Pasajeros hoy</h3><div class="numero">${nCL + nLC}</div><small>${nCL} CH → LP · ${nLC} LP → CH</small></div></div>
          <div class="stat s2"><div class="icono">${ICONO.auto}</div><div><h3>Salidas</h3><div class="numero">${salidas.length}</div><small>${pendientes} pendientes · ${enViaje} en viaje${sinChofer ? ` · <b>${sinChofer} sin chofer</b>` : ''}</small></div></div>
          <div class="stat s3"><div class="icono">${ICONO.calendario}</div><div><h3>Pasajeros fijos</h3><div class="numero">${fijosActivos}</div><small>activos en la semana</small></div></div>
          <div class="stat s4"><div class="icono">${ICONO.chofer}</div><div><h3>Choferes</h3><div class="numero">${choferesActivos}</div><small>activos</small></div></div>
        </div>
      </aside>
    </div>`;
}

function tarjetaSalida(s) {
  const ch = textoChofer(s.auto);
  const est = estadoViaje(s.franja);
  const varios = s.franja.autos.filter((a) => a.lugares.some(Boolean)).length > 1;
  return `
    <a class="salida ${s.franja.sentido}" href="#/sentido/${s.franja.sentido}/${E.fecha}">
      <h3>${esc(s.franja.desde)} a ${esc(s.franja.hasta)} · ${SENTIDOS[s.franja.sentido]}${varios ? ` · Auto ${s.nAuto}` : ''}</h3>
      <span class="estado-viaje ${est.clase}">${est.texto}</span>
      <div class="datos">
        <span class="${ch.ok ? '' : 'sin-chofer'}">Chofer: <b>${esc(ch.texto)}</b>${ch.detalle ? ` · ${esc(ch.detalle)}` : ''}</span>
        <span>Pasajeros: <b>${s.pasajeros.length} de ${s.auto.lugares.length}</b></span>
      </div>
    </a>`;
}

// ---------- Planilla de un sentido ----------

function vistaSentido() {
  const s = E.sentido;
  const extra = `
    <button class="btn" data-accion="cargar-fijos" title="Agrega los pasajeros fijos que viajan este día y todavía no están">Cargar fijos</button>
    <button class="btn" data-accion="historial">Movimientos</button>
    <button class="btn" data-accion="imprimir">Imprimir</button>`;
  let cuerpo = `<p class="cargando">Cargando la planilla…</p>`;
  if (E.dia) {
    const franjas = E.dia.franjas.filter((f) => f.sentido === s);
    const n = contarPasajeros(s);
    cuerpo = `
      <section class="franja-sentido">
        <div class="sentido-titulo ${s}">
          <h2>${SENTIDOS[s].toUpperCase()}</h2>
          <span class="resumen-txt">${n} pasajero${n === 1 ? '' : 's'}</span>
          <button class="btn btn-chico no-imprimir" data-accion="nueva-franja" data-sentido="${s}">+ Agregar horario</button>
        </div>
        <div class="grilla ${s}">
          ${franjas.length ? franjas.map(vistaFranja).join('') : `<div class="vacio-sentido">No hay horarios cargados para este día.</div>`}
        </div>
      </section>`;
  }
  const { dia, numero } = fechaLarga(E.fecha);
  return `
    ${navFecha(`#/sentido/${s}`, extra)}
    <h1 class="solo-impresion">${SENTIDOS[s]} · ${dia} ${numero}</h1>
    ${cuerpo}`;
}

function opcionesChofer(seleccionado) {
  const activos = E.choferes.filter((c) => c.activo !== false || c.id === seleccionado);
  return `<option value="">— Sin chofer —</option>` + activos.map((c) => `<option value="${c.id}" ${c.id === seleccionado ? 'selected' : ''}>${esc(c.nombre)}${c.movil ? ` · Móvil ${esc(c.movil)}` : ''}</option>`).join('');
}

function vistaFranja(f) {
  const total = f.autos.reduce((n, a) => n + a.lugares.length, 0);
  const ocupados = total - libres(f);
  const lleno = ocupados >= total;
  return `
  <article class="franja" data-franja="${f.id}">
    <header class="franja-cab">
      <span class="franja-hora">${esc(f.desde)} <small>a ${esc(f.hasta)}</small></span>
      <span class="ocupacion ${lleno ? 'lleno' : ''}">${lleno ? 'COMPLETO' : `${ocupados} de ${total}`}</span>
      <button class="btn-texto no-imprimir" data-accion="editar-franja" data-franja="${f.id}" title="Cambiar o borrar este horario" aria-label="Cambiar horario">✎</button>
    </header>
    ${f.autos
      .map((a, i) => {
        const ch = textoChofer(a);
        return `
      <div class="auto-cab">
        <b>Auto ${i + 1}</b>
        <select data-chofer data-franja="${f.id}" data-auto="${a.id}" aria-label="Chofer del auto ${i + 1}">${opcionesChofer(a.choferId)}</select>
        ${f.autos.length > 1 && !a.lugares.some(Boolean) ? `<button class="btn-texto" data-accion="quitar-auto" data-franja="${f.id}" data-auto="${a.id}">Quitar</button>` : ''}
        ${ch.detalle ? `<span class="info-auto">${esc(ch.detalle)}</span>` : ''}
        ${!a.choferId && a.movil ? `<span class="info-auto">Anotado antes: ${esc(a.movil)} <button class="btn-texto no-imprimir" data-accion="borrar-movil" data-franja="${f.id}" data-auto="${a.id}" title="Borrar este texto" aria-label="Borrar texto anterior">✕</button></span>` : ''}
      </div>
      ${a.lugares.map((p, j) => vistaLugar(f, a, j, p)).join('')}`;
      })
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

// ---------- Viajes del día (las dos sucursales) ----------

function vistaHoy() {
  const extra = `<button class="btn" data-accion="imprimir">Imprimir</button>`;
  const { dia, numero } = fechaLarga(E.fecha);
  if (!E.dia) return `${navFecha('#/hoy', extra)}<p class="cargando">Cargando…</p>`;
  const columna = (s) => {
    const salidas = salidasDelDia(s);
    const n = salidas.reduce((k, x) => k + x.pasajeros.length, 0);
    return `
      <section class="hoy-col">
        <div class="sentido-titulo ${s}">
          <h2>${SENTIDOS[s].toUpperCase()}</h2>
          <span class="resumen-txt">${n} pasajero${n === 1 ? '' : 's'} · ${salidas.length} salida${salidas.length === 1 ? '' : 's'}</span>
          <a class="btn btn-chico no-imprimir" href="#/sentido/${s}/${E.fecha}">Abrir planilla</a>
        </div>
        ${
          salidas.length
            ? salidas
                .map((x) => {
                  const ch = textoChofer(x.auto);
                  const est = estadoViaje(x.franja);
                  const varios = x.franja.autos.filter((a) => a.lugares.some(Boolean)).length > 1;
                  return `
            <article class="viaje">
              <div class="viaje-cab">
                <span class="hora">${esc(x.franja.desde)} <small>a ${esc(x.franja.hasta)}${varios ? ` · Auto ${x.nAuto}` : ''}</small></span>
                <span class="estado-viaje ${est.clase}">${est.texto}</span>
              </div>
              <div class="chofer ${ch.ok ? '' : 'falta'}">Chofer: ${esc(ch.texto)}${ch.detalle ? ` · ${esc(ch.detalle)}` : ''}${ch.telefono ? ` · Tel ${esc(ch.telefono)}` : ''}</div>
              <table class="tabla-pasajeros">
                <thead><tr><th></th><th>Pasajero</th><th>Sube</th><th>Baja</th><th class="col-obs">Obs.</th></tr></thead>
                <tbody>
                  ${x.pasajeros
                    .map(
                      (p, i) => `<tr>
                    <td class="n">${i + 1}</td>
                    <td><b>${esc(p.nombre)}</b>${p.fijoId ? ' <span class="etiqueta fijo">Fijo</span>' : ''}${p.telefono ? `<small>${esc(p.telefono)}</small>` : ''}</td>
                    <td>${esc(p.sube || '—')}</td>
                    <td>${esc(p.baja || '—')}</td>
                    <td class="col-obs obs">${esc(p.obs || '')}</td>
                  </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </article>`;
                })
                .join('')
            : `<p class="sin-viajes">No hay viajes cargados en este sentido.</p>`
        }
      </section>`;
  };
  return `
    <div class="cabecera no-imprimir"><h1>Viajes del día</h1></div>
    ${navFecha('#/hoy', extra)}
    <h1 class="solo-impresion">Viajes del ${dia.toLowerCase()} ${numero}</h1>
    ${cajaCancelados()}
    <div class="hoy-cols">${columna('CL')}${columna('LC')}</div>`;
}

// Viajes de pasajeros fijos cancelados para la fecha que se está mirando.
function cajaCancelados() {
  const lista = [];
  for (const f of E.fijos) {
    for (const c of f.cancelaciones || []) if (c.fecha === E.fecha) lista.push({ f, c });
  }
  if (!lista.length) return '';
  return `<div class="caja-cancelados"><b>Viajes fijos cancelados este día:</b> ${lista
    .map(({ f, c }) => `<span class="cancelado">${esc(f.nombre)} · ${textoTramo(c.tramo)}</span>`)
    .join(' ')}</div>`;
}

// ---------- Nuevo viaje ----------

function opcionesHorarioDia(sentido, elegido) {
  const delDia = (E.dia?.franjas || []).filter((f) => f.sentido === sentido);
  const desdeDia = new Set(delDia.map((f) => f.desde));
  const items = delDia.map((f) => {
    const n = libres(f);
    return { desde: f.desde, texto: `${f.desde} a ${f.hasta} — ${n ? `${n} lugar${n > 1 ? 'es' : ''} libre${n > 1 ? 's' : ''}` : 'completo (se agrega otro auto)'}` };
  });
  for (const h of E.config?.horarios?.[sentido] || []) {
    if (!desdeDia.has(h.desde)) items.push({ desde: h.desde, texto: `${h.desde} a ${h.hasta} — 4 lugares libres` });
  }
  items.sort((a, b) => a.desde.localeCompare(b.desde));
  return items.map((i) => `<option value="${i.desde}" ${i.desde === elegido ? 'selected' : ''}>${esc(i.texto)}</option>`).join('') + `<option value="otro">Otro horario…</option>`;
}

function vistaNuevo() {
  const s = E.nuevo.sentido || 'CL';
  const otro = s === 'CL' ? 'LC' : 'CL';
  const u = E.nuevo.ultimo;
  return `
    <div class="cabecera"><h1>Nuevo viaje</h1></div>
    <p class="ayuda">Cargá un pasajero sin buscar el lugar en la planilla: el sistema lo pone en el primer lugar libre del horario y, si está completo, agrega otro auto.</p>
    <form id="form-nuevo" class="tarjeta form-nuevo" autocomplete="off">
      ${u ? `<div class="ok-nuevo">✓ ${esc(u.texto)} <a class="btn btn-chico" href="#/sentido/${u.sentido}/${u.fecha}">Ver en la planilla</a></div>` : ''}
      <div class="error-form" hidden></div>
      <div class="fila-campos">
        <label class="campo"><span>Fecha</span><input type="date" name="fecha" value="${E.fecha}" required></label>
        <div></div>
      </div>
      <div class="campo"><span>Sentido</span>
        <div class="opciones-sentido">
          <label><input type="radio" name="sentido" value="CL" ${s === 'CL' ? 'checked' : ''}><span>Chascomús → La Plata</span></label>
          <label><input type="radio" name="sentido" value="LC" ${s === 'LC' ? 'checked' : ''}><span>La Plata → Chascomús</span></label>
        </div>
      </div>
      <div class="fila-campos">
        <label class="campo"><span>Horario</span><select name="desde" required>${E.dia ? opcionesHorarioDia(s) : '<option>Cargando…</option>'}</select></label>
        <label class="campo" data-otro hidden><span>Otro horario</span><input type="time" name="desdeOtro"></label>
      </div>
      <hr class="separador">
      ${camposPasajero({}, false)}
      <div class="caja-vuelta">
        <label class="check" style="margin:0"><input type="checkbox" name="conVuelta"> Cargar también la vuelta (${SENTIDOS[otro]})</label>
        <div data-vuelta hidden style="margin-top:12px">
          <label class="campo" style="margin:0"><span>Horario de la vuelta</span><select name="desdeVuelta">${E.dia ? opcionesHorarioDia(otro) : ''}</select></label>
          <p class="ayuda" style="margin:6px 0 0">Se carga el mismo día con las direcciones al revés.</p>
        </div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end">
        <button type="reset" class="btn">Limpiar</button>
        <button type="submit" class="btn btn-naranja">Guardar viaje</button>
      </div>
    </form>`;
}

function prepararNuevo() {
  const form = $('#form-nuevo');
  if (!form) return;
  const sentidoActual = () => form.querySelector('[name=sentido]:checked').value;
  activarSugerencias(form, sentidoActual);
  const mostrarOtro = () => ($('[data-otro]', form).hidden = form.elements.desde.value !== 'otro');
  mostrarOtro();
  form.elements.desde.addEventListener('change', mostrarOtro);
  form.querySelectorAll('[name=sentido]').forEach((r) =>
    r.addEventListener('change', () => {
      E.nuevo.sentido = sentidoActual();
      const datos = datosForm(form);
      const vuelta = form.elements.conVuelta.checked;
      render();
      const f2 = $('#form-nuevo');
      for (const [k, v] of Object.entries(datos)) if (f2.elements[k]) f2.elements[k].value = v;
      f2.elements.conVuelta.checked = vuelta;
      $('[data-vuelta]', f2).hidden = !vuelta;
    }),
  );
  form.elements.conVuelta.addEventListener('change', (ev) => ($('[data-vuelta]', form).hidden = !ev.target.checked));
  form.elements.fecha.addEventListener('change', async (ev) => {
    if (!ev.target.value) return;
    const datos = datosForm(form);
    E.fecha = ev.target.value;
    E.dia = null;
    E.etag = null;
    await traerDia(true);
    const f2 = $('#form-nuevo');
    if (f2) for (const [k, v] of Object.entries(datos)) if (f2.elements[k]) f2.elements[k].value = v;
  });
  form.addEventListener('reset', () => {
    E.nuevo.ultimo = null;
    setTimeout(render, 0);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = form.querySelector('[type=submit]');
    const sentido = sentidoActual();
    const desde = form.elements.desde.value === 'otro' ? form.elements.desdeOtro.value : form.elements.desde.value;
    const pasajero = datosForm(form);
    if (!desde) return mostrarError(form, 'Elegí el horario.');
    boton.disabled = true;
    try {
      const r = await operar({ tipo: 'nuevoViaje', sentido, desde, pasajero });
      let texto = `${pasajero.nombre} cargado en ${CORTO[sentido]} ${desde}`;
      if (form.elements.conVuelta.checked && form.elements.desdeVuelta.value && form.elements.desdeVuelta.value !== 'otro') {
        const otro = sentido === 'CL' ? 'LC' : 'CL';
        const dv = form.elements.desdeVuelta.value;
        await operar({ tipo: 'nuevoViaje', sentido: otro, desde: dv, pasajero: { ...pasajero, sube: pasajero.baja, baja: pasajero.sube } });
        texto += ` y vuelta en ${CORTO[otro]} ${dv}`;
      }
      E.nuevo.ultimo = { texto, sentido, fecha: E.fecha };
      aviso('Viaje guardado');
      cargarAgenda();
      render();
      $('#form-nuevo [name=nombre]')?.focus();
      void r;
    } catch (e) {
      boton.disabled = false;
      mostrarError(form, e.message);
    }
  });
}

function mostrarError(raiz, mensaje) {
  const caja = $('.error-form', raiz);
  if (caja) {
    caja.hidden = false;
    caja.textContent = mensaje;
    caja.scrollIntoView({ block: 'nearest' });
  }
}

// ---------- Operaciones ----------

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
    <button class="btn-texto" type="button" data-accion="cerrar" aria-label="Cerrar">×</button></div>`;
}

function mostrarErrorModal(mensaje, extra = '') {
  const caja = $('.error-form', modal);
  if (caja) {
    caja.hidden = false;
    caja.innerHTML = esc(mensaje) + extra;
    caja.scrollIntoView({ block: 'nearest' });
  }
}

// Botón de dos pasos en lugar de confirm(): el primer toque pide confirmación.
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

function camposPasajero(p = {}, conError = true) {
  return `
    ${conError ? '<div class="error-form" hidden></div>' : ''}
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
  return { nombre: f.get('nombre') || '', telefono: f.get('telefono') || '', sube: f.get('sube') || '', baja: f.get('baja') || '', obs: f.get('obs') || '' };
}

// Autocompletar con la agenda (pasajeros que ya viajaron).
// `sentido` puede ser un valor o una función que lo devuelve.
function activarSugerencias(form, sentido) {
  const input = form.elements.nombre;
  const tel = form.elements.telefono;
  const lista = $('.sugerencias ul', form);
  const sentidoAhora = () => (typeof sentido === 'function' ? sentido() : sentido);
  let opciones = [];
  let marcado = -1;

  const recorridoPara = (item) => {
    const s = sentidoAhora();
    if (item.viajes?.[s]) return item.viajes[s];
    const otro = item.viajes?.[s === 'CL' ? 'LC' : 'CL'];
    return otro ? { sube: otro.baja, baja: otro.sube } : null;
  };

  const mostrar = (texto) => {
    const q = normalizar(texto);
    const qTel = texto.replace(/\D/g, '');
    if (q.length < 2) {
      lista.hidden = true;
      return;
    }
    opciones = E.agenda
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
      ${cabeceraModal(esc(p.nombre), `<span class="etiqueta-sentido ${f.sentido}">${CORTO[f.sentido]}</span> ${esc(f.desde)} a ${esc(f.hasta)} · Auto ${u.nAuto}, lugar ${u.lugar + 1} · cargado por ${esc(nombreSucursal(p.por))} ${p.en ? 'a las ' + horaCorta(p.en) : ''}`)}
      <div class="modal-cuerpo">
        ${p.fijoId ? `<div class="aviso-fijo">Es un <b>pasajero fijo</b>. Lo que cambies acá vale solo para este día. Para cambiarlo siempre, andá a "Pasajeros fijos".</div>` : ''}
        ${camposPasajero(p)}
        <div class="acciones-extra">
          ${opcVuelta ? `<div class="fila"><span>Cargar la vuelta en</span><select name="vuelta">${opcVuelta}</select><button type="button" class="btn" data-accion="cargar-vuelta">Cargar vuelta</button></div>` : ''}
          ${opcMover ? `<div class="fila"><span>Pasar a otro horario</span><select name="mover">${opcMover}</select><button type="button" class="btn" data-accion="mover">Pasar</button></div>` : ''}
        </div>
      </div>
      <div class="modal-pie">
        <button type="button" class="btn btn-peligro" data-accion="quitar">${p.fijoId ? 'Cancelar este viaje' : 'Quitar del viaje'}</button>
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
          if (p.fijoId) {
            // Pasajero fijo: se cancela este tramo de este día y queda anotado en su ficha.
            const [fijoId, tipo = 'ida'] = p.fijoId.split(':');
            const r = await api('POST', `/fijos/${fijoId}/cancelar`, { fecha: E.fecha, tramo: tipo }).catch(async (e) => {
              // Si la ficha ya no existe o la fecha pasó, se quita igual de la planilla.
              if (e.status === 404 || e.status === 400) {
                await operar({ tipo: 'quitarPasajero', pasajeroId: id });
                return null;
              }
              throw e;
            });
            if (r) E.fijos = r.fijos;
            await traerDia(true);
            aviso(`Viaje de ${p.nombre} cancelado (${tipo})`);
          } else {
            await operar({ tipo: 'quitarPasajero', pasajeroId: id }, { mensaje: `${p.nombre} quitado del viaje` });
          }
          cerrarModal();
        }),
      );
      $('[data-accion="mover"]', m)?.addEventListener(
        'click',
        conError(async () => {
          await operar({ tipo: 'moverPasajero', pasajeroId: id, franjaId: form.elements.mover.value }, { mensaje: `${p.nombre} pasado de horario`, resaltar: id });
          cerrarModal();
        }),
      );
      $('[data-accion="cargar-vuelta"]', m)?.addEventListener(
        'click',
        conError(async () => {
          const d = datosForm(form);
          await operar({ tipo: 'agregarPasajero', franjaId: form.elements.vuelta.value, pasajero: { ...d, sube: d.baja, baja: d.sube } }, { mensaje: `Vuelta de ${d.nombre} cargada` });
          cerrarModal();
        }),
      );
    },
  );
}

// ---------- Horario de un día ----------

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
        <p class="ayuda" style="margin:0">Si dejás "Hasta" vacío se pone media hora después. Para cambiar los horarios de todos los días, usá la sección "Horarios".</p>
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
      ${h.length ? `<ul class="historial">${h.map((x) => `<li><time>${horaCorta(x.en)}</time><b>${esc(nombreSucursal(x.por))}</b> ${esc(x.accion)}</li>`).join('')}</ul>` : '<p class="vacio">Todavía no hubo movimientos este día.</p>'}
    </div>
    <div class="modal-pie"><button class="btn btn-primario" data-accion="cerrar">Cerrar</button></div>`);
}

// ---------- Pasajeros fijos ----------
// Cada pasajero fijo tiene una ficha con su horario semanal (ida y vuelta por día)
// y la lista de viajes cancelados por imprevistos.

const SALE_DE = { CL: 'Chascomús', LC: 'La Plata' };

function horariosFijo(f) {
  if (f.horarios) return f.horarios;
  const h = {};
  for (const d of f.dias || []) h[d] = { ida: f.desde || '', vuelta: '' };
  return h;
}

function cancelacionesProximas(f) {
  return (f.cancelaciones || []).filter((c) => c.fecha >= E.hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function textoTramo(t) {
  return t === 'ambos' ? 'ida y vuelta' : t;
}

function fechaCorta(fecha) {
  const { dia, numero } = fechaLarga(fecha);
  return `${dia.slice(0, 3)} ${numero.slice(0, 5)}`;
}

function vistaFijos() {
  const tabla = (s) => {
    const lista = E.fijos.filter((f) => f.sentido === s).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return `
    <div class="tabla-caja ${s}">
      <h2>Salen de ${SALE_DE[s]} (ida ${CORTO[s]})</h2>
      ${
        lista.length
          ? `<table class="lista">
        <thead><tr><th>Pasajero</th><th>Sube → Baja (ida)</th><th>Semana</th><th>Cancelados</th><th></th></tr></thead>
        <tbody>${lista
          .map((f) => {
            const h = horariosFijo(f);
            const canc = cancelacionesProximas(f);
            return `
          <tr class="${f.activo === false ? 'inactivo' : ''}">
            <td><span class="nombre">${esc(f.nombre)}</span>${f.telefono ? `<br><small>${esc(f.telefono)}</small>` : ''}${f.activo === false ? '<br><small><b>Pausado</b></small>' : ''}${f.obs ? `<br><small>${esc(f.obs)}</small>` : ''}</td>
            <td>${esc(f.sube || '—')} → ${esc(f.baja || '—')}</td>
            <td><div class="semana">${ORDEN_SEMANA.filter((d) => h[d])
              .map((d) => `<span class="dia-fijo"><b>${DIAS_NOMBRE[d].slice(0, 3)}</b> ${h[d].ida ? `ida ${h[d].ida}` : ''}${h[d].ida && h[d].vuelta ? ' · ' : ''}${h[d].vuelta ? `vuelta ${h[d].vuelta}` : ''}</span>`)
              .join('')}</div></td>
            <td>${canc.length ? canc.map((c) => `<span class="cancelado">${fechaCorta(c.fecha)} · ${textoTramo(c.tramo)}</span>`).join('') : '<small>—</small>'}</td>
            <td><button class="btn btn-chico" data-accion="editar-fijo" data-fijo="${f.id}">Abrir ficha</button></td>
          </tr>`;
          })
          .join('')}</tbody>
      </table>`
          : `<p class="vacio">No hay pasajeros fijos que salgan de ${SALE_DE[s]}.</p>`
      }
    </div>`;
  };
  return `
    <div class="cabecera">
      <h1>Pasajeros fijos</h1>
      <button class="btn btn-naranja" data-accion="nuevo-fijo">+ Nuevo pasajero fijo</button>
    </div>
    <p class="ayuda">Cada pasajero fijo tiene una ficha con los días y horarios en que viaja (ida y vuelta). Sus viajes se cargan solos en la planilla de cada día. Si un día no viaja por un imprevisto, abrí su ficha y cancelá ese viaje: se saca de la planilla y no se vuelve a cargar.</p>
    ${tabla('CL')}${tabla('LC')}`;
}

// Selector de hora: horarios habituales + "Otro…" (muestra un campo de hora libre).
function selectorHora(nombre, sentido, valor) {
  const lista = (E.config?.horarios?.[sentido] || []).map((h) => h.desde);
  const esOtro = valor && !lista.includes(valor);
  return `<span class="sel-hora">
    <select name="${nombre}" aria-label="${nombre}">
      <option value="">—</option>
      ${lista.map((h) => `<option value="${h}" ${h === valor ? 'selected' : ''}>${h}</option>`).join('')}
      <option value="otro" ${esOtro ? 'selected' : ''}>Otro…</option>
    </select>
    <input type="time" name="${nombre}Otro" value="${esOtro ? valor : ''}" ${esOtro ? '' : 'hidden'}>
  </span>`;
}

function leerHora(form, nombre) {
  const v = form.elements[nombre].value;
  return v === 'otro' ? form.elements[nombre + 'Otro'].value : v;
}

function filasSemana(sentido, horarios) {
  return ORDEN_SEMANA.map((d) => {
    const h = horarios[d] || {};
    const activo = !!(h.ida || h.vuelta);
    return `<tr data-dia="${d}" class="${activo ? '' : 'apagado'}">
      <td><label class="check" style="margin:0"><input type="checkbox" name="viaja${d}" ${activo ? 'checked' : ''}> ${DIAS_NOMBRE[d]}</label></td>
      <td>${selectorHora('ida' + d, sentido, h.ida || '')}</td>
      <td>${selectorHora('vuelta' + d, sentido === 'CL' ? 'LC' : 'CL', h.vuelta || '')}</td>
    </tr>`;
  }).join('');
}

function bloqueCancelaciones(f) {
  const canc = cancelacionesProximas(f);
  return `
    <h3 class="sub">Viajes cancelados</h3>
    <p class="ayuda" style="margin:0 0 10px">Para un imprevisto: elegí la fecha y qué tramo no viaja. Se saca de la planilla de ese día y queda anotado acá.</p>
    ${canc.length ? `<ul class="lista-cancel">${canc.map((c) => `<li><b>${fechaLarga(c.fecha).dia} ${fechaLarga(c.fecha).numero}</b> · ${textoTramo(c.tramo)}${c.por ? ` <small>(canceló ${esc(nombreSucursal(c.por))})</small>` : ''}<button type="button" class="btn btn-chico" data-reactivar="${c.fecha}" data-tramo="${c.tramo}">Reactivar</button></li>`).join('')}</ul>` : ''}
    <div class="fila-cancel">
      <input type="date" name="fechaCancel" min="${E.hoy}" value="${E.hoy}" aria-label="Fecha a cancelar">
      <select name="tramoCancel" aria-label="Qué se cancela">
        <option value="ambos">Ida y vuelta</option>
        <option value="ida">Solo la ida</option>
        <option value="vuelta">Solo la vuelta</option>
      </select>
      <button type="button" class="btn btn-peligro" data-accion-local="cancelar-viaje">Cancelar viaje</button>
    </div>
    <div class="msg-cancel" hidden></div>`;
}

function abrirFijo(id) {
  const f = id ? E.fijos.find((x) => x.id === id) : null;
  const s = f?.sentido || (E.usuario === 'laplata' ? 'LC' : 'CL');
  const horarios = f ? horariosFijo(f) : {};
  abrirModal(
    `<form id="form-fijo">
      ${cabeceraModal(f ? `Ficha de ${esc(f.nombre)}` : 'Nuevo pasajero fijo', 'Sus viajes se cargan solos en la planilla los días marcados')}
      <div class="modal-cuerpo">
        ${camposPasajero(f || {})}
        <p class="ayuda" style="margin:-6px 0 12px">"Sube" y "Baja" son de la ida. La vuelta usa las mismas direcciones al revés.</p>
        <div class="campo"><span>Sale de</span>
          <div class="opciones-sentido">
            <label><input type="radio" name="sentido" value="CL" ${s === 'CL' ? 'checked' : ''}><span>Chascomús (ida a La Plata)</span></label>
            <label><input type="radio" name="sentido" value="LC" ${s === 'LC' ? 'checked' : ''}><span>La Plata (ida a Chascomús)</span></label>
          </div>
        </div>
        <div class="campo"><span>Días y horarios en que viaja</span>
          <table class="tabla-semana">
            <thead><tr><th>Día</th><th>Ida <small data-t-ida>(${CORTO[s]})</small></th><th>Vuelta <small data-t-vuelta>(${CORTO[s === 'CL' ? 'LC' : 'CL']})</small></th></tr></thead>
            <tbody data-semana>${filasSemana(s, horarios)}</tbody>
          </table>
          <button type="button" class="btn btn-chico" data-accion-local="copiar-lunes" style="margin-top:8px">Copiar el horario del lunes de martes a viernes</button>
        </div>
        ${f ? `<label class="check"><input type="checkbox" name="activo" ${f.activo !== false ? 'checked' : ''}> Activo (destildalo para pausarlo, por ejemplo en vacaciones)</label>` : ''}
        ${f ? `<hr class="separador"><div data-cancelaciones>${bloqueCancelaciones(f)}</div>` : ''}
      </div>
      <div class="modal-pie">
        ${f ? `<button type="button" class="btn btn-peligro" data-accion="borrar-fijo">Borrar ficha</button>` : ''}
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-fijo', m);
      const sentidoActual = () => form.querySelector('[name=sentido]:checked').value;
      activarSugerencias(form, sentidoActual);

      const leerSemana = () => {
        const h = {};
        for (const d of ORDEN_SEMANA) {
          if (!form.elements['viaja' + d].checked) continue;
          const ida = leerHora(form, 'ida' + d);
          const vuelta = leerHora(form, 'vuelta' + d);
          if (ida || vuelta) h[d] = { ida, vuelta };
        }
        return h;
      };
      const conectarSemana = () => {
        form.querySelectorAll('.sel-hora select').forEach((sel) =>
          sel.addEventListener('change', () => {
            const otro = sel.nextElementSibling;
            otro.hidden = sel.value !== 'otro';
            if (!otro.hidden) otro.focus();
            const fila = sel.closest('tr');
            if (sel.value) {
              fila.querySelector('[type=checkbox]').checked = true;
              fila.classList.remove('apagado');
            }
          }),
        );
        form.querySelectorAll('[data-semana] [type=checkbox]').forEach((c) =>
          c.addEventListener('change', () => c.closest('tr').classList.toggle('apagado', !c.checked)),
        );
      };
      conectarSemana();

      form.querySelectorAll('[name=sentido]').forEach((r) =>
        r.addEventListener('change', () => {
          const sa = sentidoActual();
          const actual = leerSemana();
          $('[data-semana]', form).innerHTML = filasSemana(sa, actual);
          $('[data-t-ida]', form).textContent = `(${CORTO[sa]})`;
          $('[data-t-vuelta]', form).textContent = `(${CORTO[sa === 'CL' ? 'LC' : 'CL']})`;
          conectarSemana();
        }),
      );

      $('[data-accion-local="copiar-lunes"]', form).addEventListener('click', () => {
        const ida = leerHora(form, 'ida1');
        const vuelta = leerHora(form, 'vuelta1');
        if (!ida && !vuelta) return aviso('Primero poné el horario del lunes', 'error');
        const actual = leerSemana();
        for (const d of [1, 2, 3, 4, 5]) actual[d] = { ida, vuelta };
        $('[data-semana]', form).innerHTML = filasSemana(sentidoActual(), actual);
        conectarSemana();
      });

      // Cancelaciones (se guardan al instante, aparte del botón Guardar)
      const zona = $('[data-cancelaciones]', form);
      const pintarCancelaciones = (fijo) => {
        zona.innerHTML = bloqueCancelaciones(fijo);
      };
      zona?.addEventListener('click', async (ev) => {
        const msg = () => $('.msg-cancel', zona);
        const reactivar = ev.target.closest('[data-reactivar]');
        const cancelar = ev.target.closest('[data-accion-local="cancelar-viaje"]');
        if (!reactivar && !cancelar) return;
        try {
          let r;
          if (cancelar) {
            const fecha = form.elements.fechaCancel.value;
            const tramo = form.elements.tramoCancel.value;
            if (!fecha) return;
            const h = horariosFijo(f)[new Date(fecha + 'T12:00:00Z').getUTCDay()];
            if (!h) {
              const el = msg();
              el.hidden = false;
              el.textContent = `Ese día (${fechaLarga(fecha).dia.toLowerCase()}) ${f.nombre} no tiene viajes en su ficha.`;
              return;
            }
            r = await api('POST', `/fijos/${f.id}/cancelar`, { fecha, tramo });
            aviso(`Viaje cancelado: ${fechaCorta(fecha)} · ${textoTramo(tramo)}`);
          } else {
            r = await api('POST', `/fijos/${f.id}/reactivar`, { fecha: reactivar.dataset.reactivar, tramo: reactivar.dataset.tramo });
            aviso('Viaje reactivado');
          }
          E.fijos = r.fijos;
          Object.assign(f, r.fijo);
          pintarCancelaciones(r.fijo);
          if (VISTAS_CON_DIA.includes(E.vista)) traerDia(true);
        } catch (e) {
          const el = msg();
          if (el) {
            el.hidden = false;
            el.textContent = e.message;
          }
        }
      });

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const d = datosForm(form);
        const fijo = { ...d, sentido: sentidoActual(), horarios: leerSemana(), activo: f ? form.elements.activo.checked : true };
        const boton = form.querySelector('[type=submit]');
        boton.disabled = true;
        try {
          const r = f ? await api('PUT', `/fijos/${f.id}`, { fijo }) : await api('POST', '/fijos', { fijo });
          E.fijos = r.fijos;
          cerrarModal();
          render();
          aviso(f ? 'Ficha actualizada' : 'Pasajero fijo guardado. Sus viajes ya están en la planilla.');
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
          aviso('Ficha borrada');
        } catch (e) {
          mostrarErrorModal(e.message);
        }
      });
    },
  );
}

// ---------- Choferes ----------

function vistaChoferes() {
  const lista = [...E.choferes].sort((a, b) => (a.activo === false) - (b.activo === false) || a.nombre.localeCompare(b.nombre));
  return `
    <div class="cabecera">
      <h1>Choferes</h1>
      <button class="btn btn-naranja" data-accion="nuevo-chofer">+ Nuevo chofer</button>
    </div>
    <p class="ayuda">Cargá los choferes con su número de móvil, el modelo del auto y la patente. Después, en la planilla, elegís qué chofer hace cada salida.</p>
    <div class="tabla-caja CH">
      <h2>Lista de choferes</h2>
      ${
        lista.length
          ? `<table class="lista">
        <thead><tr><th>Chofer</th><th>Móvil</th><th>Auto</th><th>Patente</th><th>Teléfono</th><th></th></tr></thead>
        <tbody>${lista
          .map(
            (c) => `
          <tr class="${c.activo === false ? 'inactivo' : ''}">
            <td><span class="nombre">${esc(c.nombre)}</span>${c.activo === false ? '<br><small><b>Inactivo</b></small>' : ''}</td>
            <td class="hora">${esc(c.movil || '—')}</td>
            <td>${esc(c.auto || '—')}</td>
            <td>${c.patente ? `<span class="patente">${esc(c.patente)}</span>` : '—'}</td>
            <td>${esc(c.telefono || '—')}</td>
            <td><button class="btn btn-chico" data-accion="editar-chofer" data-chofer="${c.id}">Editar</button></td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>`
          : `<p class="vacio">Todavía no hay choferes cargados.</p>`
      }
    </div>`;
}

function abrirChofer(id) {
  const c = id ? E.choferes.find((x) => x.id === id) : null;
  abrirModal(
    `<form id="form-chofer" autocomplete="off">
      ${cabeceraModal(c ? 'Editar chofer' : 'Nuevo chofer')}
      <div class="modal-cuerpo">
        <div class="error-form" hidden></div>
        <label class="campo"><span>Nombre y apellido</span><input name="nombre" value="${esc(c?.nombre)}" required autofocus></label>
        <div class="fila-campos">
          <label class="campo"><span>Número de móvil</span><input name="movil" value="${esc(c?.movil)}" placeholder="Ej: 12"></label>
          <label class="campo"><span>Teléfono</span><input name="telefono" value="${esc(c?.telefono)}" inputmode="tel"></label>
        </div>
        <div class="fila-campos">
          <label class="campo"><span>Modelo del auto</span><input name="auto" value="${esc(c?.auto)}" placeholder="Ej: Toyota Corolla gris"></label>
          <label class="campo"><span>Patente</span><input name="patente" value="${esc(c?.patente)}" placeholder="Ej: AB 123 CD" style="text-transform:uppercase"></label>
        </div>
        ${c ? `<label class="check"><input type="checkbox" name="activo" ${c.activo !== false ? 'checked' : ''}> Activo (si lo destildás, no aparece para elegir en la planilla)</label>` : ''}
      </div>
      <div class="modal-pie">
        ${c ? `<button type="button" class="btn btn-peligro" data-accion="borrar-chofer">Borrar</button>` : ''}
        <button type="button" class="btn" data-accion="cerrar">Cancelar</button>
        <button type="submit" class="btn btn-primario">Guardar</button>
      </div>
    </form>`,
    (m) => {
      const form = $('#form-chofer', m);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const chofer = { nombre: fd.get('nombre'), movil: fd.get('movil'), telefono: fd.get('telefono'), auto: fd.get('auto'), patente: fd.get('patente'), activo: c ? form.elements.activo.checked : true };
        try {
          const r = c ? await api('PUT', `/choferes/${c.id}`, { chofer }) : await api('POST', '/choferes', { chofer });
          E.choferes = r.choferes;
          cerrarModal();
          render();
          aviso(c ? 'Chofer actualizado' : 'Chofer guardado');
        } catch (e) {
          mostrarErrorModal(e.message);
        }
      });
      $('[data-accion="borrar-chofer"]', m)?.addEventListener('click', async (ev) => {
        if (!confirmarDosPasos(ev.currentTarget, '¿Seguro? Tocá de nuevo')) return;
        try {
          const r = await api('DELETE', `/choferes/${c.id}`);
          E.choferes = r.choferes;
          cerrarModal();
          render();
          aviso('Chofer borrado');
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
    <div class="cabecera">
      <h1>Horarios habituales</h1>
      <button class="btn btn-naranja" data-accion="guardar-horarios" ${cambiado ? '' : 'disabled'}>${cambiado ? 'Guardar cambios' : 'Guardado'}</button>
    </div>
    <p class="ayuda">Son los horarios con los que arranca cada día nuevo en la planilla. Cada horario dura media hora (por ejemplo 06:00 a 06:30). Los días que ya se abrieron no cambian: para agregar o mover un horario de un día puntual, hacelo desde la planilla.</p>
    <div class="horarios-col">${col('CL')}${col('LC')}</div>`;
}

// ---------- Eventos ----------

document.addEventListener('click', async (ev) => {
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
        await api('POST', '/logout').catch(() => {});
        guardarToken(null);
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
      case 'borrar-movil':
        await operar({ tipo: 'asignarChofer', franjaId: el.dataset.franja, autoId: el.dataset.auto, choferId: null }, { mensaje: 'Texto anterior borrado' });
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
      case 'cargar-fijos':
        el.disabled = true;
        await operar(
          { tipo: 'cargarFijos' },
          { mensaje: (r) => (r.resultado?.agregados ? `Se cargaron ${r.resultado.agregados} pasajero(s) fijo(s)` : 'Ya estaban cargados todos los fijos de este día') },
        );
        el.disabled = false;
        break;
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
      case 'nuevo-chofer':
        abrirChofer();
        break;
      case 'editar-chofer':
        abrirChofer(el.dataset.chofer);
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
      if (VISTAS_CON_DIA.includes(E.vista)) traerDia(true);
    }
    if (el.isConnected) el.disabled = false;
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('input[data-fecha-base]') && t.value) ir(`${t.dataset.fechaBase}/${t.value}`);
  if (t.matches('select[data-chofer]')) {
    const c = choferPorId(t.value);
    try {
      await operar({ tipo: 'asignarChofer', franjaId: t.dataset.franja, autoId: t.dataset.auto, choferId: t.value || null, choferNombre: c?.nombre || '' }, { mensaje: c ? `Chofer: ${c.nombre}` : 'Chofer quitado' });
    } catch (e) {
      aviso(e.message, 'error');
    }
    t.blur();
    if (E.renderPendiente) render();
  }
});

document.addEventListener('focusout', () => {
  if (E.renderPendiente && modal.hidden) {
    setTimeout(() => {
      const a = document.activeElement;
      if (!(a && app.contains(a) && a.matches?.('input, textarea, select'))) render();
    }, 50);
  }
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
