/* ================================================================
   EHR SIMULATION — CONFIGURATION
   ----------------------------------------------------------------
   API_URL: your Google Apps Script Web App URL (ends with /exec).
            See backend/SETUP.md.
   Leave it empty ('') to run in DEMO MODE: everything is saved in
   this browser only (good for trying the app out, NOT for class).

   Practice / testing without touching real data:
   open any page with ?demo at the end of the address, e.g.
     https://…/instructor.html?demo
   That browser tab then uses demo data until it is closed.
   ================================================================ */
(function () {
  var LIVE_URL = 'https://script.google.com/macros/s/AKfycbzydmG0MaL5B06lCbG-m3q7XrlWzl88tOp-52nEBvRUhQ_32vysvlTjdIyb7hYpzAz9iw/exec';
  var demo = false;
  try {
    if (/[?&]demo\b/.test(location.search)) sessionStorage.setItem('ncm110_force_demo', '1');
    demo = sessionStorage.getItem('ncm110_force_demo') === '1';
  } catch (e) {}
  window.EHR_CONFIG = {
    API_URL: demo ? '' : LIVE_URL,
    CONFIG_POLL_SECONDS: 30    // how often students check if Task 5 is unlocked
  };
})();
