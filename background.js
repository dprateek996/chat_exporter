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
});
