(function () {
  'use strict';
  const origin = 'https://hourly-six-lab-blikey.blikeywang.chatgpt.site';
  const frame = document.getElementById('marketWorkspace');
  const status = document.getElementById('connectionStatus');
  const notice = document.getElementById('accessNotice');
  window.addEventListener('message', function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow || !event.data || event.data.type !== 'market-simulation-ready') return;
    status.textContent = '工作台已连接';
    status.dataset.connected = 'true';
    notice.hidden = true;
  });
  document.getElementById('reloadWorkspace').addEventListener('click', function () {
    status.textContent = '正在重新连接';
    delete status.dataset.connected;
    notice.hidden = false;
    frame.src = origin + '/?embed=traderhome';
  });
})();
