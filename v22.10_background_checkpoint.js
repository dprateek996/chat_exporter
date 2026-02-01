// Create context menu on install
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

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'export-conversation') {
    chrome.tabs.sendMessage(tab.id, { action: 'exportConversation' });
  } else if (info.menuItemId === 'diagnostics') {
    chrome.tabs.sendMessage(tab.id, { action: 'diagnostics' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GENERATE_PDF_BACKGROUND') {
    (async () => {
      try {
        const jsPDFLib = await import(chrome.runtime.getURL('libs/jspdf.umd.min.js'));
        const { jsPDF } = jsPDFLib;

        sendResponse({ success: true, pdfGenerated: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle capturing a visible portion of the tab (for image elements)
  if (request.type === 'CAPTURE_IMAGE_REGION') {
    (async () => {
      try {
        const { rect, tabId } = request;
        console.log('[ChatArchive BG] Capturing region:', rect);

        // Capture the visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

        // We need to crop the image to the specified region
        // Send the full screenshot and region info back to content script to crop
        sendResponse({ success: true, dataUrl, rect });
      } catch (error) {
        console.log('[ChatArchive BG] Capture error:', error.message);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handle image fetching from background (has different permissions)
  if (request.type === 'FETCH_IMAGE_BASE64') {
    (async () => {
      try {
        const url = request.url;
        const isGoogleImage = url.includes('googleusercontent') || url.includes('ggpht') || url.includes('lh3.google');

        console.log('[ChatArchive BG] Fetching image:', url.substring(0, 80));
        console.log('[ChatArchive BG] Is Google image:', isGoogleImage);

        let response = null;
        let lastError = null;

        // Try 1: With credentials (needed for Google authenticated images)
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

        // Try 2: Without credentials (for public images)
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

        // Try 3: No-cors mode (gets opaque response but might work)
        if (!response) {
          try {
            console.log('[ChatArchive BG] Try 3: no-cors mode');
            const resp = await fetch(url, {
              credentials: 'include',
              mode: 'no-cors'
            });
            // no-cors returns opaque response, can't check ok
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
    return true; // Required for async sendResponse
  }
});
