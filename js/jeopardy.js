/*
 * Jeopardy Bioimágenes
 * Celebración de la Jornada de Bioimágenes 2026 · UNPAZ
 * Autor: Mg. Lic. Prof. Leandro Guerschberg
 *
 * Reglas:
 *  - Dos equipos por turnos. El turno pasa al otro equipo después de cada pregunta.
 *  - Correcta: suma el valor. Incorrecta: lo resta. Sin respuesta: no cambia el puntaje.
 *  - Daily Double: el equipo apuesta antes de ver la pregunta.
 *  - Final Jeopardy: ambos equipos apuestan y quien conduce marca cada respuesta.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var CIRC = 2 * Math.PI * 45;
  var CLAVE_CONFIG = "jeopardyBio.config";
  var CLAVE_BANCO = "jeopardyBio.banco";
  var CLAVE_PARTIDA = "jeopardyBio.partida";
  var CLAVE_SONIDO = "jeopardyBio.sonido";
  var CLAVE_ACCESO = "jeopardyBio.configDesbloqueada";
  var CLAVE_CONFIGURACION = "1718*";   // clave "blanda": solo evita cambios accidentales
  var LETRAS = ["A", "B", "C", "D"];
  var COLORES_CAT = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)"];
  var AUTO_MS = 4500;

  var config = Object.assign({ tiempo: 30, dd: 1, final: true, auto: true }, leer(CLAVE_CONFIG, {}));
  var banco = null;          // banco activo para nuevas partidas
  var bancoPropio = false;   // true si fue importado en este navegador
  var partida = null;
  var actual = null;         // pregunta abierta
  var reloj = null;
  var autoContinuar = null;

  /* ---------- Utilidades ---------- */

  function leer(clave, porDefecto) {
    try { var v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto; }
    catch (e) { return porDefecto; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
  }
  function borrar(clave) {
    try { localStorage.removeItem(clave); } catch (e) { /* sin almacenamiento */ }
  }
  function escapar(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatoPuntos(n) { return (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("es-AR"); }
  function aviso(texto, esError) {
    var a = $("aviso");
    a.textContent = texto;
    a.classList.toggle("error", !!esError);
    a.classList.add("visible");
    clearTimeout(aviso.t);
    aviso.t = setTimeout(function () { a.classList.remove("visible"); }, 3500);
  }
  function mostrarPantalla(id) {
    document.querySelectorAll(".pantalla").forEach(function (p) { p.classList.toggle("activa", p.id === id); });
    window.scrollTo(0, 0);
  }
  function nivelDe(pregunta, fila) {
    var n = Number(pregunta.level);
    if (n >= 1 && n <= 3) return n;
    return fila < 2 ? 1 : fila < 4 ? 2 : 3;
  }

  /* ---------- Banco de preguntas ---------- */

  function validarBanco(datos) {
    if (!datos || !Array.isArray(datos.categories) || !datos.categories.length) {
      throw new Error("El archivo no tiene categorías.");
    }
    if (datos.categories.length > 5) throw new Error("El tablero admite hasta 5 categorías.");
    datos.categories.forEach(function (c, i) {
      if (!Array.isArray(c.questions) || !c.questions.length) {
        throw new Error("La categoría " + (i + 1) + " no tiene preguntas.");
      }
      c.questions.forEach(function (q, j) {
        if (!q.prompt || !Array.isArray(q.options) || q.options.length < 2) {
          throw new Error("Revisá la pregunta " + (j + 1) + " de la categoría " + (i + 1) + ".");
        }
        var k = Number(q.correctIndex);
        if (!(k >= 0 && k < q.options.length)) {
          throw new Error("Falta el índice correcto en la pregunta " + (j + 1) + " de la categoría " + (i + 1) + ".");
        }
        q.value = Number(q.value) || (j + 1) * 200;
      });
    });
    return datos;
  }

  function cargarBanco() {
    var propio = leer(CLAVE_BANCO, null);
    if (propio) {
      try {
        banco = validarBanco(propio);
        bancoPropio = true;
        return Promise.resolve();
      } catch (e) { borrar(CLAVE_BANCO); }
    }
    bancoPropio = false;
    return fetch("questions.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { banco = validarBanco(d); })
      .catch(function () {
        banco = null;
        aviso("No se pudo cargar questions.json. Abrí el juego desde el sitio publicado o importá un banco en Configuración.", true);
      });
  }

  function totalPreguntas(b) {
    return b.categories.reduce(function (n, c) { return n + c.questions.length; }, 0);
  }

  function hayFinal(b) {
    return !!(b && b.finalJeopardy && b.finalJeopardy.prompt);
  }

  /* ---------- Pantalla de inicio ---------- */

  function renderInicio() {
    var evento = (banco && banco.event) || "Celebración de la Jornada de Bioimágenes 2026";
    $("titulo-evento").textContent = evento;
    $("evento-barra").textContent = evento;
    $("lista-categorias").innerHTML = banco ? banco.categories.map(function (c, i) {
      return '<li><i style="background:' + COLORES_CAT[i % 5] + '"></i>' + escapar(c.title) + "</li>";
    }).join("") : "<li>Sin banco de preguntas</li>";
    var guardada = leer(CLAVE_PARTIDA, null);
    $("btn-continuar").hidden = !(guardada && guardada.fase !== "fin");
    if (guardada && guardada.equipos) {
      $("nombre-0").value = guardada.equipos[0].nombre;
      $("nombre-1").value = guardada.equipos[1].nombre;
    }
  }

  function nuevaPartida(nombres) {
    if (!banco) { aviso("No hay un banco de preguntas cargado.", true); return; }
    var copia = JSON.parse(JSON.stringify(banco));
    partida = {
      banco: copia,
      equipos: nombres.map(function (n) { return { nombre: n, puntos: 0 }; }),
      turno: 0,
      jugadas: {},
      dd: elegirDailyDoubles(copia, config.dd),
      final: hayFinal(copia) && config.final,
      fase: "tablero",
      finalEstado: null
    };
    guardar();
    Sonidos.reproducir("inicio");
    mostrarPantalla("pantalla-tablero");
    renderTablero();
  }

  function elegirDailyDoubles(b, cantidad) {
    var candidatos = [];
    b.categories.forEach(function (c, ci) {
      c.questions.forEach(function (q, fi) {
        if (fi >= 2 || c.questions.length < 3) candidatos.push(ci + "-" + fi);
      });
    });
    var elegidos = [];
    while (elegidos.length < cantidad && candidatos.length) {
      elegidos.push(candidatos.splice(Math.floor(Math.random() * candidatos.length), 1)[0]);
    }
    return elegidos;
  }

  function guardar() { if (partida) escribir(CLAVE_PARTIDA, partida); }

  /* ---------- Tablero ---------- */

  function renderMarcador(saltoEquipo) {
    $("marcador").innerHTML = partida.equipos.map(function (e, i) {
      var clases = "equipo-puntaje" + (partida.fase === "tablero" && i === partida.turno ? " activo" : "") +
        (i === saltoEquipo ? " salto" : "");
      return '<button type="button" class="' + clases + '" data-equipo="' + i + '" title="Darle el turno a este equipo">' +
        '<span class="nombre">' + escapar(e.nombre) + "</span>" +
        '<span class="puntos' + (e.puntos < 0 ? " negativo" : "") + '">' + formatoPuntos(e.puntos) + "</span></button>";
    }).join("");
  }

  function renderTablero(saltoEquipo) {
    var b = partida.banco;
    var filas = Math.max.apply(null, b.categories.map(function (c) { return c.questions.length; }));
    var t = $("tablero");
    t.style.gridTemplateColumns = "repeat(" + b.categories.length + ", minmax(0, 1fr))";
    t.style.gridTemplateRows = "auto repeat(" + filas + ", 1fr)";
    var html = b.categories.map(function (c, i) {
      return '<div class="cabecera-cat" style="--color-cat:' + COLORES_CAT[i % 5] + '">' + escapar(c.title) + "</div>";
    }).join("");
    for (var f = 0; f < filas; f++) {
      for (var ci = 0; ci < b.categories.length; ci++) {
        var q = b.categories[ci].questions[f];
        if (!q) { html += "<div></div>"; continue; }
        var clave = ci + "-" + f;
        var j = partida.jugadas[clave];
        var nivel = nivelDe(q, f);
        if (j) {
          var simbolo = j.resultado === "ok" ? "✓ " : j.resultado === "mal" ? "✗ " : "⏱ ";
          var clase = j.resultado === "ok" ? "ok" : j.resultado === "mal" ? "mal" : "";
          html += '<button class="casillero nv' + nivel + '" disabled aria-label="Ya jugada">' + q.value +
            '<span class="marca-jugada ' + clase + '">' + simbolo + escapar(partida.equipos[j.equipo].nombre) + "</span></button>";
        } else {
          html += '<button class="casillero nv' + nivel + '" data-clave="' + clave + '" aria-label="' +
            escapar(b.categories[ci].title) + " por " + q.value + '">' + q.value + "</button>";
        }
      }
    }
    t.innerHTML = html;
    renderMarcador(saltoEquipo);
  }

  function tableroCompleto() {
    return Object.keys(partida.jugadas).length >= totalPreguntas(partida.banco);
  }

  function abrirCasillero(clave) {
    if (!partida || partida.fase !== "tablero" || partida.jugadas[clave]) return;
    var partes = clave.split("-").map(Number);
    var q = partida.banco.categories[partes[0]].questions[partes[1]];
    if (partida.dd.indexOf(clave) >= 0) {
      pedirApuestaDD(clave, q);
    } else {
      Sonidos.reproducir("abrir");
      mostrarPregunta({ clave: clave, cat: partes[0], fila: partes[1], q: q, apuesta: null });
    }
  }

  /* ---------- Apuestas ---------- */

  function maximoTablero() {
    var m = 0;
    partida.banco.categories.forEach(function (c) { c.questions.forEach(function (q) { m = Math.max(m, q.value); }); });
    return m;
  }

  function campoApuesta(i, maximo, valor) {
    var e = partida.equipos[i];
    return '<div class="apuesta"><div><strong>' + escapar(e.nombre) + "</strong>" +
      "<small>Puntaje: " + formatoPuntos(e.puntos) + " · Máximo: " + formatoPuntos(maximo) + "</small></div>" +
      '<input type="number" min="0" max="' + maximo + '" step="50" value="' + valor + '" data-equipo="' + i + '" data-max="' + maximo + '"' +
      (maximo === 0 ? " disabled" : "") + ' aria-label="Apuesta de ' + escapar(e.nombre) + '"></div>';
  }

  function pedirApuestaDD(clave, q) {
    Sonidos.reproducir("dailydouble");
    var partes = clave.split("-").map(Number);
    var e = partida.turno;
    var maximo = Math.max(partida.equipos[e].puntos, maximoTablero());
    $("ap-sub").textContent = partida.banco.categories[partes[0]].title + " · " + q.value;
    $("ap-titulo").textContent = "¡Daily Double!";
    $("ap-titulo").classList.add("brillo");
    $("ap-detalle").textContent = "Turno de " + partida.equipos[e].nombre + ". Apuesten antes de ver la pregunta.";
    $("ap-campos").innerHTML = campoApuesta(e, maximo, Math.min(q.value, maximo));
    $("ap-confirmar").textContent = "Confirmar apuesta";
    $("ap-confirmar").onclick = function () {
      var apuesta = leerApuestas()[e];
      if (apuesta === null) return;
      $("capa-apuesta").hidden = true;
      Sonidos.reproducir("apuesta");
      mostrarPregunta({ clave: clave, cat: partes[0], fila: partes[1], q: q, apuesta: apuesta });
    };
    $("capa-apuesta").hidden = false;
    setTimeout(function () { var i = $("ap-campos").querySelector("input"); if (i) i.select(); }, 60);
  }

  function leerApuestas() {
    var r = {};
    var ok = true;
    $("ap-campos").querySelectorAll("input").forEach(function (inp) {
      var max = Number(inp.dataset.max);
      var v = Math.round(Number(inp.value));
      if (inp.disabled) v = 0;
      if (!(v >= 0 && v <= max)) {
        ok = false;
        inp.focus();
        aviso("La apuesta debe estar entre 0 y " + formatoPuntos(max) + ".", true);
      }
      r[inp.dataset.equipo] = v;
    });
    if (!ok) return { 0: null, 1: null };
    return r;
  }

  /* ---------- Pregunta ---------- */

  function mostrarPregunta(p) {
    actual = p;
    actual.respondida = false;
    var esFinal = p.final === true;
    var q = p.q;

    $("pq-categoria").textContent = esFinal ? "Final Jeopardy · " + (q.category || "Pregunta final") : partida.banco.categories[p.cat].title;
    $("pq-valor").textContent = esFinal ? "Apuesta final" : (p.apuesta !== null ? "Apuesta " + formatoPuntos(p.apuesta) : q.value);
    var chip = $("pq-nivel");
    if (esFinal) { chip.textContent = "Final"; chip.className = "chip-nivel dd"; }
    else if (p.apuesta !== null) { chip.textContent = "Daily Double"; chip.className = "chip-nivel dd"; }
    else { chip.textContent = "Nivel " + nivelDe(q, p.fila); chip.className = "chip-nivel"; }

    $("pq-turno").textContent = esFinal ? "Responden ambos equipos" : "Turno de " + partida.equipos[partida.turno].nombre;
    $("pq-texto").textContent = q.prompt;

    var img = $("pq-imagen");
    if (q.image) { img.src = q.image; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }

    $("pq-pista").hidden = true;
    $("pq-pista").textContent = q.hint || "";
    $("pq-btn-pista").hidden = !q.hint;

    $("pq-opciones").innerHTML = q.options.map(function (op, i) {
      return '<button class="opcion" data-i="' + i + '"' + (esFinal ? " disabled" : "") + '><span class="letra-op">' + LETRAS[i] + "</span><span>" + escapar(op) + "</span></button>";
    }).join("");

    $("pq-resultado").hidden = !esFinal;
    $("pq-resultado-texto").textContent = esFinal ? "Cada equipo anota su respuesta. Cuando estén listos, revelen la correcta." : "";
    $("pq-resultado-texto").className = "resultado-texto";
    $("pq-continuar").firstChild.textContent = esFinal ? "Revelar respuesta " : "Continuar ";
    $("pq-barra-auto").classList.remove("corriendo");
    $("pq-barra-auto").hidden = true;
    $("pq-continuar").disabled = false;
    $("pq-juicio").hidden = true;
    $("capa-pregunta").hidden = false;

    iniciarReloj(esFinal ? Math.max(config.tiempo, 60) : config.tiempo);
  }

  function iniciarReloj(segundos) {
    detenerReloj();
    var r = $("pq-reloj");
    r.classList.toggle("oculto", !segundos);
    r.classList.remove("critico");
    if (!segundos) return;
    var total = segundos * 1000;
    var fin = performance.now() + total;
    var ultimo = null;
    function paso() {
      var resta = Math.max(0, fin - performance.now());
      var s = Math.ceil(resta / 1000);
      $("pq-segundos").textContent = s;
      $("pq-aro").style.strokeDashoffset = (CIRC * (1 - resta / total)).toFixed(2);
      r.classList.toggle("critico", s <= 5);
      if (s !== ultimo) { ultimo = s; if (s <= 5 && s > 0) Sonidos.reproducir("tic"); }
      if (resta <= 0) { detenerReloj(); tiempoAgotado(); }
    }
    paso();
    reloj = setInterval(paso, 100);
  }

  function detenerReloj() { if (reloj) clearInterval(reloj); reloj = null; }

  function marcarOpciones(elegida) {
    var correcta = Number(actual.q.correctIndex);
    $("pq-opciones").querySelectorAll(".opcion").forEach(function (b) {
      var i = Number(b.dataset.i);
      b.disabled = true;
      if (i === correcta) b.classList.add("correcta");
      else if (i === elegida) b.classList.add("incorrecta");
      else b.classList.add("apagada");
    });
  }

  function responder(i) {
    if (!actual || actual.respondida || actual.final) return;
    actual.respondida = true;
    detenerReloj();
    var q = actual.q;
    var acierto = i === Number(q.correctIndex);
    var valor = actual.apuesta !== null ? actual.apuesta : q.value;
    var delta = acierto ? valor : -valor;
    var eq = partida.turno;
    partida.equipos[eq].puntos += delta;
    partida.jugadas[actual.clave] = { equipo: eq, resultado: acierto ? "ok" : "mal", delta: delta };
    guardar();
    marcarOpciones(i);
    Sonidos.reproducir(acierto ? "correcta" : "incorrecta");

    var txt = $("pq-resultado-texto");
    if (acierto) {
      txt.textContent = "¡Correcto! +" + formatoPuntos(valor) + " para " + partida.equipos[eq].nombre;
      txt.className = "resultado-texto ok";
    } else {
      txt.textContent = "Incorrecto. −" + formatoPuntos(valor) + ". La respuesta era: " + q.options[q.correctIndex];
      txt.className = "resultado-texto mal";
    }
    mostrarResultado();
  }

  function tiempoAgotado() {
    if (!actual || actual.respondida) return;
    Sonidos.reproducir("tiempo");
    if (actual.final) { revelarFinal(); return; }
    actual.respondida = true;
    var q = actual.q;
    partida.jugadas[actual.clave] = { equipo: partida.turno, resultado: "tiempo", delta: 0 };
    guardar();
    marcarOpciones(-1);
    var txt = $("pq-resultado-texto");
    txt.textContent = "Se acabó el tiempo. La respuesta era: " + q.options[q.correctIndex];
    txt.className = "resultado-texto neutro";
    mostrarResultado();
  }

  function mostrarResultado() {
    $("pq-resultado").hidden = false;
    $("pq-continuar").firstChild.textContent = "Continuar ";
    var barra = $("pq-barra-auto");
    barra.hidden = !config.auto;
    if (config.auto) {
      barra.style.setProperty("--duracion", AUTO_MS + "ms");
      barra.classList.remove("corriendo");
      void barra.offsetWidth;
      barra.classList.add("corriendo");
      clearTimeout(autoContinuar);
      autoContinuar = setTimeout(continuar, AUTO_MS);
    }
    $("pq-continuar").focus();
  }

  function continuar() {
    clearTimeout(autoContinuar);
    if (!actual) return;
    if (actual.final) {
      if (!actual.respondida) { revelarFinal(); return; }
      cerrarFinal();
      return;
    }
    if (!actual.respondida) return;
    var eq = partida.turno;
    $("capa-pregunta").hidden = true;
    actual = null;
    partida.turno = 1 - partida.turno;
    guardar();
    renderTablero(eq);
    if (tableroCompleto()) {
      setTimeout(function () { partida.final ? pedirApuestasFinal() : terminar(); }, 500);
    }
  }

  /* ---------- Final Jeopardy ---------- */

  function pedirApuestasFinal() {
    partida.fase = "final";
    guardar();
    renderMarcador();
    var fj = partida.banco.finalJeopardy;
    Sonidos.reproducir("dailydouble");
    $("ap-sub").textContent = "Final Jeopardy";
    $("ap-titulo").textContent = fj.category || "Pregunta final";
    $("ap-titulo").classList.add("brillo");
    $("ap-detalle").textContent = "Cada equipo apuesta hasta su puntaje actual antes de ver la pregunta.";
    $("ap-campos").innerHTML = partida.equipos.map(function (e, i) {
      var max = Math.max(0, e.puntos);
      return campoApuesta(i, max, Math.round(max / 2 / 50) * 50);
    }).join("");
    $("ap-confirmar").textContent = "Confirmar apuestas";
    $("ap-confirmar").onclick = function () {
      var a = leerApuestas();
      if (a[0] === null) return;
      partida.finalEstado = { apuestas: [a[0], a[1]], juicio: [null, null] };
      guardar();
      $("capa-apuesta").hidden = true;
      Sonidos.reproducir("apuesta");
      mostrarPregunta({ final: true, q: fj, apuesta: null });
    };
    $("capa-apuesta").hidden = false;
  }

  function revelarFinal() {
    detenerReloj();
    actual.respondida = true;
    marcarOpciones(-1);
    var q = actual.q;
    $("pq-resultado-texto").textContent = "Respuesta correcta: " + q.options[q.correctIndex];
    $("pq-resultado-texto").className = "resultado-texto ok";
    $("pq-continuar").firstChild.textContent = "Ver resultados ";
    $("pq-continuar").disabled = true;
    $("pq-barra-auto").hidden = true;
    var est = partida.finalEstado;
    $("pq-juicio").innerHTML = partida.equipos.map(function (e, i) {
      return '<div class="juicio-equipo"><h3>' + escapar(e.nombre) + "</h3><p>Apostó " + formatoPuntos(est.apuestas[i]) + "</p>" +
        '<div class="botones"><button class="btn btn-secundario btn-chico" data-equipo="' + i + '" data-ok="1">✓ Correcta</button>' +
        '<button class="btn btn-secundario btn-chico" data-equipo="' + i + '" data-ok="0">✗ Incorrecta</button></div></div>';
    }).join("");
    $("pq-juicio").hidden = false;
  }

  function juzgarFinal(e) {
    var b = e.target.closest("button[data-equipo]");
    if (!b) return;
    var i = Number(b.dataset.equipo);
    var ok = b.dataset.ok === "1";
    partida.finalEstado.juicio[i] = ok;
    b.parentNode.querySelectorAll("button").forEach(function (x) { x.classList.remove("elegido-ok", "elegido-mal"); });
    b.classList.add(ok ? "elegido-ok" : "elegido-mal");
    Sonidos.reproducir(ok ? "correcta" : "incorrecta");
    guardar();
    $("pq-continuar").disabled = partida.finalEstado.juicio.indexOf(null) >= 0;
  }

  function cerrarFinal() {
    var est = partida.finalEstado;
    if (!est || est.juicio.indexOf(null) >= 0) return;
    est.juicio.forEach(function (ok, i) {
      partida.equipos[i].puntos += ok ? est.apuestas[i] : -est.apuestas[i];
    });
    $("pq-continuar").disabled = false;
    $("capa-pregunta").hidden = true;
    actual = null;
    terminar();
  }

  /* ---------- Fin del juego ---------- */

  function terminar() {
    detenerReloj();
    partida.fase = "fin";
    guardar();
    renderTablero();
    var a = partida.equipos[0].puntos, b = partida.equipos[1].puntos;
    var g = a === b ? -1 : (a > b ? 0 : 1);
    $("final-titulo").textContent = g === -1 ? "¡Empate!" : "¡Gana " + partida.equipos[g].nombre + "!";
    $("tabla-final").innerHTML = partida.equipos.map(function (e, i) {
      var correctas = 0, incorrectas = 0;
      Object.keys(partida.jugadas).forEach(function (k) {
        var j = partida.jugadas[k];
        if (j.equipo !== i) return;
        if (j.resultado === "ok") correctas++; else if (j.resultado === "mal") incorrectas++;
      });
      return '<div class="resultado-equipo' + (i === g ? " ganador" : "") + '"><h3>' + escapar(e.nombre) + "</h3>" +
        '<div class="puntaje-final">' + formatoPuntos(e.puntos) + "</div>" +
        '<div class="cifras"><div class="cifra ok"><b>' + correctas + "</b><small>Correctas</small></div>" +
        '<div class="cifra mal"><b>' + incorrectas + "</b><small>Incorrectas</small></div></div></div>";
    }).join("");
    $("capa-final").hidden = false;
    Sonidos.reproducir("fin");
    setTimeout(function () { Sonidos.reproducir("aplausos"); }, 500);
    confeti();
  }

  function confeti() {
    var cont = document.createElement("div");
    cont.className = "confeti";
    var colores = ["#4fd1ff", "#5af09a", "#ffe066", "#ff6b7d", "#a99bff", "#ffffff"];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colores[i % colores.length];
      p.style.animationDuration = (2.2 + Math.random() * 2) + "s";
      p.style.animationDelay = Math.random() * 0.8 + "s";
      p.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      cont.appendChild(p);
    }
    document.body.appendChild(cont);
    setTimeout(function () { cont.remove(); }, 5200);
  }

  /* ---------- Configuración ---------- */

  function abrirConfig() {
    var desbloqueada = false;
    try { desbloqueada = sessionStorage.getItem(CLAVE_ACCESO) === "1"; } catch (e) { /* sin almacenamiento */ }
    if (!desbloqueada) {
      var clave = prompt("Ingresá la contraseña para acceder a la configuración");
      if (clave === null) return;
      if (clave !== CLAVE_CONFIGURACION) { aviso("Contraseña incorrecta.", true); return; }
      try { sessionStorage.setItem(CLAVE_ACCESO, "1"); } catch (e) { /* sin almacenamiento */ }
    }
    $("cfg-tiempo").value = String(config.tiempo);
    $("cfg-dd").value = String(config.dd);
    $("cfg-final").checked = !!config.final;
    $("cfg-auto").checked = !!config.auto;
    actualizarEstadoBanco();
    $("capa-config").hidden = false;
  }

  function actualizarEstadoBanco() {
    if (!banco) { $("cfg-banco-estado").textContent = "No hay banco cargado."; return; }
    $("cfg-banco-estado").textContent = (bancoPropio
      ? "Usando un banco importado en este navegador"
      : "Usando el banco publicado (questions.json)") +
      ": " + banco.categories.length + " categorías, " + totalPreguntas(banco) + " preguntas" +
      (hayFinal(banco) ? " y Final Jeopardy." : ".") +
      " Los cambios de banco se aplican al empezar una partida nueva.";
    $("cfg-restaurar").hidden = !bancoPropio;
  }

  function guardarConfig(e) {
    e.preventDefault();
    config = {
      tiempo: Number($("cfg-tiempo").value),
      dd: Number($("cfg-dd").value),
      final: $("cfg-final").checked,
      auto: $("cfg-auto").checked
    };
    escribir(CLAVE_CONFIG, config);
    if (partida && partida.fase === "tablero") partida.final = hayFinal(partida.banco) && config.final;
    guardar();
    $("capa-config").hidden = true;
    aviso("Configuración guardada");
  }

  function importarBanco(archivo) {
    var lector = new FileReader();
    lector.onload = function () {
      try {
        var datos = validarBanco(JSON.parse(lector.result));
        escribir(CLAVE_BANCO, datos);
        banco = datos;
        bancoPropio = true;
        actualizarEstadoBanco();
        renderInicio();
        aviso("Banco importado: " + totalPreguntas(datos) + " preguntas.");
      } catch (err) {
        aviso(err.message && err.message.indexOf("JSON") < 0 ? err.message : "El archivo no es un JSON válido.", true);
      }
    };
    lector.readAsText(archivo, "UTF-8");
  }

  function exportarBanco() {
    if (!banco) return;
    var blob = new Blob([JSON.stringify(banco, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "questions.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- Varios ---------- */

  function pantallaCompleta() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  function alternarSonido() {
    var activo = Sonidos.alternar();
    escribir(CLAVE_SONIDO, activo);
    $("btn-sonido").classList.toggle("silenciado", !activo);
    aviso(activo ? "Sonido activado" : "Sonido silenciado");
  }

  function irAlInicio() {
    detenerReloj();
    clearTimeout(autoContinuar);
    ["capa-pregunta", "capa-apuesta", "capa-final"].forEach(function (id) { $(id).hidden = true; });
    actual = null;
    renderInicio();
    mostrarPantalla("pantalla-inicio");
  }

  function reanudar() {
    var guardada = leer(CLAVE_PARTIDA, null);
    if (!guardada) return;
    partida = guardada;
    mostrarPantalla("pantalla-tablero");
    renderTablero();
    if (partida.fase === "final" || (partida.fase === "tablero" && tableroCompleto())) {
      partida.final ? pedirApuestasFinal() : terminar();
    }
  }

  function teclado(e) {
    var t = e.target;
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
      if (e.key === "Enter" && !$("capa-apuesta").hidden) { e.preventDefault(); $("ap-confirmar").click(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();

    if (e.key === "Escape") {
      $("capa-ayuda").hidden = true;
      $("capa-config").hidden = true;
      return;
    }
    if (!$("capa-pregunta").hidden) {
      var idx = ["1", "2", "3", "4"].indexOf(k);
      if (idx < 0) idx = ["a", "b", "c", "d"].indexOf(k);
      if (idx >= 0 && actual && idx < actual.q.options.length) { e.preventDefault(); responder(idx); return; }
      if (k === "h") { $("pq-btn-pista").click(); return; }
      if (e.key === "Enter") { e.preventDefault(); if (!$("pq-continuar").disabled) continuar(); return; }
    }
    if (k === "f") pantallaCompleta();
    else if (k === "s" && $("pantalla-tablero").classList.contains("activa")) alternarSonido();
  }

  function enlazar() {
    $("form-inicio").addEventListener("submit", function (e) {
      e.preventDefault();
      var guardada = leer(CLAVE_PARTIDA, null);
      if (guardada && guardada.fase !== "fin" &&
          !confirm("Hay una partida sin terminar. ¿Empezar una nueva de todos modos?")) return;
      nuevaPartida([
        $("nombre-0").value.trim() || "Equipo 1",
        $("nombre-1").value.trim() || "Equipo 2"
      ]);
    });
    $("btn-continuar").addEventListener("click", reanudar);
    $("btn-ayuda").addEventListener("click", function () { $("capa-ayuda").hidden = false; });
    $("btn-cerrar-ayuda").addEventListener("click", function () { $("capa-ayuda").hidden = true; });
    $("btn-config-inicio").addEventListener("click", abrirConfig);
    $("btn-config").addEventListener("click", abrirConfig);
    $("cfg-cancelar").addEventListener("click", function () { $("capa-config").hidden = true; });
    $("form-config").addEventListener("submit", guardarConfig);
    $("cfg-importar").addEventListener("change", function () {
      if (this.files && this.files[0]) importarBanco(this.files[0]);
      this.value = "";
    });
    $("cfg-exportar").addEventListener("click", exportarBanco);
    $("cfg-restaurar").addEventListener("click", function () {
      borrar(CLAVE_BANCO);
      cargarBanco().then(function () { actualizarEstadoBanco(); renderInicio(); aviso("Se usa el banco publicado."); });
    });

    $("tablero").addEventListener("click", function (e) {
      var c = e.target.closest(".casillero[data-clave]");
      if (c) abrirCasillero(c.dataset.clave);
    });
    $("marcador").addEventListener("click", function (e) {
      var b = e.target.closest(".equipo-puntaje");
      if (!b || !partida || partida.fase !== "tablero") return;
      partida.turno = Number(b.dataset.equipo);
      guardar();
      renderMarcador();
      aviso("Turno de " + partida.equipos[partida.turno].nombre);
    });
    $("pq-opciones").addEventListener("click", function (e) {
      var b = e.target.closest(".opcion");
      if (b && !b.disabled) responder(Number(b.dataset.i));
    });
    $("pq-btn-pista").addEventListener("click", function () {
      $("pq-pista").hidden = !$("pq-pista").hidden;
    });
    $("pq-continuar").addEventListener("click", continuar);
    $("pq-juicio").addEventListener("click", juzgarFinal);

    $("btn-sonido").addEventListener("click", alternarSonido);
    $("btn-pantalla").addEventListener("click", pantallaCompleta);
    $("btn-salir").addEventListener("click", irAlInicio);
    $("btn-terminar").addEventListener("click", function () {
      if (confirm("¿Terminar el juego ahora y ver los resultados?")) terminar();
    });
    $("btn-ver-tablero").addEventListener("click", function () { $("capa-final").hidden = true; });
    $("btn-nuevo").addEventListener("click", function () {
      $("capa-final").hidden = true;
      nuevaPartida(partida.equipos.map(function (e) { return e.nombre; }));
    });
    $("btn-inicio-final").addEventListener("click", irAlInicio);
    document.addEventListener("keydown", teclado);
  }

  function iniciar() {
    var sonido = leer(CLAVE_SONIDO, true);
    Sonidos.fijar(sonido);
    $("btn-sonido").classList.toggle("silenciado", !sonido);
    enlazar();
    cargarBanco().then(renderInicio);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
