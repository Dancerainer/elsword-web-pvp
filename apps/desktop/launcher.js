const $ = id => document.getElementById(id);
for (const command of ['update','refresh','fullscreen','minimize','maximize','quit','retry','folder','logs']) {
  $(command).addEventListener('click', () => window.launcher.action(command).catch(error => { $('message').textContent = error.message; }));
}
function render(value) {
  document.body.classList.toggle('playing', value.phase === 'playing');
  if (value.icon && $('program-icon').getAttribute('src') !== value.icon) {
    $('program-icon').src = value.icon;
    $('program-icon').hidden = false;
  }
  $('title').textContent = value.title;
  $('message').textContent = value.message;
  $('detail').textContent = value.detail || '';
  $('retry').hidden = !['error','full-client-required'].includes(value.phase);
  $('retry').disabled = value.busy;
  $('folder').hidden = value.phase !== 'full-client-required';
  $('refresh').disabled = !value.hasGame || value.busy;
  $('update').disabled = value.busy;
  $('fullscreen').textContent = value.fullscreen ? 'Exit fullscreen F11' : 'Fullscreen F11';
  $('maximize').textContent = value.maximized ? 'Restore' : 'Maximize';
  if (Number.isFinite(value.progress)) { $('progress').max = 1; $('progress').value = value.progress; }
  else $('progress').removeAttribute('value');
  $('progress').hidden = ['error','full-client-required'].includes(value.phase);
}
window.launcher.onState(render);
window.launcher.ready().then(render);
