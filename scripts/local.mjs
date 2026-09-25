// npm run local: crea .env con claves aleatorias si no existe, levanta compose y espera a que todo esté sano.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (!existsSync('.env')) {
  // Cada valor de ejemplo que empieza con "cambia-" se reemplaza por una clave aleatoria.
  const env = readFileSync('.env.example', 'utf8')
    .replace(/^([A-Z0-9_]+)=cambia-.*$/gm, (_, k) => `${k}=${randomBytes(18).toString('base64url')}`);
  writeFileSync('.env', env);
  console.log('Creado .env con claves aleatorias.');
}

try {
  execFileSync('docker', ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '600'], { stdio: 'inherit' });
} catch {
  console.error('\nAlgún contenedor no quedó sano. Revisa: docker compose ps -a && docker compose logs <servicio>');
  process.exit(1);
}

const clave = readFileSync('.env', 'utf8').match(/^USUARIO_DEMO_CLAVE=(.*)$/m)?.[1];
console.log(`
Mi Carpeta Segura en local
  App      http://localhost:4173
  Mailpit  http://localhost:8025
  Cuenta   andres.perez.45678@carpetacolombia.co
  Clave    ${clave}
`);
