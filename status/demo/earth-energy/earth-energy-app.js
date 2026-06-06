(() => {
  if (new URLSearchParams(window.location.search).get('embedded') === '1') {
    document.body.classList.add('system-embedded');
  }

  window.EARTH_HEALTH_ENERGY_CONFIG = {
    mode: 'energy',
    initialMode: 'energy',
    showInitialPanel: true,
    autoOpenManifestCrew: false
  };

  const script = document.createElement('script');
  script.src = '../shared/earth-health-energy-app.js?v=modular-apps-6';
  document.head.appendChild(script);
})();
