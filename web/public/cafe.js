// Botón flotante de "Invítame a un café".
// En el ordenador, una pastilla abajo a la derecha con su ✕. En el móvil, una taza redonda que se puede
// arrastrar: si se lanza fuera de la pantalla, se va (y vuelve a los 5 minutos); si no, vuelve a su sitio con un rebote.

const ENLACE = 'https://ko-fi.com/rauljimenezz';
// Formulario de Ko-fi para incrustar: se paga sin salir de la web (PayPal abre su propia ventanita).
const INCRUSTADO = `${ENLACE}/?hidefeed=true&widget=true&embed=true&preview=true`;
const CLAVE = 'cafe-fuera';
const VUELVE_EN = { lanzado: 5 * 60 * 1000, cerrado: 30 * 24 * 3600 * 1000 }; // móvil (lanzado) / ordenador (✕)
const APARECE_TRAS = 5000; // ms: que no compita con la carga de la página
const TAZA = `<svg class="cafe-taza" viewBox="0 0 24 24" aria-hidden="true">
  <path class="cafe-vapor" d="M7 2.5c-.6.8-.6 1.7 0 2.5M11 2.5c-.6.8-.6 1.7 0 2.5M15 2.5c-.6.8-.6 1.7 0 2.5"/>
  <path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M3 22h15"/></svg>`;

const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const movil = () => matchMedia('(max-width: 700px), (pointer: coarse)').matches;

// En localStorage se guarda hasta cuándo no debe salir.
function fuera() {
  try { return Date.now() < Number(localStorage.getItem(CLAVE) || 0); } catch { return false; }
}
function despedir(durante) {
  try { localStorage.setItem(CLAVE, String(Date.now() + durante)); } catch {}
}
function pistaVista() {
  try { return localStorage.getItem('cafe-pista') === '1'; } catch { return false; }
}

// Ventana con el formulario de Ko-fi. El iframe solo se carga al abrirla: hasta entonces, nada de Ko-fi en la página.
let ventana = null;
function abrirVentana() {
  if (!ventana) {
    ventana = document.createElement('dialog');
    ventana.className = 'cafe-ventana';
    ventana.setAttribute('aria-label', 'Invítame a un café');
    ventana.innerHTML = `
      <div class="cafe-ventana-cab">
        <strong>${TAZA} Invítame a un café</strong>
        <button type="button" class="boton-cerrar" aria-label="Cerrar">×</button>
      </div>
      <div class="cafe-ventana-cuerpo"><p class="cafe-cargando">Cargando Ko-fi…</p></div>
      <p class="cafe-ventana-pie">Pago seguro con Ko-fi (PayPal o tarjeta). ¿No carga? <a href="${ENLACE}" target="_blank" rel="noopener">Ábrelo en Ko-fi</a>.</p>`;
    document.body.append(ventana);
    ventana.querySelector('.boton-cerrar').addEventListener('click', () => ventana.close());
    // Tocar fuera de la ventana la cierra.
    ventana.addEventListener('click', (e) => { if (e.target === ventana) ventana.close(); });
    const marco = document.createElement('iframe');
    marco.title = 'Invítame a un café en Ko-fi';
    marco.src = INCRUSTADO;
    marco.addEventListener('load', () => ventana.querySelector('.cafe-cargando')?.remove());
    ventana.querySelector('.cafe-ventana-cuerpo').append(marco);
  }
  ventana.showModal();
}

