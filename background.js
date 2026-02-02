
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'export-conversation',
    title: '📄 Export Conversation to PDF',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://gemini.google.com/*',
      'https://claude.ai/*'
    ]
  });

  chrome.contextMenus.create({
    id: 'diagnostics',
    title: '🔎 Diagnostics: Log turns',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://gemini.google.com/*',
      'https://claude.ai/*'
    ]
  });
});


chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'export-conversation') {
    chrome.tabs.sendMessage(tab.id, { action: 'exportConversation' });
  } else if (info.menuItemId === 'diagnostics') {
    chrome.tabs.sendMessage(tab.id, { action: 'diagnostics' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
 
  if (request.type === 'CAPTURE_IMAGE_REGION') {
    (async () => {
      try {
        const { rect, tabId } = request;
        console.log('[ChatArchive BG] Capturing region:', rect);

   
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

        
        sendResponse({ success: true, dataUrl, rect });
      } catch (error) {
        console.log('[ChatArchive BG] Capture error:', error.message);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

    
  if (request.type === 'FETCH_IMAGE_BASE64') {
    (async () => {
      try {
        const url = request.url;
        const isGoogleImage = url.includes('googleusercontent') || url.includes('ggpht') || url.includes('lh3.google');

        console.log('[ChatArchive BG] Fetching image:', url.substring(0, 80));
        console.log('[ChatArchive BG] Is Google image:', isGoogleImage);

        let response = null;
        let lastError = null;

        if (!response) {
          try {
            console.log('[ChatArchive BG] Try 1: with credentials');
            const resp = await fetch(url, {
              credentials: 'include',
              mode: 'cors',
              headers: { 'Accept': 'image/*' }
            });
            if (resp.ok) response = resp;
            else lastError = `Status ${resp.status}`;
          } catch (e) {
            console.log('[ChatArchive BG] Try 1 failed:', e.message);
            lastError = e.message;
          }
        }

        if (!response) {
          try {
            console.log('[ChatArchive BG] Try 2: without credentials');
            const resp = await fetch(url, {
              credentials: 'omit',
              mode: 'cors',
              headers: { 'Accept': 'image/*' }
            });
            if (resp.ok) response = resp;
            else lastError = `Status ${resp.status}`;
          } catch (e) {
            console.log('[ChatArchive BG] Try 2 failed:', e.message);
            lastError = e.message;
          }
        }

        if (!response) {
          try {
            console.log('[ChatArchive BG] Try 3: no-cors mode');
            const resp = await fetch(url, {
              credentials: 'include',
              mode: 'no-cors'
            });
            response = resp;
          } catch (e) {
            console.log('[ChatArchive BG] Try 3 failed:', e.message);
            lastError = e.message;
          }
        }

        if (response) {
          try {
            const blob = await response.blob();
            console.log('[ChatArchive BG] Got blob, size:', blob.size, 'type:', blob.type);

            if (blob.size < 100) {
              sendResponse({ success: false, error: 'Blob too small (likely error response)' });
              return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
              console.log('[ChatArchive BG] Converted to base64, length:', reader.result?.length);
              sendResponse({ success: true, base64: reader.result });
            };
            reader.onerror = () => {
              sendResponse({ success: false, error: 'FileReader error' });
            };
            reader.readAsDataURL(blob);
          } catch (blobError) {
            console.log('[ChatArchive BG] Blob error:', blobError.message);
            sendResponse({ success: false, error: `Blob error: ${blobError.message}` });
          }
        } else {
          console.log('[ChatArchive BG] All fetch attempts failed');
          sendResponse({ success: false, error: `Fetch failed: ${lastError || 'unknown'}` });
        }
      } catch (error) {
        console.log('[ChatArchive BG] Error:', error.message);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; 
  }
});
