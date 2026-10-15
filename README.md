# Planilla de pasajes Chascomús ⇄ La Plata

Sistema web para que las dos telefonistas (Chascomús y La Plata) carguen los pasajes en **una misma planilla compartida**. Lo que carga una lo ve la otra a los pocos segundos, y el sistema no deja vender dos veces el mismo lugar.

Todo corre en **Netlify**: la página, las funciones del servidor y la base de datos (Netlify Blobs). No usa Supabase ni otro servicio externo.

## Qué hace

- **Planilla del día**, con el mismo formato que la de papel: arriba *Chascomús → La Plata* y abajo *La Plata → Chascomús*. Cada horario es una franja de media hora (por ejemplo 06:00 a 06:30) con autos de 4 lugares.
  - Por pasajero se anota **nombre, teléfono, sube, baja y observaciones**, y por auto el **número de móvil**.
  - **+ Otro auto** agrega 4 lugares más al horario. Reemplaza lo de "pegar otro renglón".
  - **+ Agregar horario** suma una franja solo para ese día. También se puede cambiar o borrar una franja si está vacía.
  - **Cargar la vuelta**: desde un pasajero, lo carga en el sentido contrario con las direcciones invertidas.
  - **Pasar a otro horario**: lo mueve de franja.
  - **Movimientos**: muestra quién cargó, cambió o quitó cada cosa en el día.
  - **Imprimir**: saca la hoja del día en A4 apaisado para el chofer.
- **Control de cupo**: si las dos telefonistas intentan ocupar el mismo lugar al mismo tiempo, entra una y la otra recibe el aviso "Ese lugar lo acaba de ocupar…". Desde ese aviso puede cargarlo en otro lugar libre, o agregar un auto si el horario se llenó.
- **Autocompletar**: al escribir el nombre (o el teléfono) aparecen los pasajeros que ya viajaron, con sus direcciones. Si es la vuelta, las direcciones aparecen invertidas.
- **Pasajeros fijos**: se cargan una sola vez con sentido, horario y días de la semana (opcionalmente con su vuelta), y aparecen solos en la planilla de cada día que viajan.
  - Si un día no viaja, se lo quita de ese día y el resto de la semana sigue igual.
  - Se pueden pausar (por ejemplo, en vacaciones).
  - Los cambios se aplican desde mañana. Para el día de hoy está el botón **Cargar fijos**.
- **Horarios habituales**: la lista de franjas con la que arranca cada día nuevo. Se edita desde la pestaña *Horarios*, sin tocar código.
- **Usuario y contraseña** para cada sucursal.

## Estructura

```
public/                 Página (HTML, CSS y JS, sin paso de build)
netlify/functions/api.mjs   Función de Netlify que atiende /api/*
src/server/
  app.mjs               Rutas de la API
  logic.mjs             Reglas de la planilla (lugares, autos, fijos)
  datos.mjs             Acceso a Netlify Blobs con control de concurrencia (etag)
  auth.mjs              Contraseñas (scrypt) y sesión (cookie firmada)
scripts/clave.mjs       Genera el hash de una contraseña
dev-server.mjs          Servidor local con base en memoria
test/                   Pruebas automáticas
```

Los datos se guardan en el store de Blobs `planilla`:

| Clave | Contenido |
|---|---|
| `dias/AAAA-MM-DD` | Planilla de cada día |
| `fijos` | Pasajeros fijos |
| `config` | Horarios habituales |
| `agenda` | Pasajeros conocidos, para autocompletar |

## Publicar en Netlify

1. Subí este repositorio a GitHub.
2. En Netlify, entrá a **Add new site → Import an existing project**, elegí el repo y dejá la configuración que trae `netlify.toml`. No hace falta comando de build.
3. Generá el hash de cada contraseña en tu computadora:
   ```bash
   npm install
   npm run clave -- "contraseña-de-chascomus"
   npm run clave -- "contraseña-de-la-plata"
   ```
4. En Netlify, entrá a **Site configuration → Environment variables** y creá estas dos variables:
   - `USUARIOS` = `chascomus:<hash1>,laplata:<hash2>`. Los nombres de usuario los elegís vos: son lo que se escribe para entrar.
   - `SESSION_SECRET` = un texto largo y al azar. Por ejemplo, la salida de `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. Volvé a desplegar (**Deploys → Trigger deploy**). Netlify Blobs se activa solo, no hay que configurar nada más.

Para cambiar una contraseña, generá un hash nuevo, actualizá `USUARIOS` y volvé a desplegar.

Para cerrar todas las sesiones abiertas, cambiá `SESSION_SECRET`.

## Probar en la computadora

```bash
npm install
npm run dev     # http://localhost:8888  (usuarios chascomus / laplata, clave: prueba)
npm test
```

El servidor local guarda los datos en memoria, así que se borran al cerrarlo.
