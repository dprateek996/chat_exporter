document.addEventListener('DOMContentLoaded', function() {
  const chatgptBtn = document.getElementById('open-chatgpt-btn');
  const geminiBtn = document.getElementById('open-gemini-btn');

  if (chatgptBtn) {
    chatgptBtn.onclick = function() {
      chrome.tabs.create({ url: 'https://chatgpt.com' });
      window.close();
    };
  }

  if (geminiBtn) {
    geminiBtn.onclick = function() {
      chrome.tabs.create({ url: 'https://gemini.google.com' });
      window.close();
    };
  }
});