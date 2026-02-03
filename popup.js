

document.addEventListener('DOMContentLoaded', () => {

  const pills = document.querySelectorAll('.p-pill');


  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    pills.forEach(pill => pill.classList.remove('active'));

    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
      document.getElementById('open-chatgpt-btn').classList.add('active');
    } else if (url.includes('gemini.google.com')) {
      document.getElementById('open-gemini-btn').classList.add('active');
    } else if (url.includes('claude.ai')) {
      document.getElementById('open-claude-btn').classList.add('active');
    } else if (url.includes('perplexity.ai')) {
      document.getElementById('open-perplexity-btn').classList.add('active');
    } else if (url.includes('grok.com')) {
      document.getElementById('open-grok-btn').classList.add('active');
    }
  });


  document.getElementById('open-chatgpt-btn').onclick = () => {
    chrome.tabs.create({ url: 'https://chatgpt.com' });
  };

  document.getElementById('open-gemini-btn').onclick = () => {
    chrome.tabs.create({ url: 'https://gemini.google.com' });
  };

  document.getElementById('open-claude-btn').onclick = () => {
    chrome.tabs.create({ url: 'https://claude.ai' });
  };

  document.getElementById('open-perplexity-btn').onclick = () => {
    chrome.tabs.create({ url: 'https://www.perplexity.ai' });
  };

  document.getElementById('open-grok-btn').onclick = () => {
    chrome.tabs.create({ url: 'https://grok.com' });
  };


  document.getElementById('main-export-trigger').onclick = async () => {
    const btn = document.getElementById('main-export-trigger');
    const originalText = btn.textContent;


    btn.classList.add('loading');
    btn.textContent = 'Exporting...';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });


      const url = tab?.url || '';
      if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com') &&
        !url.includes('gemini.google.com') && !url.includes('claude.ai') &&
        !url.includes('perplexity.ai') && !url.includes('grok.com')) {
        btn.classList.remove('loading');
        btn.textContent = 'Open a chat first';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
        return;
      }


      chrome.tabs.sendMessage(tab.id, { action: 'exportConversation' }, (response) => {
        btn.classList.remove('loading');
        if (response?.success) {
          btn.textContent = 'Exported!';
          setTimeout(() => window.close(), 1000);
        } else {
          btn.textContent = originalText;
        }
      });

    } catch (error) {
      btn.classList.remove('loading');
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
  };


});