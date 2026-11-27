// Herramientas de apoyo de scripts/preparar-entrega.sh. Solo módulos nativos de Node.js 22.
// No modifica el repositorio: trabaja siempre sobre la copia exportada que recibe como argumento.
//
// Subcomandos:
//   excluir   <copia> <exclusiones.txt>                 borra lo excluido e imprime la lista de rutas borradas
//   ajustar   <copia> <lista-excluidos.txt>             revisa enlaces y menciones; corrige README.md y ARCHITECTURE.md
//   verificar <copia> [permitidos.txt] [--sin-readme]   verificaciones de limpieza; código 1 si alguna falla
//                                                       (--sin-readme: etapa intermedia, aún sin README.md)
//   env       <copia>                                   comprueba las plantillas .env.example (sin secretos reales)
//   etapas    <copia> <etapas.txt> <exclusiones.txt> <dir-plan> [--autor-javier "N <c>"] [--autor-enggel "N <c>"]
//                                                       reparte la copia limpia en etapas (subida progresiva)
//   copiar    <origen> <lista> <destino>                copia los archivos de la lista con sus permisos

import {
  readFileSync, writeFileSync, readdirSync, statSync, lstatSync, rmSync, rmdirSync, existsSync,
  mkdirSync, copyFileSync, chmodSync,
} from 'node:fs';
import { join, relative, dirname, resolve, sep, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const LIMITE_TAMANO = 5 * 1024 * 1024; // 5 MB

// ------------------------------------------------------------------ utilidades

/** Lista recursiva de archivos (rutas relativas con '/'), sin entrar en .git. */
function listarArchivos(raiz) {
  const salida = [];
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      if (dir === raiz && nombre === '.git') continue;
      const ruta = join(dir, nombre);
      const st = lstatSync(ruta);
      if (st.isDirectory()) recorrer(ruta);
      else salida.push(relative(raiz, ruta).split(sep).join('/'));
    }
  };
  recorrer(raiz);
  return salida.sort();
}

/** Borra directorios vacíos de abajo hacia arriba (nunca la raíz). */
function podarVacios(raiz) {
  const podar = (dir) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (lstatSync(ruta).isDirectory() && !(dir === raiz && nombre === '.git')) podar(ruta);
    }
    if (dir !== raiz && readdirSync(dir).length === 0) rmdirSync(dir);
  };
  podar(raiz);
}

