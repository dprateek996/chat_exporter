// content.js
let jsPDFInstance = null;

(async () => {
  try {
    const jsPDFScript = document.createElement("script");
    jsPDFScript.src = chrome.runtime.getURL("libs/jspdf.umd.min.js");
    jsPDFScript.type = "text/javascript";
    (document.head || document.documentElement).appendChild(jsPDFScript);
    
    const injectedScript = document.createElement("script");
    injectedScript.src = chrome.runtime.getURL("injected.js");
    injectedScript.type = "text/javascript";
    (document.head || document.documentElement).appendChild(injectedScript);
    
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.data.type === 'JSPDF_READY' && event.data.jsPDFAvailable) {
        jsPDFInstance = true;
      }
    });
    
  } catch (error) {
    console.error("Failed to inject scripts:", error);
  }
})();

// Helper to extract clean text preserving structure
function getStructuredText(element) {
  if (!element) return '';
  
  // Clone to avoid modifying the page
  const clone = element.cloneNode(true);
  
  // Remove garbage elements
  clone.querySelectorAll('button, svg, .sr-only, .flex.items-center, .copy-code-button').forEach(el => el.remove());

  let textParts = [];

  // If it's a markdown container, iterate children to preserve block structure
  if (clone.classList.contains('markdown') || clone.querySelector('.markdown')) {
    const container = clone.classList.contains('markdown') ? clone : clone.querySelector('.markdown');
    
    container.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) textParts.push(t);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        
        if (tagName === 'p') {
          textParts.push(node.innerText.trim());
        } else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
          textParts.push('\n# ' + node.innerText.trim() + '\n');
        } else if (tagName === 'ul' || tagName === 'ol') {
          node.querySelectorAll('li').forEach(li => {
            textParts.push('• ' + li.innerText.trim());
          });
        } else if (tagName === 'pre') {
          textParts.push('[CODE BLOCK]\n' + node.innerText.trim() + '\n[/CODE BLOCK]');
        } else {
          textParts.push(node.innerText.trim());
        }
      }
    });
  } else {
    // Fallback for simple messages
    return clone.innerText.trim();
  }

  return textParts.join('\n\n');
}

function extractConversation() {
  const articles = document.querySelectorAll('article');
  const messages = [];

  articles.forEach((article) => {
    let role = "assistant";
    if (article.querySelector('[data-message-author-role="user"]')) {
      role = "user";
    }

    // Find the actual message content container
    const contentContainer = article.querySelector('.markdown') || article.querySelector('[data-message-author-role] + div');
    
    if (contentContainer) {
      let text = getStructuredText(contentContainer);
      
      // Clean up common artifacts
      text = text
        .replace(/Copy code/g, '')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control chars
        .trim();

      if (text) {
        messages.push({ role, text });
      }
    }
  });

  return messages;
}

async function generatePDF(messages) {
  let attempts = 0;
  while (!jsPDFInstance && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  
  if (!jsPDFInstance) {
    alert("PDF Library not loaded. Please refresh the page.");
    return;
  }

  window.postMessage({ type: 'GENERATE_PDF', messages }, '*');
}

// Floating button logic
function createFloatingButton() {
  if (document.getElementById("chatgpt-exporter-button")) return;
  const btn = document.createElement("button");
  btn.id = "chatgpt-exporter-button";
  btn.textContent = "Export Chat (PDF)";
  Object.assign(btn.style, {
    position: "fixed", bottom: "20px", right: "20px", zIndex: "999999",
    padding: "10px 16px", borderRadius: "999px", border: "none",
    background: "#000", color: "#fff", cursor: "pointer", fontWeight: "bold"
  });
  
  btn.onclick = async () => {
    btn.textContent = "Processing...";
    const messages = extractConversation();
    if (messages.length === 0) {
      alert("No messages found. Scroll up to load history.");
      btn.textContent = "Export Chat (PDF)";
      return;
    }
    await generatePDF(messages);
    btn.textContent = "Export Chat (PDF)";
  };
  document.body.appendChild(btn);
}

setTimeout(createFloatingButton, 1000);