export function prepararCafe() {
  if (fuera()) return;
  const caja = document.createElement('div');
  caja.className = 'cafe';
  caja.innerHTML = `
    <a class="cafe-boton" href="${ENLACE}" target="_blank" rel="noopener" aria-label="Invítame a un café (Ko-fi)" draggable="false">
      ${TAZA}<span class="cafe-texto">Invítame a un café</span></a>
    <button type="button" class="cafe-cerrar" aria-label="Quitar el botón del café">×</button>
    <span class="cafe-pista" aria-hidden="true">Lánzame fuera si molesto</span>`;
  document.body.append(caja);
  setTimeout(() => caja.classList.add('visible'), APARECE_TRAS);

  const irse = (dx, dy, durante) => {
    despedir(durante);
    // Si sigue aquí cuando toca, vuelve a aparecer sin recargar.
    if (durante < 3600 * 1000) setTimeout(prepararCafe, durante + 500);
    caja.style.setProperty('--x', `${dx}px`);
    caja.style.setProperty('--y', `${dy}px`);
    caja.classList.add('saliendo');
    setTimeout(() => caja.remove(), quieto() ? 0 : 450);
  };
  caja.querySelector('.cafe-cerrar').addEventListener('click', () => irse(0, 120, VUELVE_EN.cerrado));

  // ---- Móvil: arrastrar y lanzar ----
  const boton = caja.querySelector('.cafe-boton');
  let inicio = null; // { x, y, t }
  let ultimo = null; // para la velocidad del lanzamiento
  let movido = false;

  boton.addEventListener('pointerdown', (e) => {
    if (!movil()) return;
    inicio = ultimo = { x: e.clientX, y: e.clientY, t: performance.now() };
    movido = false;
    boton.setPointerCapture(e.pointerId);
    caja.classList.add('arrastrando');
    caja.classList.remove('con-pista');
  });
  boton.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x, dy = e.clientY - inicio.y;
    if (Math.hypot(dx, dy) > 6) movido = true;
    caja.style.setProperty('--x', `${dx}px`);
    caja.style.setProperty('--y', `${dy}px`);
    caja.style.setProperty('--giro', `${dx / 6}deg`);
    ultimo = { x: e.clientX, y: e.clientY, t: performance.now(), vx: (e.clientX - ultimo.x) / Math.max(1, performance.now() - ultimo.t), vy: (e.clientY - ultimo.y) / Math.max(1, performance.now() - ultimo.t) };
  });
  const soltar = (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x, dy = e.clientY - inicio.y;
    const r = boton.getBoundingClientRect();
    const rapido = Math.hypot(ultimo.vx ?? 0, ultimo.vy ?? 0) > 0.8; // px/ms: un lanzamiento
    const casiFuera = r.left > innerWidth - r.width * 0.4 || r.top > innerHeight - r.height * 0.4 || r.right < r.width * 0.4;
    inicio = null;
    caja.classList.remove('arrastrando');
    if (movido && (rapido || casiFuera)) {
      // Sale volando en la dirección del gesto.
      const vx = ultimo.vx ?? dx, vy = ultimo.vy ?? dy;
      const n = Math.hypot(vx, vy) || 1;
      irse(dx + (vx / n) * innerWidth, dy + (vy / n) * innerWidth, VUELVE_EN.lanzado);
    } else {
      // Vuelve a su sitio con un rebote.
      caja.style.setProperty('--x', '0px');
      caja.style.setProperty('--y', '0px');
      caja.style.setProperty('--giro', '0deg');
    }
  };
  boton.addEventListener('pointerup', soltar);
  boton.addEventListener('pointercancel', soltar);
  // Si se ha arrastrado, no es un toque: no abre nada. Si es un toque, abre Ko-fi dentro de la web
  // (el enlace normal queda para quien abra en otra pestaña con Ctrl/rueda o sin JavaScript).
  boton.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    if (movido) {
      movido = false;
      return;
    }
    abrirVentana();
  });

  // En el móvil, la primera vez, una pista de que se puede quitar.
  if (movil() && !pistaVista()) {
    try { localStorage.setItem('cafe-pista', '1'); } catch {}
    setTimeout(() => caja.classList.add('con-pista'), APARECE_TRAS + 900);
    setTimeout(() => caja.classList.remove('con-pista'), APARECE_TRAS + 5500);
  }
}