function esBinario(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

function leerLista(archivo) {
  return readFileSync(archivo, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

// ------------------------------------------------------------------ patrones tipo .gitignore

/**
 * Convierte un patrón de exclusión en expresión regular sobre rutas de archivo relativas.
 * - Sin '/' interna: coincide con el nombre en cualquier nivel (p. ej. "*.db", ".env").
 * - Con '/': anclado a la raíz de la copia (p. ej. "attack-lab/resultados/*").
 * - Terminado en '/': carpeta (coincide con todo lo que contiene).
 * - '*' no cruza '/', '**' sí, '?' es un carácter.
 */
function patronARegex(patron) {
  let p = patron;
  const soloCarpeta = p.endsWith('/');
  if (soloCarpeta) p = p.slice(0, -1);
  const anclado = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefijo = anclado ? '^' : '^(?:.*/)?';
  const sufijo = soloCarpeta ? '/.*$' : '(?:/.*)?$';
  return new RegExp(prefijo + re + sufijo);
}

function cargarExclusiones(archivo) {
  return leerLista(archivo).map((linea) => {
    const negado = linea.startsWith('!');
    const patron = negado ? linea.slice(1) : linea;
    return { linea, negado, re: patronARegex(patron) };
  });
}

/** La última regla que coincide decide (como en .gitignore, pero evaluada archivo por archivo). */
function excluido(ruta, reglas) {
  let resultado = false;
  for (const r of reglas) if (r.re.test(ruta)) resultado = !r.negado;
  return resultado;
}

// ------------------------------------------------------------------ excluir

function cmdExcluir(copia, archivoExclusiones) {
  const reglas = cargarExclusiones(archivoExclusiones);
  const borrados = [];
  for (const ruta of listarArchivos(copia)) {
    if (excluido(ruta, reglas)) {
      rmSync(join(copia, ruta), { force: true });
      borrados.push(ruta);
    }
  }
  podarVacios(copia);
  process.stdout.write(borrados.map((r) => `${r}\n`).join(''));
  return 0;
}

// ------------------------------------------------------------------ ajustar (enlaces y menciones)

// En este proyecto la IA es una funcionalidad del producto: los proveedores de modelos que usa la aplicación
// (Gemini, OpenAI o compatibles) aparecen legítimamente en el código, en .env.example y en la documentación.
// Por eso solo se buscan rastros de herramientas de AUTORÍA (asistentes de programación y coautoría).
const PALABRAS_HERRAMIENTAS = /claude|anthropic|chatgpt|copilot|co-authored-by|generated with|cursor\.sh|\.cursorrules/i;

const RE_ENLACE_MD = /\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const RE_ENLACE_HTML = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

function esEnlaceExterno(destino) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/|\$\{|\{\{)/i.test(destino);
}

function resolverDestino(copia, archivo, destino) {
  let d = destino.split('#')[0].split('?')[0];
  if (!d) return null;
  try { d = decodeURIComponent(d); } catch { /* se usa tal cual */ }
  const absoluto = resolve(copia, dirname(archivo), d);
  return { absoluto, relativo: relative(copia, absoluto).split(sep).join('/') };
}

/** Quita de README/ARCHITECTURE los enlaces y menciones en código a archivos excluidos. */
function corregirDocumento(texto, excluidos) {
  let t = texto;
  for (const ruta of excluidos) {
    const e = ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const enlace = `\\[[^\\]]*\\]\\(\\s*(?:\\./)?${e}(?:#[^)]*)?\\s*\\)`;
    // "A · [X](x)" o "[X](x) · B": se quita el enlace junto con su separador.
    t = t.replace(new RegExp(`\\s*[·|,]\\s*${enlace}`, 'g'), '');
    t = t.replace(new RegExp(`${enlace}\\s*[·,]\\s*`, 'g'), '');
    // Enlace aislado: se deja solo el texto, sin enlace.
    t = t.replace(new RegExp(enlace, 'g'), (m) => m.replace(/^\[([^\]]*)\].*$/s, '$1').replace(/`/g, ''));
    // Menciones en listas: "`X`, " o ", `X`".
    const nombre = `\`(?:\\./)?${e}\``;
    t = t.replace(new RegExp(`${nombre}\\s*,\\s*`, 'g'), '');
    t = t.replace(new RegExp(`\\s*,\\s*${nombre}`, 'g'), '');
  }
  return t;
}

function cmdAjustar(copia, archivoExcluidos) {
  const excluidos = existsSync(archivoExcluidos) ? leerLista(archivoExcluidos) : [];
  const nombresExcluidos = [...new Set(excluidos.map((r) => basename(r)).filter((n) => n !== '.gitkeep'))];
  const archivos = listarArchivos(copia);
  let avisos = 0;
  const aviso = (msg) => { avisos += 1; console.log(`  AVISO  ${msg}`); };

  // 1) README.md y ARCHITECTURE.md de la raíz: se corrigen en la copia.
  for (const doc of ['README.md', 'ARCHITECTURE.md']) {
    const ruta = join(copia, doc);
    if (!existsSync(ruta)) continue;
    const antes = readFileSync(ruta, 'utf8');
    const despues = corregirDocumento(antes, excluidos);
    if (despues !== antes) {
      writeFileSync(ruta, despues);
      const a = antes.split('\n'); const d = despues.split('\n');
      const cambiadas = a.map((l, i) => (l !== d[i] ? i + 1 : 0)).filter(Boolean);
      console.log(`  CORREGIDO  ${doc} (líneas ${cambiadas.join(', ')}): se quitaron enlaces/menciones a material excluido`);
    }
  }

  // 2) .gitignore: se quitan las entradas que nombran carpetas de herramientas locales (ya no existen en la copia).
  for (const archivo of archivos.filter((a) => basename(a) === '.gitignore')) {
    const ruta = join(copia, archivo);
    const lineas = readFileSync(ruta, 'utf8').split('\n');
    const quitar = new Set();
    lineas.forEach((l, i) => {
      if (!l.startsWith('#') && PALABRAS_HERRAMIENTAS.test(l)) {
        quitar.add(i);
        // Comentario de cabecera que queda huérfano.
        const sigVacio = i + 1 >= lineas.length || lineas[i + 1].trim() === '';
        if (i > 0 && lineas[i - 1].startsWith('#') && sigVacio) quitar.add(i - 1);
        if (i > 1 && quitar.has(i - 1) && lineas[i - 2].trim() === '' && sigVacio) quitar.add(i - 2);
      }
    });
    if (quitar.size) {
      let nuevo = lineas.filter((_, i) => !quitar.has(i)).join('\n');
      if (!nuevo.endsWith('\n')) nuevo += '\n';
      writeFileSync(ruta, nuevo.replace(/\n{3,}$/, '\n'));
      console.log(`  CORREGIDO  ${archivo} (líneas ${[...quitar].map((i) => i + 1).sort((x, y) => x - y).join(', ')}): entrada de carpeta local de herramientas`);
    }
  }

  // 3) Revisión de enlaces relativos y menciones en *.md y *.html de la copia (ya corregida).
  for (const archivo of archivos.filter((a) => /\.(md|html?)$/i.test(a))) {
    const ruta = join(copia, archivo);
    if (!existsSync(ruta)) continue;
    const lineas = readFileSync(ruta, 'utf8').split('\n');
    const esHtml = /\.html?$/i.test(archivo);
    lineas.forEach((linea, i) => {
      const destinos = [];
      if (!esHtml) for (const m of linea.matchAll(RE_ENLACE_MD)) destinos.push(m[2]);
      for (const m of linea.matchAll(RE_ENLACE_HTML)) destinos.push(m[1]);
      for (const destino of destinos) {
        if (esEnlaceExterno(destino)) continue;
        const r = resolverDestino(copia, archivo, destino);
        if (!r) continue;
        if (r.relativo.startsWith('..')) { aviso(`${archivo}:${i + 1}: enlace fuera del proyecto → ${destino}`); continue; }
        if (existsSync(r.absoluto)) continue;
        if (excluidos.includes(r.relativo)) aviso(`${archivo}:${i + 1}: enlace a material excluido → ${destino}`);
        else aviso(`${archivo}:${i + 1}: enlace roto (ya lo estaba en el repositorio) → ${destino}`);
      }
      for (const nombre of nombresExcluidos) {
        if (linea.includes(nombre)) aviso(`${archivo}:${i + 1}: menciona el archivo excluido ${nombre}`);
      }
    });
  }
  console.log(avisos ? `  ${avisos} aviso(s) de enlaces/menciones (no bloquean la entrega; revíselos).` : '  Sin enlaces rotos ni menciones a material excluido.');
  return 0;
}

// ------------------------------------------------------------------ verificar

const RE_RUTAS_LOCALES = /\/home\//;
const PATRONES_SECRETOS = [
  ['token de GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['token de GitHub (fine-grained)', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['token de GitLab', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['token de GitLab (otros)', /\bgl(?:dt|rt|cbt|ptt|ft|imt|agent|oas|soat)-[A-Za-z0-9_-]{20,}/],
  ['llave de acceso AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token de Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];
// Bloque PEM completo con cuerpo base64 real; no coincide con textos de prueba como '-----BEGIN PRIVATE KEY-----...'
// ni con código que genera las llaves en tiempo de ejecución.
const RE_PEM_PRIVADA = /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----\r?\n(?:[A-Za-z-]+: [^\n]*\r?\n|\r?\n)*(?:[A-Za-z0-9+/=]{40,}\r?\n)+[A-Za-z0-9+/=]*\r?\n?-----END \1-----/;
const NOMBRES_SENSIBLES = [
  /(^|\/)\.env$/, /(^|\/)[^/]*\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.(?:pem|key|crt|p12|pfx|jks|keystore|db|db-shm|db-wal|sqlite|sqlite3)$/i,
  /(^|\/)id_(?:rsa|ecdsa|ed25519|dsa)(?:\.pub)?$/, /(^|\/)node_modules\//,
  /(^|\/)\.?venv\//, /(^|\/)__pycache__\//, /\.py[co]$/, /(^|\/)\.pytest_cache\//, /(^|\/)\.ruff_cache\//,
  /(^|\/)dist\//, /\.egg-info\//, /\.enc$/, /^backend\/data\//, /^backend\/certs\//, /(^|\/)\.claude\//,
];

// Títulos de nivel 2 de la plantilla del evento, en orden (el título del proyecto va como "# <título>").
const SECCIONES_README = [
  ['1', 'Participantes'],
  ['2', 'Descripción del proyecto'],
  ['3', 'Alcance'],
  ['4', 'Requerimientos del sistema'],
  ['5', 'Paso a paso de instalación / despliegue'],
];

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function cargarPermitidos(archivo) {
  const permitidos = { marcas: new Set(), rutas: new Set(), secretos: new Set() };
  if (!archivo) return permitidos;
  for (const linea of leerLista(archivo)) {
    const [cat, ...resto] = linea.split(/\s+/);
    const ruta = resto.join(' ');
    if (!permitidos[cat] || !ruta) throw new Error(`Línea no válida en ${archivo}: "${linea}" (formato: marcas|rutas|secretos <ruta>)`);
    permitidos[cat].add(ruta);
  }
  return permitidos;
}

/** Texto de un PDF con pdftotext si está instalado; null si no se puede extraer. */
function textoPdf(ruta) {
  const r = spawnSync('pdftotext', ['-q', ruta, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function recortar(s) {
  const t = s.trim();
  return t.length > 140 ? `${t.slice(0, 137)}...` : t;
}

function cmdVerificar(copia, archivoPermitidos, { sinReadme = false } = {}) {
  const permitidos = cargarPermitidos(archivoPermitidos);
  const archivos = listarArchivos(copia);
  const hallazgos = { marcas: [], rutas: [], secretos: [], nombres: [], tamano: [], readme: [] };
  const permitidosUsados = [];
  let pdfSinTexto = 0;

  const anotar = (cat, archivo, texto) => {
    if (permitidos[cat]?.has(archivo)) permitidosUsados.push(`[${cat}] ${texto}`);
    else hallazgos[cat].push(texto);
  };

  for (const archivo of archivos) {
    const ruta = join(copia, archivo);
    const st = statSync(ruta);
    if (st.size > LIMITE_TAMANO) hallazgos.tamano.push(`${archivo}: ${(st.size / 1048576).toFixed(1)} MB`);
    if (NOMBRES_SENSIBLES.some((re) => re.test(archivo))) hallazgos.nombres.push(archivo);

    const buf = readFileSync(ruta);
    const binario = esBinario(buf) || /\.pdf$/i.test(archivo);
    const fuentes = [];
    if (!binario) fuentes.push(['', buf.toString('utf8')]);
    else {
      fuentes.push([' (bytes)', buf.toString('latin1')]);
      if (/\.pdf$/i.test(archivo)) {
        const t = textoPdf(ruta);
        if (t === null) pdfSinTexto += 1; else fuentes.push([' (texto del PDF)', t]);
      }
    }
    for (const [origen, contenido] of fuentes) {
      const lineas = contenido.split('\n');
      lineas.forEach((linea, i) => {
        const pos = binario && !origen.includes('texto') ? '' : `:${i + 1}`;
        const m = PALABRAS_HERRAMIENTAS.exec(linea);
        if (m) anotar('marcas', archivo, `${archivo}${pos}${origen}: «${m[0]}» en ${recortar(binario && !origen.includes('texto') ? m[0] : linea)}`);
        if (RE_RUTAS_LOCALES.test(linea)) anotar('rutas', archivo, `${archivo}${pos}${origen}: ${recortar(binario && !origen.includes('texto') ? '/home/…' : linea)}`);
        for (const [nombre, re] of PATRONES_SECRETOS) {
          const s = re.exec(linea);
          if (s) anotar('secretos', archivo, `${archivo}${pos}${origen}: ${nombre} (${s[0].slice(0, 8)}…)`);
        }
      });
      const pem = RE_PEM_PRIVADA.exec(contenido);
      if (pem) {
        const linea = contenido.slice(0, pem.index).split('\n').length;
        anotar('secretos', archivo, `${archivo}:${linea}${origen}: bloque PEM de llave privada (${pem[1]})`);
      }
    }
  }

  // README.md: título "# <título>" y los apartados de la plantilla del evento, en orden, como títulos de nivel 2
  // con el texto exacto (sin numeración). Con --sin-readme (etapas intermedias de la subida progresiva) el README
  // aún no se ha incorporado.
  const readme = join(copia, 'README.md');
  if (sinReadme) { /* se comprueba en la etapa que lo incorpora y en la copia completa */ }
  else if (!existsSync(readme)) hallazgos.readme.push('No existe README.md en la raíz.');
  else {
    const lineas = readFileSync(readme, 'utf8').split('\n');
    const primera = lineas.find((l) => l.trim() !== '');
    if (!primera || !/^#\s+\S/.test(primera)) hallazgos.readme.push('README.md:1: debe empezar con el título del proyecto ("# <título>")');
    const titulos = lineas
      .map((l, i) => ({ l, i: i + 1 }))
      .filter(({ l }) => /^##\s+/.test(l) && !/^###/.test(l))
      .map(({ l, i }) => ({ t: sinAcentos(l.replace(/^##\s+/, '').trim()), i }));
    let ultimo = 0;
    for (const [, nombre] of SECCIONES_README) {
      const objetivo = sinAcentos(nombre);
      const h = titulos.find(({ t }) => t === objetivo)
        ?? titulos.find(({ t }) => t.replace(/^\d+[.)]?\s*/, '').startsWith(objetivo));
      if (!h) { hallazgos.readme.push(`Falta el apartado "## ${nombre}"`); continue; }
      if (h.t !== objetivo) hallazgos.readme.push(`README.md:${h.i}: el título debe ser exactamente "## ${nombre}"`);
      if (h.i < ultimo) hallazgos.readme.push(`README.md:${h.i}: "${nombre}" está fuera del orden de la plantilla`);
      ultimo = Math.max(ultimo, h.i);
    }
  }

  const informe = [
    ['marcas', 'Menciones a herramientas externas de generación o coautoría'],
    ['rutas', 'Rutas locales /home/'],
    ['secretos', 'Secretos (tokens, llaves privadas PEM)'],
    ['nombres', 'Archivos sensibles por nombre (.env, llaves, bases, node_modules)'],
    ['tamano', 'Archivos de más de 5 MB'],
    ['readme', 'README.md con el título y los apartados de la plantilla del evento, en orden'],
  ].filter(([cat]) => !(sinReadme && cat === 'readme'));
  let fallos = 0;
  for (const [cat, titulo] of informe) {
    const lista = hallazgos[cat];
    if (!lista.length) { console.log(`  OK     ${titulo}`); continue; }
    fallos += 1;
    console.log(`  FALLA  ${titulo}: ${lista.length} hallazgo(s)`);
    for (const h of lista.slice(0, 40)) console.log(`           - ${h}`);
    if (lista.length > 40) console.log(`           … y ${lista.length - 40} más`);
  }
  if (permitidosUsados.length) {
    console.log(`  NOTA   ${permitidosUsados.length} hallazgo(s) aceptados por la lista de permitidos:`);
    for (const p of permitidosUsados) console.log(`           - ${p}`);
  }
  if (pdfSinTexto) console.log(`  NOTA   ${pdfSinTexto} PDF sin texto extraíble (pdftotext no disponible): solo se revisaron sus bytes; revíselos a mano.`);
  console.log(`  Archivos revisados: ${archivos.length}`);
  return fallos ? 1 : 0;
}

// ------------------------------------------------------------------ env

const PLANTILLAS_OBLIGATORIAS = ['backend/.env.example', 'frontend/.env.example'];
const RE_VARIABLE_SECRETA = /(?:KEY|SECRET|TOKEN|PASSWORD|PASS)$/i;

/** Las plantillas .env.example existen y no traen secretos reales (valores vacíos o CHANGE_ME...). */
function cmdEnv(copia) {
  const problemas = [];
  let variables = 0;
  const plantillas = listarArchivos(copia).filter((a) => basename(a) === '.env.example');
  for (const obligatoria of PLANTILLAS_OBLIGATORIAS) {
    // Solo se exige la plantilla de un componente presente (en una etapa intermedia puede faltar el otro).
    if (!existsSync(join(copia, dirname(obligatoria)))) continue;
    if (!plantillas.includes(obligatoria)) problemas.push(`falta ${obligatoria}`);
  }
  for (const plantilla of plantillas) {
    readFileSync(join(copia, plantilla), 'utf8').split('\n').forEach((linea, i) => {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea);
      if (!m) return;
      variables += 1;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (RE_VARIABLE_SECRETA.test(m[1]) && valor && !/^CHANGE_ME/i.test(valor) && !/^(?:HS|RS|ES)\d{3}$/.test(valor)) {
        problemas.push(`${plantilla}:${i + 1}: ${m[1]} trae un valor que parece real (debe ir vacío o CHANGE_ME)`);
      }
    });
  }
  if (problemas.length) {
    console.log('  FALLA  plantillas .env.example:');
    for (const p of problemas) console.log(`           - ${p}`);
    return 1;
  }
  console.log(`  OK     plantillas .env.example (${plantillas.length} archivos, ${variables} variables, sin secretos reales)`);
  return 0;
}

// ------------------------------------------------------------------ etapas (subida progresiva)

const RE_IDENTIDAD = /^(\S(?:.*\S)?)\s*<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>$/;
const RAMAS_TRABAJO = new Set(['diego', 'javier', 'enggel', 'giovani']);
/** Commits detallados: mínimo de líneas del cuerpo del mensaje de cada etapa. */
const MINIMO_LINEAS_CUERPO = 2;
// Marcadores de autor que se sustituyen por la identidad indicada en la línea de órdenes (el correo real de
// cada persona no está en los commits de GitHub: ver scripts/README-entrega.md, «Autoría»).
const MARCADORES = { AUTOR_JAVIER: '--autor-javier', AUTOR_ENGGEL: '--autor-enggel' };

/**
 * Lee scripts/etapas-entrega.txt. Formato: líneas "clave valor"; cada "etapa <id>" abre una etapa nueva.
 * Claves: etapa, mensaje, autor, rama, cuerpo (repetible), issue, refs, estado, ruta (repetible; admite "!patrón").
 */
function leerEtapas(archivo) {
  const etapas = [];
  const errores = [];
  readFileSync(archivo, 'utf8').split(/\r?\n/).forEach((original, i) => {
    const linea = original.trim();
    if (!linea || linea.startsWith('#')) return;
    const m = /^(\S+)\s+(.+)$/.exec(linea);
    if (!m) { errores.push(`${basename(archivo)}:${i + 1}: línea sin valor: "${linea}"`); return; }
    const [, clave, valor] = m;
    if (clave === 'etapa') { etapas.push({ id: valor, linea: i + 1, rutas: [], cuerpo: [] }); return; }
    const actual = etapas.at(-1);
    if (!actual) { errores.push(`${basename(archivo)}:${i + 1}: "${clave}" antes de la primera "etapa"`); return; }
    if (clave === 'ruta') actual.rutas.push(valor);
    else if (clave === 'cuerpo') actual.cuerpo.push(valor);
    else if (['mensaje', 'autor', 'rama', 'issue', 'refs', 'estado'].includes(clave)) {
      if (actual[clave] !== undefined) errores.push(`${basename(archivo)}:${i + 1}: "${clave}" repetido en la etapa ${actual.id}`);
      actual[clave] = valor;
    } else errores.push(`${basename(archivo)}:${i + 1}: clave desconocida "${clave}"`);
  });
  return { etapas, errores };
}

/**
 * Asigna cada archivo de la copia limpia a la PRIMERA etapa cuyas rutas lo incluyan (dentro de una etapa,
 * la última regla que coincide decide, como en las exclusiones). Escribe en <dirPlan>:
 *   plan.tsv        n, id, rama, nombre, correo, nº de archivos, mensaje (separados por tabulador)
 *   etapa-N.lista   archivos que incorpora la etapa N (uno por línea)
 * Falla si un archivo queda sin etapa, si una etapa queda vacía, si una regla no coincide con nada,
 * si falta un dato o si se incluye algo que las exclusiones prohíben.
 */
function cmdEtapas(copia, archivoEtapas, archivoExclusiones, dirPlan, opciones) {
  const { etapas, errores } = leerEtapas(archivoEtapas);
  const archivos = listarArchivos(copia);
  const exclusiones = cargarExclusiones(archivoExclusiones);
  const ids = new Set();
  const identidades = {};
  for (const [marcador, opcion] of Object.entries(MARCADORES)) {
    const valor = opciones[marcador];
    if (valor === undefined) continue;
    if (!RE_IDENTIDAD.test(valor)) errores.push(`${opcion} no tiene el formato "Nombre Apellido <correo@dominio>": "${valor}"`);
    else identidades[marcador] = valor;
  }
  if (!etapas.length) errores.push(`${basename(archivoEtapas)} no define ninguna etapa`);

  for (const e of etapas) {
    const donde = `etapa ${e.id} (línea ${e.linea})`;
    if (ids.has(e.id)) errores.push(`${donde}: identificador repetido`);
    ids.add(e.id);
    if (e.estado !== undefined && e.estado !== 'espera') errores.push(`${donde}: "estado" solo admite "espera": "${e.estado}"`);
    e.espera = e.estado === 'espera';
    // Una etapa en espera no se confirma: puede no tener autor todavía ni archivos (trabajo futuro).
    for (const clave of e.espera ? ['mensaje', 'rama'] : ['mensaje', 'autor', 'rama']) if (!e[clave]) errores.push(`${donde}: falta "${clave}"`);
    if (e.cuerpo.length < MINIMO_LINEAS_CUERPO) errores.push(`${donde}: el cuerpo del mensaje tiene ${e.cuerpo.length} línea(s); se exigen al menos ${MINIMO_LINEAS_CUERPO} ("cuerpo ..."): qué incluye y qué requisito cubre`);
    for (const clave of ['issue', 'refs']) if (e[clave] !== undefined && !/^\d+(?:[ ,]+\d+)*$/.test(e[clave])) errores.push(`${donde}: "${clave}" debe ser uno o varios números de issue: "${e[clave]}"`);
    if (e.rama && !RAMAS_TRABAJO.has(e.rama)) errores.push(`${donde}: rama "${e.rama}" no es una rama de trabajo (${[...RAMAS_TRABAJO].join(', ')})`);
    const marcador = e.autor in MARCADORES ? e.autor : null;
    if (marcador) {
      if (!identidades[marcador] && opciones[marcador] === undefined) errores.push(`${donde}: el autor es ${marcador}; indíquelo con ${MARCADORES[marcador]} "Nombre Apellido <correo>"`);
      e.autor = identidades[marcador] ?? e.autor;
    }
    const id = RE_IDENTIDAD.exec(e.autor ?? '');
    if (e.autor && !(e.autor in MARCADORES) && !id) errores.push(`${donde}: autor sin formato "Nombre <correo>": "${e.autor}"`);
    if (id) { e.nombre = id[1]; e.correo = id[2]; }
    if (!e.rutas.length && !e.espera) errores.push(`${donde}: no tiene rutas`);
    e.reglas = e.rutas.map((linea) => {
      const negado = linea.startsWith('!');
      return { linea, negado, re: patronARegex(negado ? linea.slice(1) : linea) };
    });
    for (const r of e.reglas) {
      // En una etapa en espera las rutas pueden ser de trabajo que aún no existe.
      if (!e.espera && !archivos.some((a) => r.re.test(a))) errores.push(`${donde}: la ruta "${r.linea}" no coincide con ningún archivo de la copia limpia`);
    }
    e.archivos = [];
  }

  const sinEtapa = [];
  for (const archivo of archivos) {
    if (excluido(archivo, exclusiones)) errores.push(`${archivo}: está en la copia pero las exclusiones lo prohíben`);
    const etapa = etapas.find((e) => excluido(archivo, e.reglas));
    if (etapa) etapa.archivos.push(archivo); else sinEtapa.push(archivo);
  }
  if (sinEtapa.length) errores.push(`${sinEtapa.length} archivo(s) de la copia limpia sin etapa:\n${sinEtapa.map((a) => `      - ${a}`).join('\n')}`);
  for (const e of etapas) if (!e.espera && e.reglas.length && !e.archivos.length) errores.push(`etapa ${e.id}: no incorpora ningún archivo (todo lo toman etapas anteriores)`);

  if (errores.length) {
    for (const e of errores) console.log(`  ERROR  ${e}`);
    return 1;
  }

  const limpiar = (s) => s.replace(/[\t\r\n]+/g, ' ');
  const activas = etapas.filter((e) => !e.espera);
  const enEspera = etapas.filter((e) => e.espera);
  if (!activas.length) { console.log('  ERROR  todas las etapas están en espera'); return 1; }
  mkdirSync(dirPlan, { recursive: true });
  const tsv = activas.map((e, i) => [i + 1, e.id, e.rama, e.nombre, e.correo, e.archivos.length, e.mensaje].map((c) => limpiar(String(c))).join('\t'));
  writeFileSync(join(dirPlan, 'plan.tsv'), `${tsv.join('\n')}\n`);
  // Mensaje completo de cada etapa (título, línea en blanco y cuerpo) y sus issues; el script añade las
  // pruebas ejecutadas y las líneas «Refs #n» / «Closes #n».
  const numeros = (v) => (v ?? '').split(/[ ,]+/).filter(Boolean);
  activas.forEach((e, i) => {
    writeFileSync(join(dirPlan, `etapa-${i + 1}.lista`), `${e.archivos.join('\n')}\n`);
    writeFileSync(join(dirPlan, `etapa-${i + 1}.mensaje`), `${e.mensaje}\n\n${e.cuerpo.join('\n')}\n`);
    writeFileSync(join(dirPlan, `etapa-${i + 1}.issues`),
      [...numeros(e.refs).map((n) => `Refs #${n}`), ...numeros(e.issue).map((n) => `Closes #${n}`)].join('\n') + '\n');
  });
  // Etapas en espera: no se confirman; sus archivos (si los hay) quedan fuera de la subida por ahora.
  writeFileSync(join(dirPlan, 'espera.tsv'), enEspera.map((e) => [e.id, e.rama, e.nombre ? `${e.nombre} <${e.correo}>` : '(sin asignar)',
    e.archivos.length, e.mensaje].map((c) => limpiar(String(c))).join('\t')).join('\n') + (enEspera.length ? '\n' : ''));
  writeFileSync(join(dirPlan, 'espera.lista'), enEspera.flatMap((e) => e.archivos).join('\n') + (enEspera.some((e) => e.archivos.length) ? '\n' : ''));

  const ancho = Math.max(...etapas.map((e) => e.id.length));
  activas.forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${e.id.padEnd(ancho)}  ${e.rama.padEnd(7)}  ${String(e.archivos.length).padStart(4)} arch.  ${e.nombre} <${e.correo}>`);
    console.log(`      ${e.mensaje}`);
  });
  for (const e of enEspera) {
    console.log(`  EN ESPERA ${e.id.padEnd(ancho)}  ${e.rama.padEnd(7)}  ${String(e.archivos.length).padStart(4)} arch.  ${e.nombre ? `${e.nombre} <${e.correo}>` : '(autor sin asignar)'}`);
    console.log(`      ${e.mensaje}`);
  }
  const nEspera = enEspera.reduce((t, e) => t + e.archivos.length, 0);
  console.log(`  Total: ${archivos.length} archivos; ${archivos.length - nEspera} en ${activas.length} etapas a subir`
    + `${enEspera.length ? ` y ${nEspera} en ${enEspera.length} etapa(s) en espera` : ''}; ninguno sin etapa, ninguno excluido.`);
  return 0;
}

/** Copia los archivos de <lista> (rutas relativas, una por línea) de <origen> a <destino>, con sus permisos. */
function cmdCopiar(origen, lista, destino) {
  const rutas = readFileSync(lista, 'utf8').split('\n').filter(Boolean);
  for (const ruta of rutas) {
    const desde = join(origen, ruta);
    const hacia = join(destino, ruta);
    if (!existsSync(desde)) { console.error(`No existe ${desde}`); return 1; }
    mkdirSync(dirname(hacia), { recursive: true });
    copyFileSync(desde, hacia);
    chmodSync(hacia, statSync(desde).mode & 0o777);
  }
  return 0;
}

// ------------------------------------------------------------------ principal

const [cmd, ...resto] = process.argv.slice(2);
const banderas = new Set(resto.filter((a) => a === '--sin-readme'));
const args = resto.filter((a) => !banderas.has(a));
/** Extrae "--opcion valor" de args (para valores que pueden contener espacios). */
function opcionConValor(nombre) {
  const i = args.indexOf(nombre);
  if (i === -1) return undefined;
  const valor = args[i + 1] ?? '';
  args.splice(i, 2);
  return valor;
}
const autores = { AUTOR_JAVIER: opcionConValor('--autor-javier'), AUTOR_ENGGEL: opcionConValor('--autor-enggel') };
const comandos = {
  excluir: () => cmdExcluir(resolve(args[0]), resolve(args[1])),
  ajustar: () => cmdAjustar(resolve(args[0]), resolve(args[1])),
  verificar: () => cmdVerificar(resolve(args[0]), args[1] ? resolve(args[1]) : null, { sinReadme: banderas.has('--sin-readme') }),
  env: () => cmdEnv(resolve(args[0])),
  etapas: () => cmdEtapas(resolve(args[0]), resolve(args[1]), resolve(args[2]), resolve(args[3]), autores),
  copiar: () => cmdCopiar(resolve(args[0]), resolve(args[1]), resolve(args[2])),
};
if (!comandos[cmd] || !args[0]) {
  console.error('Uso: node entrega-herramientas.mjs excluir|ajustar|verificar|env|etapas|copiar <copia> [...]');
  process.exitCode = 2;
} else {
  process.exitCode = comandos[cmd]();
}
