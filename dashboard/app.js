/* Antigravity replaces this placeholder; all arithmetic stays in model.js. */
(function () {
  const radar = window.RadarModel.buildRadar(window.RADAR_DATA);
  document.getElementById('status').textContent = radar.summary.board + ' ranked records · ' + radar.summary.watchlist_covered + '/' + radar.summary.watchlist_total + ' watchlist · ' + radar.summary.trading_peers + ' trading peers · snapshot ' + radar.as_of;
})();
