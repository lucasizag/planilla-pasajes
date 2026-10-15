// Uso: npm run clave -- "contraseña"
// Imprime el hash para poner en la variable USUARIOS de Netlify.
import { hashearClave } from '../src/server/auth.mjs';

const clave = process.argv[2];
if (!clave) {
  console.error('Uso: npm run clave -- "contraseña"');
  process.exit(1);
}
console.log(hashearClave(clave));
