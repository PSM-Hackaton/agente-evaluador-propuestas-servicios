# Sistema de diseño — Agente Evaluador

Guía visual adaptada del estándar de diseño institucional acordado en [#57](https://github.com/PSM-Hackaton/agente-evaluador-propuestas-servicios/issues/57). Esta guía es la referencia para nuevas vistas y cambios visuales del frontend.

## Adaptación al proyecto

Se conserva React 18, TypeScript, Vite y Tailwind CSS, que ya forman parte del producto. No se agregan dependencias ni recursos externos: se usan la pila tipográfica del sistema, los iconos Lucide ya instalados y el activo local `public/bandera.svg`. Los tokens CSS se exponen a las utilidades existentes de Tailwind para migrar vistas de forma incremental, sin reescribir la aplicación como JavaScript Vanilla.

## Identidad y tokens

- **Institucional:** franja tricolor de 5 px y cintillo con bandera `27 × 18 px`, nombre de la República y del servicio.
- **Acento:** azul bandera `#00247D`; azul de acción `#1A3A8F`; hover `#0B2A6F`; amarillo `#FFCC00` reservado para indicadores sobre navegación azul.
- **Claro:** lienzo `#F2F4F8`, superficies `#FFFFFF` / `#F7F8FB`, texto `#141B2D`, bordes `#DCE1EA`.
- **Oscuro:** lienzo `#0C1120`, superficies `#141A2B` / `#182033`, texto `#E8EBF3`, bordes `#283249`.
- **Estados:** éxito `#12704F`, aviso `#8A5300`, peligro `#B42318` e información `#2C5A78`, cada uno acompañado por fondo y borde semánticos.
- **Tipografía:** `system-ui` y pila mono local. Los valores numéricos usan cifras tabulares.
- **Geometría:** radio compacto `6 px`, tarjetas `10 px`, modales `14 px`, sidebar `248 px`, topbar `60 px` y controles táctiles de `48 px` en móvil.

Los valores canónicos y sus equivalentes RGB están definidos en `src/index.css`; `tailwind.config.js` conecta las utilidades `slate`, `indigo` y de estado a esos tokens. No introduzcas colores hexadecimales directamente en componentes: agrega o reutiliza un token.

## Estructura y componentes

- `InstitutionalHeader` comparte el skip-link institucional, bandera, franja tricolor y el selector de tema entre acceso y consola.
- `AppLayout` mantiene la navegación del producto, con sidebar de `248 px`, indicador activo amarillo, drawer móvil y topbar sticky.
- `Button`, `Card`, `Alert`, `Badge`, `Modal` y `EmptyState` son las primitivas comunes; el modal usa `<dialog>.showModal()` para el top layer y el manejo nativo del foco.
- Mantén la convención y los componentes existentes; reserva clases Tailwind arbitrarias para valores de layout, no para colores que deban ser tokens.
- Los errores incluyen texto, no solo color; los iconos decorativos llevan `aria-hidden="true"`.

## Tema, responsive y accesibilidad

- El tema inicial respeta `prefers-color-scheme`; el control en el cintillo permite fijar claro u oscuro y guarda la selección como `aeps.tema`.
- Usa layout de consola: sidebar fija en escritorio y drawer bajo `lg`; contenido fluido, sin desbordamiento horizontal en móvil.
- Conserva el enlace “Saltar al contenido principal”, `main#contenido`, labels asociados, `aria-expanded`/`aria-pressed` y navegación por teclado.
- `Escape` cierra el drawer y devuelve el foco al botón que lo abrió; los modales nativos atrapan y restauran el foco.
- `:focus-visible` usa el acento con contraste; amarillo solo sobre superficies azules.
- Se respetan `prefers-reduced-motion`, `forced-colors` y `@media print`; navegación y acciones no necesarias se ocultan al imprimir.
- No renderices contenido de usuarios o del backend mediante `innerHTML`; utiliza JSX escapado y nodos React.

## Probar visualmente

Desde `frontend/`:

```bash
npm ci
npm run dev
```

Abre la URL que imprime Vite (normalmente `http://localhost:5173`). Para la demo local, selecciona una cuenta en la pantalla de acceso; la clave está indicada en la misma pantalla. Comprueba:

1. Tema claro/oscuro con el control del cintillo y persistencia tras recargar.
2. Escritorio ancho y viewport móvil (320–390 px): cintillo, drawer, tablas, formularios y controles sin scroll horizontal.
3. Teclado: `Tab` hasta el skip-link, navegación, apertura/cierre del drawer con `Escape`, y modal BCV con foco confinado/restaurado.
4. Preferencia de movimiento reducido, emulación de alto contraste/forced colors y vista previa de impresión.

Validación automatizada desde `frontend/`: `npm run lint && npm run typecheck && npm test && npm run build`.

## Alcance de la auditoría visual aplicada

La base común, navegación, pantalla de acceso, modales y tokens de estados están conectados a los temas institucionales. Las vistas de negocio heredan colores y tipografía por Tailwind para no duplicar estilos; al tocar una vista existente, revisa visualmente que las tablas densas, banners, gráficas SVG y combinaciones semánticas mantengan contraste en ambos temas. No agregues dependencias, fuentes remotas ni estilos en línea.
