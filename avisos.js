/* JaviTrader — Avisos por Web Push (frontend)
   Gestiona: permiso del navegador, suscripción, y las categorías que el
   usuario elige recibir. El envío real lo hace el Worker de Cloudflare.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  // ====== CONFIGURACIÓN ======
  // VAPID pública (par generado para JaviTrader). La privada vive solo en el Worker.
  var VAPID_PUBLIC_KEY = 'BACfEkT2OaDS0BPLBViSrIx1pa07QZEeII2Uwy3KQkAbpG4_z7e39Sb7rMgj5ni0BekKEHafccgg3hnLKeJbHU8';

  // URL del Worker de Cloudflare (desplegado en F2).
  var WORKER_URL = 'https://avisos.javitrader.net';

  // Categorías que el usuario puede elegir (deben coincidir con las del Worker).
  var TOPICS = [
    { id: 'novedades', icon: 'ti-sparkles',   label: 'Novedades de la web',   desc: 'Secciones nuevas y cambios importantes.' },
    { id: 'comunidad', icon: 'ti-speakerphone', label: 'Avisos de la comunidad', desc: 'Comunicados generales de la comunidad.' },
    { id: 'macro',     icon: 'ti-chart-line',  label: 'Macro y datos económicos', desc: 'Datos relevantes que conviene revisar.' },
    { id: 'formacion', icon: 'ti-school',      label: 'Formación',             desc: 'Nuevas lecciones y módulos del curso.' }
  ];

  var LS_TOPICS = 'jt_avisos_topics';   // categorías elegidas (persistencia UI)
  var DEFAULT_TOPICS = TOPICS.map(function (t) { return t.id; }); // por defecto, todas

  // ====== UTILIDADES ======
  function urlB64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function getSavedTopics() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_TOPICS));
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return DEFAULT_TOPICS.slice();
  }
  function saveTopics(list) {
    try { localStorage.setItem(LS_TOPICS, JSON.stringify(list)); } catch (e) {}
  }
  function supported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  }

  // ====== ESTADO ======
  var swReg = null;

  async function ensureSW() {
    if (swReg) return swReg;
    swReg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return swReg;
  }

  async function getSubscription() {
    var reg = await ensureSW();
    return reg.pushManager.getSubscription();
  }

  async function subscribeAndSend(topics) {
    if (!WORKER_URL) throw new Error('CONFIG_PENDIENTE');
    var reg = await ensureSW();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await fetch(WORKER_URL.replace(/\/$/, '') + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), topics: topics })
    });
    return sub;
  }

  async function updateTopics(topics) {
    // Reenvía la suscripción actual con las nuevas categorías (upsert en el Worker)
    return subscribeAndSend(topics);
  }

  async function disable() {
    var sub = await getSubscription();
    if (sub) {
      if (WORKER_URL) {
        try {
          await fetch(WORKER_URL.replace(/\/$/, '') + '/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint })
          });
        } catch (e) {}
      }
      await sub.unsubscribe();
    }
  }

  // ====== UI ======
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };

  function buildPanel() {
    var chosen = getSavedTopics();
    var rows = TOPICS.map(function (t) {
      var on = chosen.indexOf(t.id) !== -1 ? 'checked' : '';
      return '' +
        '<label class="av-topic">' +
          '<span class="av-topic-ic"><i class="ti ' + t.icon + '"></i></span>' +
          '<span class="av-topic-txt"><span class="av-topic-title">' + t.label + '</span>' +
          '<span class="av-topic-desc">' + t.desc + '</span></span>' +
          '<input type="checkbox" class="av-check" data-topic="' + t.id + '" ' + on + '>' +
          '<span class="av-switch"></span>' +
        '</label>';
    }).join('');

    var html = '' +
      '<div class="av-overlay" id="av-overlay" hidden>' +
        '<div class="av-panel" role="dialog" aria-modal="true" aria-label="Avisos">' +
          '<div class="av-head">' +
            '<span class="label">Avisos</span>' +
            '<button class="av-close" id="av-close" aria-label="Cerrar"><i class="ti ti-x"></i></button>' +
          '</div>' +
          '<h3 class="serif av-title">Elija qué quiere recibir</h3>' +
          '<p class="av-intro">Reciba un aviso en este dispositivo cuando haya algo relevante. ' +
            'Usted decide las categorías y puede desactivarlas cuando quiera.</p>' +
          '<div class="av-topics">' + rows + '</div>' +
          '<div class="av-actions">' +
            '<button class="btn btn-gold" id="av-primary">Activar avisos</button>' +
            '<button class="btn btn-ghost" id="av-disable" hidden>Desactivar</button>' +
          '</div>' +
          '<p class="av-note" id="av-note"></p>' +
        '</div>' +
      '</div>';

    var tpl = document.createElement('div');
    tpl.innerHTML = html;
    document.body.appendChild(tpl.firstChild);
  }

  function selectedTopics() {
    var out = [];
    var checks = document.querySelectorAll('.av-check');
    for (var i = 0; i < checks.length; i++) if (checks[i].checked) out.push(checks[i].getAttribute('data-topic'));
    return out;
  }

  function setNote(msg, kind) {
    var n = $('#av-note');
    if (!n) return;
    n.textContent = msg || '';
    n.className = 'av-note' + (kind ? ' ' + kind : '');
  }

  async function refreshState() {
    var primary = $('#av-primary');
    var disableBtn = $('#av-disable');
    if (!supported()) {
      primary.disabled = true;
      setNote('Su navegador no admite notificaciones push.', 'warn');
      return;
    }
    if (Notification.permission === 'denied') {
      primary.disabled = true;
      setNote('Ha bloqueado las notificaciones para este sitio. Actívelas en los ajustes del navegador.', 'warn');
    }
    var sub = null;
    try { sub = await getSubscription(); } catch (e) {}
    if (sub) {
      primary.textContent = 'Guardar cambios';
      disableBtn.hidden = false;
      setNote('Avisos activados en este dispositivo.', 'ok');
    } else {
      primary.textContent = 'Activar avisos';
      disableBtn.hidden = true;
    }
  }

  function openPanel() {
    $('#av-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    refreshState();
  }
  function closePanel() {
    $('#av-overlay').hidden = true;
    document.body.style.overflow = '';
  }

  async function onPrimary() {
    var primary = $('#av-primary');
    var topics = selectedTopics();
    if (topics.length === 0) { setNote('Seleccione al menos una categoría.', 'warn'); return; }
    saveTopics(topics);
    primary.disabled = true;
    setNote('Procesando…');
    try {
      var perm = Notification.permission;
      if (perm !== 'granted') {
        perm = await Notification.requestPermission();
        if (perm !== 'granted') { setNote('Permiso no concedido.', 'warn'); primary.disabled = false; return; }
      }
      await subscribeAndSend(topics);
      setNote('Listo. Recibirá avisos de las categorías elegidas.', 'ok');
      refreshState();
    } catch (e) {
      if (e && e.message === 'CONFIG_PENDIENTE') {
        setNote('El servicio de avisos aún no está activo (pendiente de despliegue).', 'warn');
      } else {
        setNote('No se pudo activar. Inténtelo de nuevo.', 'warn');
      }
    } finally {
      primary.disabled = false;
    }
  }

  async function onDisable() {
    setNote('Desactivando…');
    try {
      await disable();
      setNote('Avisos desactivados en este dispositivo.', 'ok');
      refreshState();
    } catch (e) {
      setNote('No se pudo desactivar.', 'warn');
    }
  }

  function wireBell() {
    var bell = $('#avisos-bell');
    if (bell) bell.addEventListener('click', openPanel);
  }

  function init() {
    if (!('serviceWorker' in navigator)) return; // sin soporte, la campana no hace nada útil
    buildPanel();
    wireBell();
    $('#av-close').addEventListener('click', closePanel);
    $('#av-overlay').addEventListener('click', function (e) {
      if (e.target === $('#av-overlay')) closePanel();
    });
    $('#av-primary').addEventListener('click', onPrimary);
    $('#av-disable').addEventListener('click', onDisable);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#av-overlay').hidden) closePanel();
    });
    // Registra el SW en segundo plano (no pide permiso todavía)
    if (supported()) ensureSW().catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
