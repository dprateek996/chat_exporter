document.getElementById('open-chatgpt-btn').onclick = function() {
  chrome.tabs.create({ url: 'https://chatgpt.com' });
};