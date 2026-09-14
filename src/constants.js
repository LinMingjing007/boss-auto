(function () {
  'use strict';

  window.BossAutoConstants = Object.freeze({
    TARGET_PATH: '/web/geek/jobs',
    SCRIPT_VERSION: '0.6.7',
    CONFIG_KEY: 'boss-auto-config',
    MESSAGE_RECORDS_KEY: 'boss-auto-message-records',
    CHAT_PANEL_ID: 'boss-auto-chat-panel',
    PANEL_ID: 'boss-auto-panel',
    STATUS_ID: 'boss-auto-status',
    STYLE_ID: 'boss-auto-style',
    SETTINGS_VIEW_ID: 'boss-auto-settings-view',
    MAX_IMAGE_SIZE_BYTES: 1024 * 1024,
    MESSAGE_INTERVAL_MS: 30,
    STATUS_OPTIONS: [
      { value: '不限', text: '不限' },
      { value: '在线', text: '在线' },
      { value: '刚刚活跃', text: '刚刚活跃' },
      { value: '今日活跃', text: '今日活跃' },
      { value: '3日内活跃', text: '3日内活跃' },
      { value: '本周活跃', text: '本周活跃' },
      { value: '本月活跃', text: '本月活跃' },
      { value: '半年前活跃', text: '半年前活跃' },
    ],
  });
})();
