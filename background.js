
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'export-conversation',
    title: '📄 Export Conversation to PDF',
    contexts: ['page'],

  });

  const targets = [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://gemini.google.com/*',
    'https://claude.ai/*',
    'https://www.perplexity.ai/*',
    'https://grok.com/*'
  ];

  chrome.tabs.query({ url: targets }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['libs/jspdf.umd.min.js', 'content.js']
        }).catch(() => {
        });
      }
    }
  });
});


chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'export-conversation') {
    chrome.tabs.sendMessage(tab.id, { action: 'exportConversation' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.type === 'CAPTURE_IMAGE_REGION') {
    (async () => {
      try {
        const { rect, tabId } = request;


        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });


        sendResponse({ success: true, dataUrl, rect });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }


  if (request.type === 'FETCH_IMAGE_BASE64') {
    (async () => {
      try {
        const url = request.url;
        let response = null;
        let lastError = null;

        // 1. Try with credentials included (for authenticated resources)
        try {
          const resp = await fetch(url, {
            credentials: 'include',
            mode: 'cors',
            headers: { 'Accept': 'image/*' }
          });
          if (resp.ok) response = resp;
          else lastError = `Status ${resp.status}`;
        } catch (e) {
          lastError = e.message;
        }

        // 2. If failed, try anonymous (sometimes helps with aggressive CORS configs)
        if (!response) {
          try {
            const resp = await fetch(url, {
              credentials: 'omit',
              mode: 'cors',
              headers: { 'Accept': 'image/*' }
            });
            if (resp.ok) response = resp;
            else lastError = `Status ${resp.status}`;
          } catch (e) {
            lastError = e.message;
          }
        }

        if (response) {
          try {
            const blob = await response.blob();
            if (blob.size < 100) {
              sendResponse({ success: false, error: 'Blob too small' });
              return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
              // Ensure we have a result
              if (reader.result) {
                sendResponse({ success: true, base64: reader.result });
              } else {
                sendResponse({ success: false, error: 'Empty reader result' });
              }
            };
            reader.onerror = () => {
              sendResponse({ success: false, error: 'FileReader error' });
            };
            reader.readAsDataURL(blob);
          } catch (blobError) {
            sendResponse({ success: false, error: `Blob error: ${blobError.message}` });
          }
        } else {
          sendResponse({ success: false, error: `Fetch failed: ${lastError || 'unknown'}` });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open
  }
});
