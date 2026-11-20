/* ================================================================
   EHR SIMULATION — CONFIGURATION
   ----------------------------------------------------------------
   API_URL: paste your Google Apps Script Web App URL here
            (ends with /exec). See backend/SETUP.md.
   Leave it empty ('') to run in DEMO MODE: everything is saved in
   this browser only (good for trying the app out, NOT for class).
   ================================================================ */
window.EHR_CONFIG = {
  API_URL: '',
  AUTOSAVE_SECONDS: 20,      // how often drafts sync to the server
  CONFIG_POLL_SECONDS: 30    // how often students check if Task 5 is unlocked
};
