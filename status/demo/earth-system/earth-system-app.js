(() => {
  const MODES = ['manifest', 'energy', 'clock'];
  const labels = {
    manifest: 'Manifest',
    energy: 'Energy',
    clock: 'Clock Map'
  };
  let activeMode = 'none';
  let clockMapLoadPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-system-src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.dataset.systemSrc = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.body.appendChild(script);
    });
  }

  function ensureClockMapLoaded() {
    if (window.EarthClockMapApp) return Promise.resolve();
    if (!clockMapLoadPromise) {
      clockMapLoadPromise = loadScript('../earth-clock-map/world-space-time-coordinates.js?v=36')
        .then(() => loadScript('../earth-clock-map/earth-space-time-coordinates.js?v=1'))
        .then(() => loadScript('../earth-clock-map/moon-space-time-coordinates.js?v=1'))
        .then(() => loadScript('../earth-clock-map/mars-space-time-coordinates.js?v=1'))
        .then(() => loadScript('../earth-clock-map/earth-clock-map-app.js?v=49'))
        .catch(error => {
          clockMapLoadPromise = null;
          console.error(error);
        });
    }
    return clockMapLoadPromise;
  }

  function buttonFor(mode) {
    if (mode === 'manifest') return document.getElementById('showHealthBtn');
    if (mode === 'energy') return document.getElementById('showEnergyBtn');
    return document.getElementById('showClockBtn');
  }

  function relabel(activeMode) {
    MODES.forEach(mode => {
      const button = buttonFor(mode);
      if (!button) return;
      button.textContent = labels[mode];
      button.classList.toggle('active', mode === activeMode);
    });
  }

  function setMode(mode) {
    activeMode = mode;
    document.body.classList.toggle('clock-mode', mode === 'clock');
    document.body.classList.toggle('manifest-mode', mode === 'manifest');
    document.body.classList.toggle('energy-mode', mode === 'energy');
    if (mode === 'clock') {
      document.body.classList.remove('clock-arcs-closed', 'clock-coords-closed');
    } else {
      document.body.classList.remove('clock-arcs-closed', 'clock-coords-closed');
    }
    if (window.EarthHealthEnergyApp?.setMode) {
      if (mode === 'manifest') {
        window.EarthHealthEnergyApp.setMode('manifest', { openCrew: false });
      } else if (mode === 'energy') {
        window.EarthHealthEnergyApp.setMode('energy', { showInspector: true });
      } else {
        window.EarthHealthEnergyApp.setMode('none');
      }
    }
    if (mode === 'clock') ensureClockMapLoaded();
    relabel(mode);
    requestAnimationFrame(() => relabel(mode));
  }

  document.addEventListener('click', event => {
    const clockClose = event.target.closest?.('#closeClockArcsBtn,#closeClockCoordsBtn');
    if (clockClose) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (clockClose.id === 'closeClockArcsBtn') document.body.classList.add('clock-arcs-closed');
      else document.body.classList.add('clock-coords-closed');
      return;
    }
    const button = event.target.closest?.('#showHealthBtn,#showEnergyBtn,#showClockBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.id === 'showHealthBtn') setMode('manifest');
    else if (button.id === 'showEnergyBtn') setMode('energy');
    else setMode('clock');
  }, true);

  function boot() {
    setMode('none');
  }

  const readyTimer = setInterval(() => {
    if (!window.EarthHealthEnergyApp?.setMode) return;
    clearInterval(readyTimer);
    boot();
  }, 100);
})();
