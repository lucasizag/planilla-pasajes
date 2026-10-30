// Acceso a la base de datos (Netlify Blobs) con control de concurrencia.
// Cada escritura usa el etag leído: si otra telefonista guardó en el medio,
// la escritura no se aplica y se vuelve a intentar sobre los datos nuevos.

export async function leer(store, clave) {
  const r = await store.getWithMetadata(clave, { type: 'json', consistency: 'strong' });
  return r ? { datos: r.data, etag: r.etag } : { datos: null, etag: null };
}

// fn(datosActuales) => { datos, resultado } | lanza error.
// crear() se usa cuando la clave todavía no existe.
export async function actualizar(store, clave, fn, crear) {
  for (let intento = 0; intento < 8; intento++) {
    let { datos, etag } = await leer(store, clave);
    const esNuevo = datos == null;
    if (esNuevo) datos = await crear();
    const resultado = await fn(datos);
    const r = esNuevo
      ? await store.setJSON(clave, datos, { onlyIfNew: true })
      : await store.setJSON(clave, datos, { onlyIfMatch: etag });
    if (r.modified) return { datos, etag: r.etag, resultado };
    await new Promise((res) => setTimeout(res, 40 + Math.random() * 120 * (intento + 1)));
  }
  throw Object.assign(new Error('Hay mucho movimiento en este momento. Probá de nuevo.'), { status: 503, propio: true });
}

// Lee y, si no existe, crea con onlyIfNew (para que dos que abren el día a la vez no lo pisen).
export async function leerOCrear(store, clave, crear) {
  for (let intento = 0; intento < 5; intento++) {
    const actual = await leer(store, clave);
    if (actual.datos != null) return actual;
    const datos = await crear();
    const r = await store.setJSON(clave, datos, { onlyIfNew: true });
    if (r.modified) return { datos, etag: r.etag };
  }
  return leer(store, clave);
}

// Implementación en memoria con la misma semántica, para desarrollo local y pruebas.
export function storeEnMemoria() {
  const mapa = new Map();
  let contador = 0;
  return {
    async getWithMetadata(clave) {
      const e = mapa.get(clave);
      return e ? { data: JSON.parse(e.json), etag: e.etag, metadata: {} } : null;
    },
    async setJSON(clave, datos, opciones = {}) {
      const e = mapa.get(clave);
      if (opciones.onlyIfNew && e) return { modified: false };
      if (opciones.onlyIfMatch && (!e || e.etag !== opciones.onlyIfMatch)) return { modified: false };
      const etag = `"${++contador}"`;
      mapa.set(clave, { json: JSON.stringify(datos), etag });
      return { modified: true, etag };
    },
    async list({ prefix = '' } = {}) {
      return { blobs: [...mapa.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: mapa.get(key).etag })), directories: [] };
    },
    async delete(clave) {
      mapa.delete(clave);
    },
  };
}
